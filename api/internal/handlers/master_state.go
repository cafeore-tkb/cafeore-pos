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
	if err := h.db.Order("created_at ASC").Find(&masterStatus).Error; err != nil {
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

	if (req.Type != models.Stop && req.Type != models.Operational) || (req.Expected != nil && req.Expected.Type != "stop" && req.Expected.Type != "operational") {
		c.JSON(http.StatusBadRequest, gin.H{"error": `type は "stop" か "operational" にしてください`})
		return
	}

	var state models.MasterState
	changed := false
	conflict := errors.New("受付状態が変わりました。最新の状態を確認してください")
	err := h.db.Transaction(func(tx *gorm.DB) error {
		// 古いマスター画面からの更新も同じロックを取り、比較と保存を一体にする。
		if err := tx.Exec("SELECT pg_advisory_xact_lock(hashtext(?))", "pos:master-state").Error; err != nil {
			return err
		}
		var last models.MasterState
		if err := tx.Order("created_at DESC").Limit(1).Find(&last).Error; err != nil {
			return err
		}
		exists := !last.CreatedAt.IsZero()
		if expected := req.Expected; expected != nil {
			if !exists {
				if expected.CreatedAt != nil || expected.Type != "operational" {
					return conflict
				}
			} else if expected.CreatedAt == nil || !expected.CreatedAt.Equal(last.CreatedAt) || string(expected.Type) != last.Type {
				return conflict
			}
		}
		if exists && last.Type == string(req.Type) {
			state = last
			return nil
		}
		at := time.Now().UTC().Truncate(time.Microsecond)
		if exists && !at.After(last.CreatedAt) {
			at = last.CreatedAt.Add(time.Microsecond)
		}
		state = models.MasterState{Type: string(req.Type), CreatedAt: at}
		if err := tx.Create(&state).Error; err != nil {
			return err
		}
		changed = true
		return nil
	})
	if err != nil {
		code := http.StatusInternalServerError
		if errors.Is(err, conflict) {
			code = http.StatusConflict
		}
		c.JSON(code, gin.H{"error": err.Error()})
		return
	}

	// GET と同じ形で返す。models.MasterState は json タグが無く、そのままだと "Type" のような大文字のキーになる
	c.JSON(http.StatusCreated, toMasterStateResponse(&state))
	broadcastMasterState(h.db, h.hub)
	// ほかのインスタンスにつないでいる画面にも届くよう、DB の通知で知らせる（order_listener.go）
	notifyMasterStateChanged(h.db)
	if changed {
		h.activity.Post(masterStateChangedMessage(state.Type))
	}
}

// 最新のオーダーストップの状態を読み直して、このインスタンスにつないでいる画面へだけ配る。
//
// ほかのインスタンスからの通知で配り直すときも使う。Publish で読み込みから配信までを
// 1つずつ行い、POST での配信と通知での配信が入れ違って古い状態が後から届かないようにする。
func broadcastMasterState(db *gorm.DB, hub *Hub) {
	err := hub.Publish(func() (WSMessage, error) {
		msg, ok := masterStateMessage(db)
		if !ok {
			return WSMessage{}, errors.New("no master state")
		}
		return msg, nil
	})
	if err != nil {
		log.Println("failed to broadcast master state:", err)
	}
}
