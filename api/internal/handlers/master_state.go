// api/internal/handlers/master_state.go
package handlers

import (
	"errors"
	"net/http"
	"time"

	"cafeore-pos/api/internal/models"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type MasterStateHandler struct {
	db *gorm.DB
	hub *Hub
}

func NewMasterStateHandler(db *gorm.DB, hub *Hub) *MasterStateHandler {
	return &MasterStateHandler{db: db, hub: hub}
}

func toMasterStateResponse(masterState *models.MasterState) models.MasterStateResponse {
	return models.MasterStateResponse{
		CreatedAt: masterState.CreatedAt,
		Type:    masterState.Type,
	}
}

// GET /api/master-status - オーダー状態取得
func (h *MasterStateHandler) GetMasterStatus(c *gin.Context) {
	var masterStatus []models.MasterState
	if err := h.db.Find(&masterStatus).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// API型に変換
	responses := make([]models.MasterStateResponse, len(masterStatus))
	for i, masterState := range masterStatus {
		responses[i] = toMasterStateResponse(&masterState)
	}

	c.JSON(http.StatusOK, responses)
}

// POST /api/master-status - オーダー状態更新
func (h *MasterStateHandler) UpdateMasterStatus(c *gin.Context) {
	var req models.MasterStateUpdateRequest

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	state := models.MasterState{
		Type:      req.Type,
		CreatedAt: time.Now(),
	}

	if err := h.db.Create(&state).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, state)
	broadcastMasterState(h.db, h.hub)
	// ほかのインスタンスにつないでいる画面にも届くよう、DB の通知で知らせる（order_listener.go）
	notifyMasterStateChanged(h.db)
}

// 最新のオーダーストップの状態を読み直して、このインスタンスにつないでいる画面へだけ配る。
//
// ほかのインスタンスからの通知で配り直すときも使う。Publish で読み込みから配信までを
// 1つずつ行い、POST での配信と通知での配信が入れ違って古い状態が後から届かないようにする。
func broadcastMasterState(db *gorm.DB, hub *Hub) {
	_ = hub.Publish(func() (WSMessage, error) {
		msg, ok := masterStateMessage(db)
		if !ok {
			return WSMessage{}, errors.New("no master state")
		}
		return msg, nil
	})
}
