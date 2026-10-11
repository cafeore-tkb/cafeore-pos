// api/internal/handlers/square_device.go
package handlers

import (
	"cmp"
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	openapi_types "github.com/oapi-codegen/runtime/types"
	"gorm.io/gorm"

	"cafeore-pos/api/internal/models"
	"cafeore-pos/api/internal/square"
)

// 端末のペアリングの状態。Square の Device Code の status と同じ値。
const (
	squareDeviceUnpaired = string(models.UNPAIRED)
	squareDevicePaired   = string(models.PAIRED)
	squareDeviceExpired  = string(models.EXPIRED)
)

const (
	// Terminal API で決済画面を出す端末としてペアリングする。
	squareDeviceProductType   = "TERMINAL_API"
	squareDeviceNameMaxLength = 64
	squareDeviceIDMaxLength   = 255
	// 取り込んだコードに名前が無かったときの名前。
	squareDeviceDefaultName = "Square Terminal"
)

var errSquareDeviceNotRegistered = errors.New("この端末は登録されていません。Square 端末の管理画面で確かめてください")

// --------------------------------------------------
// 状態の判定（純粋な関数）
// --------------------------------------------------

// squareDeviceStatusFor は Square の Device Code の status を、こちらの状態に揃える。
// UNKNOWN など知らない値は、まだペアリングされていないものとして扱う。
func squareDeviceStatusFor(codeStatus string) string {
	switch codeStatus {
	case squareDevicePaired, squareDeviceExpired:
		return codeStatus
	default:
		return squareDeviceUnpaired
	}
}

// parseSquareTime は Square の日時（RFC 3339）を読む。空や読めない値は nil。
func parseSquareTime(value string) *time.Time {
	if value == "" {
		return nil
	}
	parsed, err := time.Parse(time.RFC3339, value)
	if err != nil {
		return nil
	}
	return &parsed
}

// squareCodePairedAt はコードがペアリングされた日時。分からなければゼロ値。
func squareCodePairedAt(code square.DeviceCode) time.Time {
	for _, value := range []string{code.StatusChangedAt, code.CreatedAt} {
		if parsed := parseSquareTime(value); parsed != nil {
			return *parsed
		}
	}
	return time.Time{}
}

// latestPairedCodes は、端末ごとに最後にペアリングしたコードを選ぶ。
// 同じ端末を何度もペアリングすると、同じ device_id のコードが複数残るため。
// ペアリングされていないコードは除き、ペアリングした順に返す。
func latestPairedCodes(codes []square.DeviceCode) []square.DeviceCode {
	latest := map[string]square.DeviceCode{}
	for _, code := range codes {
		if code.DeviceID == "" || squareDeviceStatusFor(code.Status) != squareDevicePaired {
			continue
		}
		current, ok := latest[code.DeviceID]
		if !ok || squareCodePairedAt(code).After(squareCodePairedAt(current)) {
			latest[code.DeviceID] = code
		}
	}
	result := make([]square.DeviceCode, 0, len(latest))
	for _, code := range latest {
		result = append(result, code)
	}
	slices.SortFunc(result, func(a, b square.DeviceCode) int {
		if byTime := squareCodePairedAt(a).Compare(squareCodePairedAt(b)); byTime != 0 {
			return byTime
		}
		return cmp.Compare(a.DeviceID, b.DeviceID)
	})
	return result
}

func validateSquareDeviceName(name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" || utf8.RuneCountInString(name) > squareDeviceNameMaxLength {
		return "", fmt.Errorf("名前は 1〜%d 文字にしてください", squareDeviceNameMaxLength)
	}
	return name, nil
}

func toSquareDeviceResponse(device *models.SquareDevice) models.SquareDeviceResponse {
	response := models.SquareDeviceResponse{
		Id:        openapi_types.UUID(device.ID),
		Name:      device.Name,
		Status:    models.SquareDeviceStatus(device.Status),
		DeviceId:  device.DeviceID,
		PairBy:    device.PairBy,
		CreatedAt: device.CreatedAt,
		UpdatedAt: device.UpdatedAt,
	}
	// コードはペアリングに使う間だけ見せる。
	if device.Status == squareDeviceUnpaired {
		response.Code = device.Code
	}
	return response
}

func toSquareDeviceResponses(devices []models.SquareDevice) []models.SquareDeviceResponse {
	responses := make([]models.SquareDeviceResponse, len(devices))
	for i := range devices {
		responses[i] = toSquareDeviceResponse(&devices[i])
	}
	return responses
}

// --------------------------------------------------
// DB の操作
// --------------------------------------------------

// isRegisteredSquareDevice は device_id がペアリング済みの端末として登録されているかを返す。
func isRegisteredSquareDevice(db *gorm.DB, deviceID string) (bool, error) {
	var count int64
	err := db.Model(&models.SquareDevice{}).
		Where("device_id = ? AND status = ?", deviceID, squareDevicePaired).
		Count(&count).Error
	return count > 0, err
}

// markSquareDevicePaired は行を PAIRED にして device_id を記録する。
// 同じ端末の別の行（ペアリングし直す前の行）は消す。device_id は一意なので、
// 残すと記録できない。レジは device_id で端末を覚えているので、選び直しは要らない。
func markSquareDevicePaired(db *gorm.DB, device *models.SquareDevice, deviceID string) error {
	return db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("device_id = ? AND id <> ?", deviceID, device.ID).Delete(&models.SquareDevice{}).Error; err != nil {
			return err
		}
		device.Status = squareDevicePaired
		device.DeviceID = &deviceID
		device.Code = nil
		return tx.Model(device).Select("Status", "DeviceID", "Code", "UpdatedAt").Updates(device).Error
	})
}

// importSquareDevice は Square でペアリング済みのコードを 1 件取り込む。
// その端末が既に登録されていれば何もせず nil を返す。
func importSquareDevice(tx *gorm.DB, code square.DeviceCode) (*models.SquareDevice, error) {
	var count int64
	if err := tx.Model(&models.SquareDevice{}).Where("device_id = ?", code.DeviceID).Count(&count).Error; err != nil {
		return nil, err
	}
	if count > 0 {
		return nil, nil
	}

	// 管理画面で発行したコードが、一覧を取り直す前にペアリングされていた。その行を使う。
	if code.ID != "" {
		var pending models.SquareDevice
		err := tx.Where("code_id = ?", code.ID).First(&pending).Error
		if err == nil {
			if err := markSquareDevicePaired(tx, &pending, code.DeviceID); err != nil {
				return nil, err
			}
			return &pending, nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, err
		}
	}

	name := strings.TrimSpace(code.Name)
	if name == "" {
		name = squareDeviceDefaultName
	}
	deviceID := code.DeviceID
	device := models.SquareDevice{Name: name, Status: squareDevicePaired, DeviceID: &deviceID}
	if code.ID != "" {
		codeID := code.ID
		device.CodeID = &codeID
	}
	if err := tx.Create(&device).Error; err != nil {
		return nil, err
	}
	return &device, nil
}

// refreshPairing はペアリング待ちの行を Square に問い合わせ、済んでいれば device_id を記録する。
// 問い合わせに失敗しても何もしない（管理画面は数秒おきに一覧を取り直すので、そこで再試行する）。
func (h *SquareHandler) refreshPairing(ctx context.Context, device *models.SquareDevice) {
	if !h.enabled() || device.Status != squareDeviceUnpaired || device.CodeID == nil {
		return
	}
	code, err := h.client.GetDeviceCode(ctx, *device.CodeID)
	if err != nil {
		log.Printf("square: failed to get device code %s: %v", *device.CodeID, err)
		return
	}
	switch squareDeviceStatusFor(code.Status) {
	case squareDevicePaired:
		if code.DeviceID == "" {
			return
		}
		if err := markSquareDevicePaired(h.db.WithContext(ctx), device, code.DeviceID); err != nil {
			log.Printf("square: failed to save paired device %s: %v", device.ID, err)
		}
	case squareDeviceExpired:
		device.Status = squareDeviceExpired
		device.Code = nil
		if err := h.db.WithContext(ctx).Model(device).Select("Status", "Code", "UpdatedAt").Updates(device).Error; err != nil {
			log.Printf("square: failed to save expired device code %s: %v", device.ID, err)
		}
	}
}

// --------------------------------------------------
// ハンドラー
// --------------------------------------------------

// GET /api/square/devices
func (h *SquareHandler) GetDevices(c *gin.Context) {
	ctx := c.Request.Context()
	var pending []models.SquareDevice
	if err := h.db.WithContext(ctx).Where("status = ?", squareDeviceUnpaired).Find(&pending).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	for i := range pending {
		h.refreshPairing(ctx, &pending[i])
	}

	// ペアリングし直した端末の古い行は refreshPairing で消えるので、読み直して返す。
	var devices []models.SquareDevice
	if err := h.db.WithContext(ctx).Order("created_at").Find(&devices).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, toSquareDeviceResponses(devices))
}

// POST /api/square/devices/pair
func (h *SquareHandler) PairDevice(c *gin.Context) {
	if !h.enabled() {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Square 連携が設定されていません"})
		return
	}
	var req models.PairSquareDeviceJSONRequestBody
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	name, err := validateSquareDeviceName(req.Name)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	ctx := c.Request.Context()

	code, err := h.client.CreateDeviceCode(ctx, uuid.NewString(), square.DeviceCode{
		Name:        name,
		LocationID:  h.locationID,
		ProductType: squareDeviceProductType,
	})
	if err != nil {
		log.Printf("square: failed to create device code: %v", err)
		c.JSON(http.StatusBadGateway, gin.H{"error": "コードを発行できませんでした: " + err.Error()})
		return
	}
	if code.ID == "" || code.Code == "" {
		c.JSON(http.StatusBadGateway, gin.H{"error": "Square の応答にコードがありません"})
		return
	}

	// 発行した直後はペアリングされていない。状態は一覧を取るときに Square に問い合わせる。
	device := models.SquareDevice{
		Name:   name,
		Status: squareDeviceUnpaired,
		CodeID: &code.ID,
		Code:   &code.Code,
		PairBy: parseSquareTime(code.PairBy),
	}
	if err := h.db.WithContext(ctx).Create(&device).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, toSquareDeviceResponse(&device))
}

// POST /api/square/devices
func (h *SquareHandler) CreateDevice(c *gin.Context) {
	var req models.CreateSquareDeviceJSONRequestBody
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	name, err := validateSquareDeviceName(req.Name)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	deviceID := strings.TrimSpace(req.DeviceId)
	if deviceID == "" || len(deviceID) > squareDeviceIDMaxLength {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("device_id は 1〜%d 文字にしてください", squareDeviceIDMaxLength)})
		return
	}
	ctx := c.Request.Context()

	var count int64
	if err := h.db.WithContext(ctx).Model(&models.SquareDevice{}).Where("device_id = ?", deviceID).Count(&count).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if count > 0 {
		c.JSON(http.StatusConflict, gin.H{"error": "この device_id は登録済みです"})
		return
	}
	device := models.SquareDevice{Name: name, Status: squareDevicePaired, DeviceID: &deviceID}
	if err := h.db.WithContext(ctx).Create(&device).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, toSquareDeviceResponse(&device))
}

// POST /api/square/devices/import
func (h *SquareHandler) ImportDevices(c *gin.Context) {
	if !h.enabled() {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Square 連携が設定されていません"})
		return
	}
	ctx := c.Request.Context()
	codes, err := h.client.ListDeviceCodes(ctx, square.ListDeviceCodesParams{
		LocationID:  h.locationID,
		ProductType: squareDeviceProductType,
		Status:      squareDevicePaired,
	})
	if err != nil {
		log.Printf("square: failed to list device codes: %v", err)
		c.JSON(http.StatusBadGateway, gin.H{"error": "Square から端末の一覧を取れませんでした: " + err.Error()})
		return
	}

	imported := []models.SquareDevice{}
	err = h.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		for _, code := range latestPairedCodes(codes) {
			device, err := importSquareDevice(tx, code)
			if err != nil {
				return err
			}
			if device != nil {
				imported = append(imported, *device)
			}
		}
		return nil
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, toSquareDeviceResponses(imported))
}

// DELETE /api/square/devices/:id
//
// 一覧から外すだけで、端末は Square にサインインしたまま（API では解除できない）。
func (h *SquareHandler) DeleteDevice(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid ID format"})
		return
	}
	result := h.db.WithContext(c.Request.Context()).Delete(&models.SquareDevice{}, "id = ?", id)
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": result.Error.Error()})
		return
	}
	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Device not found"})
		return
	}
	c.Status(http.StatusNoContent)
}
