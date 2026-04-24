// api/internal/handlers/master_state.go
package handlers

import (
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

func NewMasterStateHandler(db *gorm.DB) *MasterStateHandler {
	return &MasterStateHandler{db: db}
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
	h.broadcastMasterState()
}

func (h *MasterStateHandler) broadcastMasterState() {
	var state models.MasterState

	if err := h.db.
		Order("created_at DESC").
		First(&state).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return
		}
		return
	}

	h.hub.Broadcast(WSMessage{
		Type:        WSMessageTypeMasterState,
		MasterState: &state,
	})
}
