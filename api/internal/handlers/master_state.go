// api/internal/handlers/master_state.go
package handlers

import (
	"errors"
	"log"
	"net/http"
	"time"

	"cafeore-pos/api/internal/models"
	"cafeore-pos/api/internal/notify"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type MasterStateHandler struct {
	db       *gorm.DB
	hub      *Hub
	activity *notify.Activity
}

func NewMasterStateHandler(db *gorm.DB, hub *Hub, activity *notify.Activity) *MasterStateHandler {
	return &MasterStateHandler{db: db, hub: hub, activity: activity}
}

func toMasterStateResponse(masterState *models.MasterState) models.MasterStateResponse {
	return models.MasterStateResponse{
		CreatedAt: masterState.CreatedAt,
		Type:      masterState.Type,
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

	if req.Type != models.Stop && req.Type != models.Operational {
		c.JSON(http.StatusBadRequest, gin.H{"error": `type は "stop" か "operational" にしてください`})
		return
	}

	// 同じ状態を続けて送られたときは通知しない。初めてなら無いのが普通なので、
	// First で「record not found」をログに出さないよう Find で読む。
	// 読めなかったら空と比べた誤った通知になるので、通知だけしない
	var last models.MasterState
	lastErr := h.db.Order("created_at DESC").Limit(1).Find(&last).Error
	if lastErr != nil {
		log.Printf("activity: failed to load master state before update: %v", lastErr)
	}

	state := models.MasterState{
		Type:      string(req.Type),
		CreatedAt: time.Now(),
	}

	if err := h.db.Create(&state).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// GET と同じ形で返す。models.MasterState は json タグが無く、そのままだと "Type" のような大文字のキーになる
	c.JSON(http.StatusCreated, toMasterStateResponse(&state))
	broadcastMasterState(h.db, h.hub)
	// ほかのインスタンスにつないでいる画面にも届くよう、DB の通知で知らせる（order_listener.go）
	notifyMasterStateChanged(h.db)
	if lastErr == nil && last.Type != state.Type {
		h.activity.Post(masterStateChangedMessage(state.Type))
	}
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
