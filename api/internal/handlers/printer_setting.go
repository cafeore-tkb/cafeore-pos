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
		LabelPrinterIp:             setting.LabelPrinterIP,
		ReceiptPrinterIp:           setting.ReceiptPrinterIP,
		ReceiptPrinterModel:        models.ReceiptPrinterModel(setting.ReceiptPrinterModel),
		LabelPrinterPaperWidth:     models.PrinterPaperWidth(setting.LabelPrinterPaperWidth),
		ReceiptPrinterPaperWidth:   models.PrinterPaperWidth(setting.ReceiptPrinterPaperWidth),
		LabelPrinterPaperType:      models.PrinterPaperType(setting.LabelPrinterPaperType),
		ReceiptPrinterPaperType:    models.PrinterPaperType(setting.ReceiptPrinterPaperType),
		LabelPrinterLabelLengthMm:  setting.LabelPrinterLabelLengthMm,
		LabelPrinterPrintWidthDots: setting.LabelPrinterPrintWidthDots,
		LabelPrinterMarginMm:       setting.LabelPrinterMarginMm,
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

// 知っている用紙の種類か確かめる。
func validatePaperType(field string, value models.PrinterPaperType) error {
	switch value {
	case models.PrinterPaperTypeReceipt, models.PrinterPaperTypeDieCutLabel:
		return nil
	}
	return fmt.Errorf("%s must be receipt or die_cut_label", field)
}

// ラベル用のシールの大きさの範囲（openapi.yaml と同じ）。1mm は 8 ドット。
const (
	labelLengthMinMm       = 5
	labelLengthMaxMm       = 100
	labelPrintWidthMinDots = 64
	labelPrintWidthMaxDots = 576
	labelMarginMaxMm       = 10
	// 余白の内側に、縦にも横にもこれだけは残す（レジの paper.ts の labelGeometry も同じだけ残す）
	labelPrintableMinMm = 2
	dotsPerMm           = 8
)

// ラベル用のシールの大きさが受け付けられる範囲か確かめる。
// 範囲の比べ方は、NaN も弾けるよう「範囲の中にない」で書く。
func validateLabelSize(lengthMm float64, widthDots int, marginMm float64) error {
	if !(lengthMm >= labelLengthMinMm && lengthMm <= labelLengthMaxMm) {
		return fmt.Errorf("label_printer_label_length_mm must be between %d and %d", labelLengthMinMm, labelLengthMaxMm)
	}
	if widthDots < labelPrintWidthMinDots || widthDots > labelPrintWidthMaxDots || widthDots%dotsPerMm != 0 {
		return fmt.Errorf("label_printer_print_width_dots must be a multiple of %d between %d and %d", dotsPerMm, labelPrintWidthMinDots, labelPrintWidthMaxDots)
	}
	if !(marginMm >= 0 && marginMm <= labelMarginMaxMm) {
		return fmt.Errorf("label_printer_margin_mm must be between 0 and %d", labelMarginMaxMm)
	}
	shorter := min(lengthMm, float64(widthDots)/dotsPerMm)
	if marginMm*2 > shorter-labelPrintableMinMm {
		return errors.New("label_printer_margin_mm leaves no room to print")
	}
	return nil
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
	if err := validatePaperType("label_printer_paper_type", request.LabelPrinterPaperType); err != nil {
		return models.PrinterSetting{}, err
	}
	if err := validatePaperType("receipt_printer_paper_type", request.ReceiptPrinterPaperType); err != nil {
		return models.PrinterSetting{}, err
	}
	if err := validateLabelSize(request.LabelPrinterLabelLengthMm, request.LabelPrinterPrintWidthDots, request.LabelPrinterMarginMm); err != nil {
		return models.PrinterSetting{}, err
	}
	return models.PrinterSetting{
		ID:                         models.PrinterSettingID,
		LabelPrinterIP:             label,
		ReceiptPrinterIP:           receipt,
		ReceiptPrinterModel:        string(request.ReceiptPrinterModel),
		LabelPrinterPaperWidth:     string(request.LabelPrinterPaperWidth),
		ReceiptPrinterPaperWidth:   string(request.ReceiptPrinterPaperWidth),
		LabelPrinterPaperType:      string(request.LabelPrinterPaperType),
		ReceiptPrinterPaperType:    string(request.ReceiptPrinterPaperType),
		LabelPrinterLabelLengthMm:  request.LabelPrinterLabelLengthMm,
		LabelPrinterPrintWidthDots: request.LabelPrinterPrintWidthDots,
		LabelPrinterMarginMm:       request.LabelPrinterMarginMm,
		UpdatedAt:                  time.Now(),
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
