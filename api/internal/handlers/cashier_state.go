// api/internal/handlers/cashier_state.go
package handlers

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
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

// editting_order が持つべきキー。フロントの orderSchema のうち optional でないもの。
// id は保存前の注文には無いので含めない。
var edittingOrderKeys = []struct {
	name     string
	nullable bool
}{
	{"orderId", false},
	{"createdAt", false},
	{"readyAt", true},
	{"servedAt", true},
	{"menus", false},
	{"total", false},
	{"comments", false},
	{"billingAmount", false},
	{"received", false},
	{"discountOrderId", true},
	{"discountOrderCups", false},
	{"DISCOUNT_PER_CUP", false},
	{"discount", false},
	{"estimateTime", false},
}

// 型を確かめるためだけの受け皿。null は上で弾いているのでポインタにしない
type edittingOrderShape struct {
	OrderID           float64           `json:"orderId"`
	CreatedAt         time.Time         `json:"createdAt"`
	ReadyAt           *time.Time        `json:"readyAt"`
	ServedAt          *time.Time        `json:"servedAt"`
	Menus             []json.RawMessage `json:"menus"`
	Total             float64           `json:"total"`
	Comments          []json.RawMessage `json:"comments"`
	BillingAmount     float64           `json:"billingAmount"`
	Received          float64           `json:"received"`
	DiscountOrderID   *float64          `json:"discountOrderId"`
	DiscountOrderCups float64           `json:"discountOrderCups"`
	DiscountPerCup    float64           `json:"DISCOUNT_PER_CUP"`
	Discount          float64           `json:"discount"`
	EstimateTime      float64           `json:"estimateTime"`
}

// 認証なしで丸ごと置き換えるので、壊れた形が DB に残ると配信先のフロントが
// 読めないまま再接続のたびに失敗する。上の階層のキーと型だけ確かめる
func validateEdittingOrder(order map[string]interface{}, raw []byte) error {
	for _, key := range edittingOrderKeys {
		v, ok := order[key.name]
		if !ok || (v == nil && !key.nullable) {
			return fmt.Errorf("editting_order.%s is required", key.name)
		}
	}

	var shape edittingOrderShape
	if err := json.Unmarshal(raw, &shape); err != nil {
		return fmt.Errorf("editting_order is invalid: %w", err)
	}
	return nil
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
	if err := validateEdittingOrder(req.EdittingOrder, raw); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	state := models.CashierState{
		ID:               models.CashierStateID,
		EdittingOrder:    models.JSONB(raw),
		SubmittedOrderID: (*uuid.UUID)(req.SubmittedOrderId),
		UpdatedAt:        time.Now(),
	}

	if err := h.db.
		Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "id"}},
			UpdateAll: true,
		}).
		Create(&state).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	resp, err := toCashierStateResponse(&state)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, resp)
	broadcastCashierState(h.db, h.hub)
}

// 現在のレジ状態を WebSocket の全クライアントへ流す。
// まだ無ければ何も流さない（接続直後の初期送信でも同じ）。
func broadcastCashierState(db *gorm.DB, hub *Hub) {
	state, err := findCashierState(db)
	if err != nil {
		return
	}

	resp, err := toCashierStateResponse(state)
	if err != nil {
		return
	}

	hub.Broadcast(WSMessage{
		Type:         WSMessageTypeCashierState,
		CashierState: &resp,
	})
}
