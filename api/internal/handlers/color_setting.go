// api/internal/handlers/color_setting.go
package handlers

import (
	"errors"
	"log"
	"net/http"
	"regexp"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	openapi_types "github.com/oapi-codegen/runtime/types"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"cafeore-pos/api/internal/models"
	"cafeore-pos/api/internal/notify"
)

type ColorSettingHandler struct {
	db       *gorm.DB
	activity *notify.Activity
}

func NewColorSettingHandler(db *gorm.DB, activity *notify.Activity) *ColorSettingHandler {
	return &ColorSettingHandler{db: db, activity: activity}
}

// 通知に出す対象の名前。消えた対象も名前で出したいので論理削除も含めて探す
func (h *ColorSettingHandler) targetName(setting *models.ColorSetting) string {
	if setting.TargetType == string(models.ColorTargetTypeItemType) {
		var itemType models.ItemType
		if h.db.Unscoped().First(&itemType, "id = ?", setting.TargetID).Error == nil {
			return itemType.DisplayName
		}
	} else {
		var item models.Item
		if h.db.Unscoped().First(&item, "id = ?", setting.TargetID).Error == nil {
			return item.Name
		}
	}
	return setting.TargetID.String()
}

var colorPattern = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

func toColorSettingResponse(setting *models.ColorSetting) models.ColorSettingResponse {
	return models.ColorSettingResponse{
		Id:         openapi_types.UUID(setting.ID),
		TargetType: models.ColorTargetType(setting.TargetType),
		TargetId:   openapi_types.UUID(setting.TargetID),
		Screen:     models.ColorScreen(setting.Screen),
		Color:      setting.Color,
	}
}

// リクエストを検証して DB モデルに変換する。色は小文字にそろえる。
func buildColorSetting(request models.ColorSettingUpsertRequest) (models.ColorSetting, error) {
	switch request.TargetType {
	case models.ColorTargetTypeItem, models.ColorTargetTypeItemType:
	default:
		return models.ColorSetting{}, errors.New("target_type must be Item or ItemType")
	}
	switch request.Screen {
	case models.ColorScreenCashier, models.ColorScreenCashierOrder, models.ColorScreenMaster, models.ColorScreenServe:
	default:
		return models.ColorSetting{}, errors.New("screen must be cashier, cashier_order, master or serve")
	}
	if !colorPattern.MatchString(request.Color) {
		return models.ColorSetting{}, errors.New("color must be #RRGGBB")
	}
	targetID := uuid.UUID(request.TargetId)
	if targetID == uuid.Nil {
		return models.ColorSetting{}, errors.New("target_id is required")
	}

	return models.ColorSetting{
		TargetType: string(request.TargetType),
		TargetID:   targetID,
		Screen:     string(request.Screen),
		Color:      strings.ToLower(request.Color),
	}, nil
}

// 対象と画面の組が既にあれば色だけ上書きする。
func upsertColorSetting(db *gorm.DB, setting *models.ColorSetting) *gorm.DB {
	return db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "target_type"}, {Name: "target_id"}, {Name: "screen"}},
		DoUpdates: clause.AssignmentColumns([]string{"color", "updated_at"}),
	}).Create(setting)
}

var errColorTargetNotFound = errors.New("target not found")

// 設定先の Item / ItemType が存在する（論理削除されていない）か確かめ、その行を押さえる。
// 同じ対象への保存はここで順に並ぶので、変更前の読み込みと保存の間に別の保存が入らない。
func lockColorTarget(tx *gorm.DB, setting *models.ColorSetting) error {
	var target any = &models.Item{}
	if setting.TargetType == string(models.ColorTargetTypeItemType) {
		target = &models.ItemType{}
	}
	// 無いときに「record not found」をログに出さないよう、First ではなく Find で読む
	result := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Select("id").Limit(1).Find(target, "id = ?", setting.TargetID)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return errColorTargetNotFound
	}
	return nil
}

// GET /api/color-settings - 背景色設定一覧取得
func (h *ColorSettingHandler) GetColorSettings(c *gin.Context) {
	var settings []models.ColorSetting
	if err := h.db.Order("target_type, target_id, screen").Find(&settings).Error; err != nil {
		// DB のエラー文は外に出さず、ログにだけ残す
		log.Printf("failed to get color settings: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal server error"})
		return
	}

	responses := make([]models.ColorSettingResponse, len(settings))
	for i := range settings {
		responses[i] = toColorSettingResponse(&settings[i])
	}
	c.JSON(http.StatusOK, responses)
}

// PUT /api/color-settings - 背景色設定の作成・更新
func (h *ColorSettingHandler) UpsertColorSetting(c *gin.Context) {
	var request models.UpsertColorSettingJSONRequestBody
	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	setting, err := buildColorSetting(request)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var before, saved models.ColorSetting
	err = h.db.Transaction(func(tx *gorm.DB) error {
		if err := lockColorTarget(tx, &setting); err != nil {
			return err
		}
		// 通知で追加か変更かを分けるために読んでおく。追加なら無いのが普通なので、
		// First で「record not found」をログに出さないよう Find で読む
		if err := tx.Limit(1).Find(&before, "target_type = ? AND target_id = ? AND screen = ?",
			setting.TargetType, setting.TargetID, setting.Screen).Error; err != nil {
			return err
		}
		if err := upsertColorSetting(tx, &setting).Error; err != nil {
			return err
		}
		// 更新になった場合は既存行の ID を返したいので、一意キーで読み直す。
		return tx.First(&saved, "target_type = ? AND target_id = ? AND screen = ?",
			setting.TargetType, setting.TargetID, setting.Screen).Error
	})
	if errors.Is(err, errColorTargetNotFound) {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, toColorSettingResponse(&saved))
	// 同じ色で保存し直しただけなら文面が空になり、通知しない
	h.activity.Post(colorSettingSavedMessage(h.targetName(&saved), &before, &saved))
}

// DELETE /api/color-settings/:id - 背景色設定削除
func (h *ColorSettingHandler) DeleteColorSetting(c *gin.Context) {
	settingID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid ID format"})
		return
	}

	// 消した行は通知に対象を出すために RETURNING で受け取る
	var deleted models.ColorSetting
	result := h.db.Clauses(clause.Returning{}).Delete(&deleted, "id = ?", settingID)
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": result.Error.Error()})
		return
	}
	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "ColorSetting not found"})
		return
	}
	c.Status(http.StatusNoContent)
	h.activity.Post(colorSettingDeletedMessage(h.targetName(&deleted), &deleted))
}
