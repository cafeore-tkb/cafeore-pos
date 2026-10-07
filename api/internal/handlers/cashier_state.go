// api/internal/handlers/cashier_state.go
package handlers

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math"
	"net/http"
	"regexp"
	"slices"
	"sync"
	"time"

	"cafeore-pos/api/internal/models"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	openapi_types "github.com/oapi-codegen/runtime/types"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type CashierStateHandler struct {
	db  *gorm.DB
	hub *Hub
}

func NewCashierStateHandler(db *gorm.DB, hub *Hub) *CashierStateHandler {
	return &CashierStateHandler{db: db, hub: hub}
}

// レジ状態の保存と配信を直列化する。
//
// Hub は積まれた順に送るので、保存から Broadcast までをこのロックで囲めば
// クライアントには保存した順に届く。囲まないと、並行する PUT が古い状態を
// 後から流し、クライアントが古い状態のまま残りうる。
var cashierStateMu sync.Mutex

func toCashierStateResponse(state *models.CashierState) (models.CashierStateResponse, error) {
	var order map[string]interface{}
	if err := json.Unmarshal(state.EdittingOrder, &order); err != nil {
		return models.CashierStateResponse{}, err
	}

	var submitted *openapi_types.UUID
	if state.SubmittedOrderID != nil {
		id := openapi_types.UUID(*state.SubmittedOrderID)
		submitted = &id
	}

	return models.CashierStateResponse{
		EdittingOrder:    order,
		SubmittedOrderId: submitted,
		UpdatedAt:        state.UpdatedAt,
	}, nil
}

// editting_order の各値が満たすべき形。
type valueKind int

const (
	kindNumber valueKind = iota
	kindInt
	kindPositiveInt
	kindString
	kindUUID
	kindDate
	kindEnum
	kindObject
	kindArray
)

type valueSpec struct {
	kind     valueKind
	nullable bool
	enum     []string    // kindEnum
	fields   []fieldSpec // kindObject
	elem     *valueSpec  // kindArray
	minLen   int         // kindArray
	max      int         // kindPositiveInt。0 なら上限なし
}

type fieldSpec struct {
	name     string
	optional bool // キーが無くてもよい
	spec     valueSpec
}

// zod の z.string().uuid() と同じ形
var uuidPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// フロントの cashierStateWireSchema（orderSchema の Date を ISO 文字列にしたもの）と揃える。
// zod は知らないキーを捨てるだけなので、余分なキーは許す。
var edittingOrderSpec = valueSpec{kind: kindObject, fields: []fieldSpec{
	// 保存前の注文には無い
	{name: "id", optional: true, spec: valueSpec{kind: kindString}},
	{name: "orderId", spec: valueSpec{kind: kindNumber}},
	{name: "createdAt", spec: valueSpec{kind: kindDate}},
	{name: "readyAt", spec: valueSpec{kind: kindDate, nullable: true}},
	{name: "servedAt", spec: valueSpec{kind: kindDate, nullable: true}},
	{name: "menus", spec: valueSpec{kind: kindArray, elem: &menuSpec}},
	{name: "total", spec: valueSpec{kind: kindNumber}},
	{name: "comments", spec: valueSpec{kind: kindArray, elem: &commentSpec}},
	{name: "billingAmount", spec: valueSpec{kind: kindNumber}},
	{name: "received", spec: valueSpec{kind: kindNumber}},
	{name: "discountOrderId", spec: valueSpec{kind: kindNumber, nullable: true}},
	{name: "discountOrderCups", spec: valueSpec{kind: kindNumber}},
	{name: "DISCOUNT_PER_CUP", spec: valueSpec{kind: kindNumber}},
	{name: "discount", spec: valueSpec{kind: kindNumber}},
	{name: "estimateTime", spec: valueSpec{kind: kindNumber}},
}}

// menuSchema.required({ id: true })
var menuSpec = valueSpec{kind: kindObject, fields: []fieldSpec{
	{name: "id", spec: valueSpec{kind: kindUUID}},
	{name: "orderMenuId", optional: true, spec: valueSpec{kind: kindUUID}},
	{name: "name", spec: valueSpec{kind: kindString}},
	{name: "abbr", spec: valueSpec{kind: kindString}},
	{name: "price", spec: valueSpec{kind: kindInt}},
	{name: "key", spec: valueSpec{kind: kindString}},
	{name: "items", spec: valueSpec{kind: kindArray, elem: &menuItemSpec, minLen: 1}},
	{name: "assignee", spec: valueSpec{kind: kindString, nullable: true}},
	// 番号より前の画面が送る状態には無い（zod は無ければ null にする）
	{name: "dripper", optional: true, spec: valueSpec{kind: kindPositiveInt, nullable: true, max: maxDripper}},
}}

// menuItemSchema。item は itemSchema.required() なので id も必須
var menuItemSpec = valueSpec{kind: kindObject, fields: []fieldSpec{
	{name: "item", spec: valueSpec{kind: kindObject, fields: []fieldSpec{
		{name: "id", spec: valueSpec{kind: kindUUID}},
		{name: "name", spec: valueSpec{kind: kindString}},
		{name: "abbr", spec: valueSpec{kind: kindString}},
		{name: "item_type", spec: valueSpec{kind: kindObject, fields: []fieldSpec{
			{name: "id", optional: true, spec: valueSpec{kind: kindString}},
			{name: "name", spec: valueSpec{kind: kindString}},
			{name: "display_name", spec: valueSpec{kind: kindString}},
		}}},
	}}},
	{name: "quantity", spec: valueSpec{kind: kindPositiveInt}},
}}

// commentSchema
var commentSpec = valueSpec{kind: kindObject, fields: []fieldSpec{
	{name: "author", spec: valueSpec{kind: kindEnum, enum: []string{"cashier", "master", "serve", "others"}}},
	{name: "text", spec: valueSpec{kind: kindString}},
	{name: "createdAt", spec: valueSpec{kind: kindDate}},
}}

func validateValue(path string, v interface{}, spec valueSpec) error {
	if v == nil {
		if spec.nullable {
			return nil
		}
		return fmt.Errorf("%s must not be null", path)
	}

	switch spec.kind {
	case kindNumber, kindInt, kindPositiveInt:
		n, ok := v.(float64)
		if !ok {
			return fmt.Errorf("%s must be a number", path)
		}
		if spec.kind != kindNumber && n != math.Trunc(n) {
			return fmt.Errorf("%s must be an integer", path)
		}
		if spec.kind == kindPositiveInt && n <= 0 {
			return fmt.Errorf("%s must be positive", path)
		}
		if spec.max > 0 && n > float64(spec.max) {
			return fmt.Errorf("%s must be at most %d", path, spec.max)
		}
	case kindString, kindUUID, kindDate, kindEnum:
		str, ok := v.(string)
		if !ok {
			return fmt.Errorf("%s must be a string", path)
		}
		switch spec.kind {
		case kindUUID:
			if !uuidPattern.MatchString(str) {
				return fmt.Errorf("%s must be a UUID", path)
			}
		case kindDate:
			if _, err := time.Parse(time.RFC3339Nano, str); err != nil {
				return fmt.Errorf("%s must be an ISO 8601 date-time", path)
			}
		case kindEnum:
			if !slices.Contains(spec.enum, str) {
				return fmt.Errorf("%s must be one of %v", path, spec.enum)
			}
		}
	case kindObject:
		obj, ok := v.(map[string]interface{})
		if !ok {
			return fmt.Errorf("%s must be an object", path)
		}
		for _, f := range spec.fields {
			fv, exists := obj[f.name]
			if !exists {
				if f.optional {
					continue
				}
				return fmt.Errorf("%s.%s is required", path, f.name)
			}
			if err := validateValue(path+"."+f.name, fv, f.spec); err != nil {
				return err
			}
		}
	case kindArray:
		arr, ok := v.([]interface{})
		if !ok {
			return fmt.Errorf("%s must be an array", path)
		}
		if len(arr) < spec.minLen {
			return fmt.Errorf("%s must have at least %d elements", path, spec.minLen)
		}
		for i, ev := range arr {
			if err := validateValue(fmt.Sprintf("%s[%d]", path, i), ev, *spec.elem); err != nil {
				return err
			}
		}
	}
	return nil
}

// 認証なしで丸ごと置き換えるので、壊れた形が DB に残ると配信先のフロントが
// wire スキーマで読めず、再接続のたびに同じ失敗になる。menus や comments の
// 要素まで、フロントが読める形かを確かめる
func validateEdittingOrder(order map[string]interface{}) error {
	return validateValue("editting_order", order, edittingOrderSpec)
}

func findCashierState(db *gorm.DB) (*models.CashierState, error) {
	var state models.CashierState
	if err := db.First(&state, "id = ?", models.CashierStateID).Error; err != nil {
		return nil, err
	}
	return &state, nil
}

// GET /api/cashier-state - レジ状態取得
//
// まだ一度も同期されていなければ 404。フロントは「無い」として扱う。
func (h *CashierStateHandler) GetCashierState(c *gin.Context) {
	state, err := findCashierState(h.db)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "cashier state not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	resp, err := toCashierStateResponse(state)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, resp)
}

// PUT /api/cashier-state - レジ状態更新
//
// 単一行を丸ごと置き換える。レジはキー入力のたびに呼ぶので upsert 1 回で済ませ、
// 成功したら WebSocket の全クライアントへ流す。
func (h *CashierStateHandler) UpdateCashierState(c *gin.Context) {
	var req models.CashierStateUpdateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.EdittingOrder == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "editting_order is required"})
		return
	}

	raw, err := json.Marshal(req.EdittingOrder)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := validateEdittingOrder(req.EdittingOrder); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	state := models.CashierState{
		ID:               models.CashierStateID,
		EdittingOrder:    models.JSONB(raw),
		SubmittedOrderID: (*uuid.UUID)(req.SubmittedOrderId),
		UpdatedAt:        time.Now(),
	}

	resp, err := h.saveAndBroadcast(&state)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, resp)
}

// upsert して、保存した内容をそのまま配信する。DB から読み直すと並行する PUT の
// 結果と入れ違いうるので読み直さない
func (h *CashierStateHandler) saveAndBroadcast(state *models.CashierState) (models.CashierStateResponse, error) {
	cashierStateMu.Lock()
	defer cashierStateMu.Unlock()

	if err := h.db.
		Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "id"}},
			UpdateAll: true,
		}).
		Create(state).Error; err != nil {
		return models.CashierStateResponse{}, err
	}

	resp, err := toCashierStateResponse(state)
	if err != nil {
		return models.CashierStateResponse{}, err
	}

	h.hub.Broadcast(WSMessage{
		Type:         WSMessageTypeCashierState,
		CashierState: &resp,
	})
	return resp, nil
}

// 現在のレジ状態を、接続直後の初期データとして WSMessage にする。まだ無ければ ok = false。
//
// 読んでいる間に PUT が来ても、その配信は Client が初期データのあとに流すので、
// 古い状態のまま残ることはない（hub.go の SendInitial を参照）。
func cashierStateMessage(db *gorm.DB) (WSMessage, bool) {
	state, err := findCashierState(db)
	if err != nil {
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			log.Println("failed to load cashier state:", err)
		}
		return WSMessage{}, false
	}

	resp, err := toCashierStateResponse(state)
	if err != nil {
		log.Println("failed to convert cashier state:", err)
		return WSMessage{}, false
	}

	return WSMessage{
		Type:         WSMessageTypeCashierState,
		CashierState: &resp,
	}, true
}
