// api/internal/handlers/printer_setting.go
package handlers

import (
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/netip"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"cafeore-pos/api/internal/models"
)

type PrinterSettingHandler struct {
	db *gorm.DB
}

func NewPrinterSettingHandler(db *gorm.DB) *PrinterSettingHandler {
	return &PrinterSettingHandler{db: db}
}

func toPrinterSettingsResponse(setting *models.PrinterSetting) models.PrinterSettingsResponse {
	return models.PrinterSettingsResponse{
		LabelPrinterIp:           setting.LabelPrinterIP,
		ReceiptPrinterIp:         setting.ReceiptPrinterIP,
		ReceiptPrinterModel:      models.ReceiptPrinterModel(setting.ReceiptPrinterModel),
		LabelPrinterPaperWidth:   models.PrinterPaperWidth(setting.LabelPrinterPaperWidth),
		ReceiptPrinterPaperWidth: models.PrinterPaperWidth(setting.ReceiptPrinterPaperWidth),
	}
}

// IPv4 アドレスとして読めるか確かめ、書き方をそろえる（前後の空白を除く）。
// ePOS-Print の SDK に渡すので、ホスト名や IPv6 は受け付けない。
func parsePrinterIP(field, value string) (string, error) {
	addr, err := netip.ParseAddr(strings.TrimSpace(value))
	if err != nil || !addr.Is4() {
		return "", fmt.Errorf("%s must be an IPv4 address", field)
	}
	return addr.String(), nil
}

// 知っている用紙の幅か確かめる。
func validatePaperWidth(field string, value models.PrinterPaperWidth) error {
	switch value {
	case models.PrinterPaperWidth58mm, models.PrinterPaperWidth80mm:
		return nil
	}
	return fmt.Errorf("%s must be 58mm or 80mm", field)
}

// リクエストを検証して DB モデルに変換する。
func buildPrinterSetting(request models.PrinterSettingsUpdateRequest) (models.PrinterSetting, error) {
	label, err := parsePrinterIP("label_printer_ip", request.LabelPrinterIp)
	if err != nil {
		return models.PrinterSetting{}, err
	}
	receipt, err := parsePrinterIP("receipt_printer_ip", request.ReceiptPrinterIp)
	if err != nil {
		return models.PrinterSetting{}, err
	}
	switch request.ReceiptPrinterModel {
	case models.ReceiptPrinterModelTmL90, models.ReceiptPrinterModelTmM30:
	default:
		return models.PrinterSetting{}, errors.New("receipt_printer_model must be tm_l90 or tm_m30")
	}
	if err := validatePaperWidth("label_printer_paper_width", request.LabelPrinterPaperWidth); err != nil {
		return models.PrinterSetting{}, err
	}
	if err := validatePaperWidth("receipt_printer_paper_width", request.ReceiptPrinterPaperWidth); err != nil {
		return models.PrinterSetting{}, err
	}
	return models.PrinterSetting{
		ID:                       models.PrinterSettingID,
		LabelPrinterIP:           label,
		ReceiptPrinterIP:         receipt,
		ReceiptPrinterModel:      string(request.ReceiptPrinterModel),
		LabelPrinterPaperWidth:   string(request.LabelPrinterPaperWidth),
		ReceiptPrinterPaperWidth: string(request.ReceiptPrinterPaperWidth),
		UpdatedAt:                time.Now(),
	}, nil
}

// GET /api/printer-settings - プリンター設定取得
//
// まだ一度も保存していなければ既定値を返す（レジは何もしなくても既定のプリンターにつなぐ）。
func (h *PrinterSettingHandler) GetPrinterSettings(c *gin.Context) {
	// レジを開くたびに呼ぶので、保存前でも record not found をログに出さない Find で読む
	var saved models.PrinterSetting
	result := h.db.Limit(1).Find(&saved, "id = ?", models.PrinterSettingID)
	if result.Error != nil {
		log.Printf("failed to get printer settings: %v", result.Error)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal server error"})
		return
	}
	setting := models.DefaultPrinterSetting()
	if result.RowsAffected > 0 {
		setting = saved
	}
	c.JSON(http.StatusOK, toPrinterSettingsResponse(&setting))
}

// PUT /api/printer-settings - プリンター設定の更新
//
// 単一行を丸ごと置き換える。
func (h *PrinterSettingHandler) UpdatePrinterSettings(c *gin.Context) {
	var request models.UpdatePrinterSettingsJSONRequestBody
	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	setting, err := buildPrinterSetting(request)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := h.db.Clauses(clause.OnConflict{UpdateAll: true}).Create(&setting).Error; err != nil {
		log.Printf("failed to save printer settings: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal server error"})
		return
	}
	c.JSON(http.StatusOK, toPrinterSettingsResponse(&setting))
}
