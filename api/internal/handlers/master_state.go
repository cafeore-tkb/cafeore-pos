// api/internal/handlers/master_state.go
package handlers

import (
	"errors"
	"log"
	"net/http"
	"time"

	"cafeore-pos/api/internal/models"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type MasterStateHandler struct {
	db  *gorm.DB
	hub *Hub
}

func NewMasterStateHandler(db *gorm.DB, hub *Hub) *MasterStateHandler {
	return &MasterStateHandler{db: db, hub: hub}
}

func toMasterStateResponse(masterState *models.MasterState) models.MasterStateResponse {
	return models.MasterStateResponse{
		CreatedAt: masterState.CreatedAt,
		Type:      masterState.Type,
	}
}

// GET /api/master-status - オーダーストップの記録の一覧（古い順）
func (h *MasterStateHandler) GetMasterStatus(c *gin.Context) {
	var masterStatus []models.MasterState
	if err := h.db.Order("created_at ASC").Find(&masterStatus).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// API型に変換
	responses := make([]models.MasterStateResponse, len(masterStatus))
	for i := range masterStatus {
		responses[i] = toMasterStateResponse(&masterStatus[i])
	}

	c.JSON(http.StatusOK, responses)
}

// POST /api/master-status - オーダーストップ・再開
func (h *MasterStateHandler) UpdateMasterStatus(c *gin.Context) {
	var req models.MasterStateUpdateRequest

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.Type != models.Stop && req.Type != models.Operational {
		c.JSON(http.StatusBadRequest, gin.H{"error": `type は "stop" か "operational" にしてください`})
		return
	}

	state := models.MasterState{
		Type:      string(req.Type),
		CreatedAt: time.Now(),
	}

	if err := h.db.Create(&state).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, toMasterStateResponse(&state))
	h.broadcastMasterState()
}

// 最新の状態を読み直して配信する。同時に切り替えられても、読み込みと配信を1つずつ行うので
// 最後に届くのは DB の最新になる
func (h *MasterStateHandler) broadcastMasterState() {
	err := h.hub.Publish(func() (WSMessage, error) {
		msg, ok := masterStateMessage(h.db)
		if !ok {
			return WSMessage{}, errors.New("master state not found")
		}
		return msg, nil
	})
	if err != nil {
		log.Println("failed to broadcast master state:", err)
	}
}
