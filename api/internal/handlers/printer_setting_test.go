package handlers

import (
	"net/http"
	"testing"

	"cafeore-pos/api/internal/models"
)

// 正しいリクエスト。テストではここから 1 つだけ変えて使う
func validPrinterSettingsRequest() models.PrinterSettingsUpdateRequest {
	return models.PrinterSettingsUpdateRequest{
		LabelPrinterIp:           "192.168.77.2",
		ReceiptPrinterIp:         "192.168.77.3",
		ReceiptPrinterModel:      models.ReceiptPrinterModelTmL90,
		LabelPrinterPaperWidth:   models.PrinterPaperWidth80mm,
		ReceiptPrinterPaperWidth: models.PrinterPaperWidth58mm,
	}
}

func TestBuildPrinterSettingNormalizesAddresses(t *testing.T) {
	setting, err := buildPrinterSetting(models.PrinterSettingsUpdateRequest{
		LabelPrinterIp:           " 192.168.77.2 ",
		ReceiptPrinterIp:         "10.0.0.13",
		ReceiptPrinterModel:      models.ReceiptPrinterModelTmM30,
		LabelPrinterPaperWidth:   models.PrinterPaperWidth58mm,
		ReceiptPrinterPaperWidth: models.PrinterPaperWidth80mm,
	})
	if err != nil {
		t.Fatal(err)
	}
	if setting.ID != models.PrinterSettingID || setting.LabelPrinterIP != "192.168.77.2" || setting.ReceiptPrinterIP != "10.0.0.13" || setting.ReceiptPrinterModel != "tm_m30" || setting.LabelPrinterPaperWidth != "58mm" || setting.ReceiptPrinterPaperWidth != "80mm" {
		t.Fatalf("incorrect setting: %+v", setting)
	}
}

func TestBuildPrinterSettingRejectsUnknownModels(t *testing.T) {
	for _, model := range []models.ReceiptPrinterModel{"", "tm_t88", "TM-L90"} {
		t.Run(string(model), func(t *testing.T) {
			request := validPrinterSettingsRequest()
			request.ReceiptPrinterModel = model
			if _, err := buildPrinterSetting(request); err == nil {
				t.Fatal("expected validation error")
			}
		})
	}
}

func TestBuildPrinterSettingRejectsUnknownPaperWidths(t *testing.T) {
	for _, width := range []models.PrinterPaperWidth{"", "58", "58MM", "112mm"} {
		t.Run("label "+string(width), func(t *testing.T) {
			request := validPrinterSettingsRequest()
			request.LabelPrinterPaperWidth = width
			if _, err := buildPrinterSetting(request); err == nil {
				t.Fatal("expected validation error")
			}
		})
		t.Run("receipt "+string(width), func(t *testing.T) {
			request := validPrinterSettingsRequest()
			request.ReceiptPrinterPaperWidth = width
			if _, err := buildPrinterSetting(request); err == nil {
				t.Fatal("expected validation error")
			}
		})
	}
}

func TestBuildPrinterSettingRejectsInvalidAddresses(t *testing.T) {
	cases := map[string]string{
		"empty":         "",
		"host name":     "printer.local",
		"ipv6":          "fe80::1",
		"ipv4 in ipv6":  "::ffff:192.168.77.3",
		"out of range":  "192.168.77.256",
		"too short":     "192.168.77",
		"leading zeros": "192.168.077.3",
		"with port":     "192.168.77.3:8008",
		"with scheme":   "http://192.168.77.3",
	}
	for name, ip := range cases {
		t.Run("label "+name, func(t *testing.T) {
			request := validPrinterSettingsRequest()
			request.LabelPrinterIp = ip
			if _, err := buildPrinterSetting(request); err == nil {
				t.Fatal("expected validation error")
			}
		})
		t.Run("receipt "+name, func(t *testing.T) {
			request := validPrinterSettingsRequest()
			request.ReceiptPrinterIp = ip
			if _, err := buildPrinterSetting(request); err == nil {
				t.Fatal("expected validation error")
			}
		})
	}
}

// プリンター設定の結合テスト（Postgres を使う）
func TestPrinterSettings(t *testing.T) {
	api := newTestAPI(t)

	// まだ一度も保存していなければ既定値
	var got models.PrinterSettingsResponse
	api.do(http.MethodGet, "/api/printer-settings", nil).expect(http.StatusOK).decode(&got)
	if got != (models.PrinterSettingsResponse{
		LabelPrinterIp:           models.DefaultLabelPrinterIP,
		ReceiptPrinterIp:         models.DefaultReceiptPrinterIP,
		ReceiptPrinterModel:      models.DefaultReceiptPrinterModel,
		LabelPrinterPaperWidth:   models.DefaultLabelPrinterPaperWidth,
		ReceiptPrinterPaperWidth: models.DefaultReceiptPrinterPaperWidth,
	}) {
		t.Fatalf("defaults: %+v", got)
	}

	var saved models.PrinterSettingsResponse
	api.do(http.MethodPut, "/api/printer-settings", models.PrinterSettingsUpdateRequest{
		LabelPrinterIp:           "192.168.77.12",
		ReceiptPrinterIp:         " 192.168.77.13",
		ReceiptPrinterModel:      models.ReceiptPrinterModelTmM30,
		LabelPrinterPaperWidth:   models.PrinterPaperWidth58mm,
		ReceiptPrinterPaperWidth: models.PrinterPaperWidth80mm,
	}).expect(http.StatusOK).decode(&saved)
	if saved != (models.PrinterSettingsResponse{
		LabelPrinterIp:           "192.168.77.12",
		ReceiptPrinterIp:         "192.168.77.13",
		ReceiptPrinterModel:      models.ReceiptPrinterModelTmM30,
		LabelPrinterPaperWidth:   models.PrinterPaperWidth58mm,
		ReceiptPrinterPaperWidth: models.PrinterPaperWidth80mm,
	}) {
		t.Fatalf("saved: %+v", saved)
	}

	// 2 回目は 1 行を丸ごと置き換える
	replacement := models.PrinterSettingsUpdateRequest{
		LabelPrinterIp:           "192.168.77.22",
		ReceiptPrinterIp:         "192.168.77.23",
		ReceiptPrinterModel:      models.ReceiptPrinterModelTmL90,
		LabelPrinterPaperWidth:   models.PrinterPaperWidth80mm,
		ReceiptPrinterPaperWidth: models.PrinterPaperWidth58mm,
	}
	want := models.PrinterSettingsResponse(replacement)
	api.do(http.MethodPut, "/api/printer-settings", replacement).expect(http.StatusOK)
	api.do(http.MethodGet, "/api/printer-settings", nil).expect(http.StatusOK).decode(&got)
	if got != want {
		t.Fatalf("replaced: %+v", got)
	}
	if n := api.count(&models.PrinterSetting{}, ""); n != 1 {
		t.Fatalf("%d printer settings", n)
	}

	// 不正な値では変えない
	api.do(http.MethodPut, "/api/printer-settings", `{"label_printer_ip": "printer.local", "receipt_printer_ip": "192.168.77.3", "receipt_printer_model": "tm_l90", "label_printer_paper_width": "80mm", "receipt_printer_paper_width": "58mm"}`).expect(http.StatusBadRequest)
	api.do(http.MethodPut, "/api/printer-settings", `{"label_printer_ip": "192.168.77.2", "receipt_printer_model": "tm_l90", "label_printer_paper_width": "80mm", "receipt_printer_paper_width": "58mm"}`).expect(http.StatusBadRequest)
	api.do(http.MethodPut, "/api/printer-settings", `{"label_printer_ip": "192.168.77.2", "receipt_printer_ip": "192.168.77.3", "label_printer_paper_width": "80mm", "receipt_printer_paper_width": "58mm"}`).expect(http.StatusBadRequest)
	api.do(http.MethodPut, "/api/printer-settings", `{"label_printer_ip": "192.168.77.2", "receipt_printer_ip": "192.168.77.3", "receipt_printer_model": "tm_t88", "label_printer_paper_width": "80mm", "receipt_printer_paper_width": "58mm"}`).expect(http.StatusBadRequest)
	// 用紙の幅が無い（選べるようにする前のレジ）・知らない幅
	api.do(http.MethodPut, "/api/printer-settings", `{"label_printer_ip": "192.168.77.2", "receipt_printer_ip": "192.168.77.3", "receipt_printer_model": "tm_l90"}`).expect(http.StatusBadRequest)
	api.do(http.MethodPut, "/api/printer-settings", `{"label_printer_ip": "192.168.77.2", "receipt_printer_ip": "192.168.77.3", "receipt_printer_model": "tm_l90", "label_printer_paper_width": "100mm", "receipt_printer_paper_width": "58mm"}`).expect(http.StatusBadRequest)
	api.do(http.MethodPut, "/api/printer-settings", `{`).expect(http.StatusBadRequest)
	api.do(http.MethodGet, "/api/printer-settings", nil).expect(http.StatusOK).decode(&got)
	if got != want {
		t.Fatalf("changed by invalid request: %+v", got)
	}
}
