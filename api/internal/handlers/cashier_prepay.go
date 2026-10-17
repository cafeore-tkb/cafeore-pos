// api/internal/handlers/cashier_prepay.go
package handlers

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"cafeore-pos/api/internal/models"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// 先払いの途中の状態（cashier_states.prepay）が満たすべき形。
// フロントの cashierPrepaySchema と揃える。zod は知らないキーを捨てるだけなので、余分なキーは許す。
//
// 受け取った支払い（tenders）の記録として残すので、支払いが 1 つも無い状態は受け付けない
// （先払いが無くなったら null で消す）。
var cashierPrepaySpec = valueSpec{kind: kindObject, fields: []fieldSpec{
	// レシートに載せた注文番号（No.）
	{name: "orderId", spec: valueSpec{kind: kindPositiveInt}},
	{name: "lines", spec: valueSpec{kind: kindArray, elem: &cashierLineSpec, minLen: 1}},
	{name: "nextKey", spec: valueSpec{kind: kindInt}},
	{name: "coupon", spec: valueSpec{kind: kindString}},
	{name: "special", spec: valueSpec{kind: kindBool}},
	{name: "memo", spec: valueSpec{kind: kindString}},
	{name: "split", spec: cashierSplitSpec},
}}

// CashierLine。menu は編集中の注文の menus と同じ形
var cashierLineSpec = valueSpec{kind: kindObject, fields: []fieldSpec{
	{name: "key", spec: valueSpec{kind: kindInt}},
	{name: "menu", spec: menuSpec},
}}

// CashierSplit
var cashierSplitSpec = valueSpec{kind: kindObject, fields: []fieldSpec{
	{name: "subtotals", spec: valueSpec{kind: kindArray, elem: &cashierSubtotalSpec, minLen: 1}},
	{name: "tenders", spec: valueSpec{kind: kindArray, elem: &cashierTenderSpec, minLen: 1}},
	{name: "current", spec: valueSpec{kind: kindInt, nullable: true}},
	{name: "part", spec: valueSpec{kind: kindPositiveInt, nullable: true}},
	{name: "discountFirst", spec: valueSpec{kind: kindArray, elem: &valueSpec{kind: kindInt}}},
	{name: "nextId", spec: valueSpec{kind: kindInt}},
}}

// CashierSubtotal
var cashierSubtotalSpec = valueSpec{kind: kindObject, fields: []fieldSpec{
	{name: "id", spec: valueSpec{kind: kindInt}},
	{name: "kind", spec: valueSpec{kind: kindEnum, enum: []string{"items", "rest"}}},
	{name: "lineKeys", spec: valueSpec{kind: kindArray, elem: &valueSpec{kind: kindInt}, minLen: 1}},
	{name: "total", spec: valueSpec{kind: kindInt}},
	{name: "discountCups", spec: valueSpec{kind: kindInt}},
	{name: "discount", spec: valueSpec{kind: kindInt}},
	{name: "amount", spec: valueSpec{kind: kindInt}},
}}

// CashierTender。Square で払ったときだけ、決済依頼の ID（square_checkouts.id）と決済画面の種類がある
var cashierTenderSpec = valueSpec{kind: kindObject, fields: []fieldSpec{
	{name: "id", spec: valueSpec{kind: kindInt}},
	{name: "subtotalId", spec: valueSpec{kind: kindInt}},
	{name: "method", spec: valueSpec{kind: kindEnum, enum: []string{"cash", "square"}}},
	{name: "amount", spec: valueSpec{kind: kindInt}},
	{name: "received", spec: valueSpec{kind: kindInt}},
	{name: "squareCheckoutId", optional: true, spec: valueSpec{kind: kindUUID}},
	{name: "squarePaymentType", optional: true, spec: valueSpec{kind: kindEnum, enum: []string{
		string(models.CARDPRESENT), string(models.FELICAALL), string(models.QRCODE),
	}}},
}}

func validateCashierPrepay(prepay map[string]interface{}) error {
	return validateValue("prepay", prepay, cashierPrepaySpec)
}

func toCashierPrepayResponse(prepay models.JSONB, updatedAt *time.Time) (models.CashierPrepayResponse, error) {
	if len(prepay) == 0 {
		return models.CashierPrepayResponse{}, nil
	}
	var obj map[string]interface{}
	if err := json.Unmarshal(prepay, &obj); err != nil {
		return models.CashierPrepayResponse{}, err
	}
	return models.CashierPrepayResponse{Prepay: &obj, UpdatedAt: updatedAt}, nil
}

// GET /api/cashier-state/prepay - 先払いの途中の状態の取得
//
// 先払いが無い・まだレジ状態が無いときは、prepay を null で返す（404 にしない）。
func (h *CashierStateHandler) GetCashierPrepay(c *gin.Context) {
	state, err := findCashierState(h.db)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		c.JSON(http.StatusOK, models.CashierPrepayResponse{})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	resp, err := toCashierPrepayResponse(state.Prepay, state.PrepayUpdatedAt)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, resp)
}

// PUT /api/cashier-state/prepay - 先払いの途中の状態の更新
//
// レジは先払いの途中の状態が変わるたびに送り、先払いが無くなったら（注文を送った・全部返金した）
// null で消す。編集中の注文（PUT /api/cashier-state）とは列を分けて置き換えるので、
// キー入力のたびの PUT で消えない。配信はしない（購読する画面がまだ無い）。
func (h *CashierStateHandler) UpdateCashierPrepay(c *gin.Context) {
	// null（消す）とキーが無いのを見分けるので、生成した型（CashierPrepayUpdateRequest）には読まない
	var body map[string]json.RawMessage
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	raw, ok := body["prepay"]
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "prepay is required (null to clear)"})
		return
	}
	var prepay map[string]interface{}
	if err := json.Unmarshal(raw, &prepay); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "prepay must be an object or null"})
		return
	}

	var value models.JSONB
	var updatedAt *time.Time
	if prepay != nil {
		if err := validateCashierPrepay(prepay); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		data, err := json.Marshal(prepay)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		value = models.JSONB(data)
		// DB に保存される精度（マイクロ秒）にそろえる。保存した内容を読み直さずに返すので、
		// そろえないと GET と updated_at が食い違う
		now := time.Now().Truncate(time.Microsecond)
		updatedAt = &now
	}

	result := h.db.Model(&models.CashierState{}).
		Where("id = ?", models.CashierStateID).
		Updates(map[string]interface{}{"prepay": value, "prepay_updated_at": updatedAt})
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": result.Error.Error()})
		return
	}
	// 行は編集中の注文の PUT で作る。編集中の注文（editting_order）は空にできないので、ここでは作らない。
	// 消すだけなら、行が無くても消えている
	if result.RowsAffected == 0 && value != nil {
		c.JSON(http.StatusConflict, gin.H{"error": "cashier state not found"})
		return
	}

	resp, err := toCashierPrepayResponse(value, updatedAt)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, resp)
}
