// api/internal/handlers/color_setting.go
package handlers

import (
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
	openapi_types "github.com/oapi-codegen/runtime/types"
	"gorm.io/gorm"

	"cafeore-pos/api/internal/models"
)

type ColorSettingHandler struct {
	db *gorm.DB
}

func NewColorSettingHandler(db *gorm.DB) *ColorSettingHandler {
	return &ColorSettingHandler{db: db}
}

func toColorSettingResponse(setting *models.ColorSetting) models.ColorSettingResponse {
	return models.ColorSettingResponse{
		Id:         openapi_types.UUID(setting.ID),
		TargetType: models.ColorTargetType(setting.TargetType),
		TargetId:   openapi_types.UUID(setting.TargetID),
		Screen:     models.ColorScreen(setting.Screen),
		Color:      setting.Color,
	}
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
