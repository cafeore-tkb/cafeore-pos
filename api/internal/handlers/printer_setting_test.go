package handlers

import (
	"net/http"
	"testing"

	"cafeore-pos/api/internal/models"
)

// 正しいリクエスト。テストではここから 1 つだけ変えて使う
func validPrinterSettingsRequest() models.PrinterSettingsUpdateRequest {
	return models.PrinterSettingsUpdateRequest{
		LabelPrinterIp:             "192.168.77.2",
		ReceiptPrinterIp:           "192.168.77.3",
		ReceiptPrinterModel:        models.ReceiptPrinterModelTmL90,
		LabelPrinterPaperWidth:     models.PrinterPaperWidth80mm,
		ReceiptPrinterPaperWidth:   models.PrinterPaperWidth58mm,
		LabelPrinterPaperType:      models.PrinterPaperTypeDieCutLabel,
		ReceiptPrinterPaperType:    models.PrinterPaperTypeReceipt,
		LabelPrinterLabelLengthMm:  29,
		LabelPrinterPrintWidthDots: 360,
		LabelPrinterMarginMm:       0,
	}
}

func TestBuildPrinterSettingNormalizesAddresses(t *testing.T) {
	setting, err := buildPrinterSetting(models.PrinterSettingsUpdateRequest{
		LabelPrinterIp:             " 192.168.77.2 ",
		ReceiptPrinterIp:           "10.0.0.13",
		ReceiptPrinterModel:        models.ReceiptPrinterModelTmM30,
		LabelPrinterPaperWidth:     models.PrinterPaperWidth58mm,
		ReceiptPrinterPaperWidth:   models.PrinterPaperWidth80mm,
		LabelPrinterPaperType:      models.PrinterPaperTypeReceipt,
		ReceiptPrinterPaperType:    models.PrinterPaperTypeDieCutLabel,
		LabelPrinterLabelLengthMm:  30.5,
		LabelPrinterPrintWidthDots: 384,
		LabelPrinterMarginMm:       1.5,
		LabelPrinterRotate180:      boolPtr(true),
	})
	if err != nil {
		t.Fatal(err)
	}
	if setting.ID != models.PrinterSettingID || setting.LabelPrinterIP != "192.168.77.2" || setting.ReceiptPrinterIP != "10.0.0.13" || setting.ReceiptPrinterModel != "tm_m30" || setting.LabelPrinterPaperWidth != "58mm" || setting.ReceiptPrinterPaperWidth != "80mm" || setting.LabelPrinterPaperType != "receipt" || setting.ReceiptPrinterPaperType != "die_cut_label" || setting.LabelPrinterLabelLengthMm != 30.5 || setting.LabelPrinterPrintWidthDots != 384 || setting.LabelPrinterMarginMm != 1.5 || !setting.LabelPrinterRotate180 {
		t.Fatalf("incorrect setting: %+v", setting)
	}
}

// 180° 回すかが無ければ（回せるようにする前のレジ）、既定の回さないにする
func TestBuildPrinterSettingDefaultsRotation(t *testing.T) {
	setting, err := buildPrinterSetting(validPrinterSettingsRequest())
	if err != nil {
		t.Fatal(err)
	}
	if setting.LabelPrinterRotate180 != models.DefaultLabelPrinterRotate180 {
		t.Fatalf("rotate: %+v", setting)
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

func TestBuildPrinterSettingRejectsUnknownPaperTypes(t *testing.T) {
	for _, paperType := range []models.PrinterPaperType{"", "label", "RECEIPT", "die-cut-label"} {
		t.Run("label "+string(paperType), func(t *testing.T) {
			request := validPrinterSettingsRequest()
			request.LabelPrinterPaperType = paperType
			if _, err := buildPrinterSetting(request); err == nil {
				t.Fatal("expected validation error")
			}
		})
		t.Run("receipt "+string(paperType), func(t *testing.T) {
			request := validPrinterSettingsRequest()
			request.ReceiptPrinterPaperType = paperType
			if _, err := buildPrinterSetting(request); err == nil {
				t.Fatal("expected validation error")
			}
		})
	}
}

func TestBuildPrinterSettingAcceptsLabelSizeLimits(t *testing.T) {
	cases := map[string]func(*models.PrinterSettingsUpdateRequest){
		"shortest":      func(r *models.PrinterSettingsUpdateRequest) { r.LabelPrinterLabelLengthMm = 5 },
		"longest":       func(r *models.PrinterSettingsUpdateRequest) { r.LabelPrinterLabelLengthMm = 100 },
		"narrowest":     func(r *models.PrinterSettingsUpdateRequest) { r.LabelPrinterPrintWidthDots = 64 },
		"widest":        func(r *models.PrinterSettingsUpdateRequest) { r.LabelPrinterPrintWidthDots = 576 },
		"widest margin": func(r *models.PrinterSettingsUpdateRequest) { r.LabelPrinterMarginMm = 10 },
		"margin leaves 2 mm": func(r *models.PrinterSettingsUpdateRequest) {
			r.LabelPrinterLabelLengthMm = 10
			r.LabelPrinterMarginMm = 4
		},
	}
	for name, change := range cases {
		t.Run(name, func(t *testing.T) {
			request := validPrinterSettingsRequest()
			change(&request)
			if _, err := buildPrinterSetting(request); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestBuildPrinterSettingRejectsInvalidLabelSizes(t *testing.T) {
	cases := map[string]func(*models.PrinterSettingsUpdateRequest){
		"missing length":      func(r *models.PrinterSettingsUpdateRequest) { r.LabelPrinterLabelLengthMm = 0 },
		"too short":           func(r *models.PrinterSettingsUpdateRequest) { r.LabelPrinterLabelLengthMm = 4.5 },
		"too long":            func(r *models.PrinterSettingsUpdateRequest) { r.LabelPrinterLabelLengthMm = 100.5 },
		"missing width":       func(r *models.PrinterSettingsUpdateRequest) { r.LabelPrinterPrintWidthDots = 0 },
		"too narrow":          func(r *models.PrinterSettingsUpdateRequest) { r.LabelPrinterPrintWidthDots = 56 },
		"too wide":            func(r *models.PrinterSettingsUpdateRequest) { r.LabelPrinterPrintWidthDots = 584 },
		"not a multiple of 8": func(r *models.PrinterSettingsUpdateRequest) { r.LabelPrinterPrintWidthDots = 361 },
		"negative margin":     func(r *models.PrinterSettingsUpdateRequest) { r.LabelPrinterMarginMm = -0.5 },
		"too wide margin":     func(r *models.PrinterSettingsUpdateRequest) { r.LabelPrinterMarginMm = 10.5 },
		"margin leaves no room": func(r *models.PrinterSettingsUpdateRequest) {
			r.LabelPrinterLabelLengthMm = 10
			r.LabelPrinterMarginMm = 4.5
		},
	}
	for name, change := range cases {
		t.Run(name, func(t *testing.T) {
			request := validPrinterSettingsRequest()
			change(&request)
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
		LabelPrinterIp:             models.DefaultLabelPrinterIP,
		ReceiptPrinterIp:           models.DefaultReceiptPrinterIP,
		ReceiptPrinterModel:        models.DefaultReceiptPrinterModel,
		LabelPrinterPaperWidth:     models.DefaultLabelPrinterPaperWidth,
		ReceiptPrinterPaperWidth:   models.DefaultReceiptPrinterPaperWidth,
		LabelPrinterPaperType:      models.DefaultLabelPrinterPaperType,
		ReceiptPrinterPaperType:    models.DefaultReceiptPrinterPaperType,
		LabelPrinterLabelLengthMm:  29,
		LabelPrinterPrintWidthDots: 360,
		LabelPrinterMarginMm:       0,
		LabelPrinterRotate180:      false,
	}) {
		t.Fatalf("defaults: %+v", got)
	}

	var saved models.PrinterSettingsResponse
	api.do(http.MethodPut, "/api/printer-settings", models.PrinterSettingsUpdateRequest{
		LabelPrinterIp:             "192.168.77.12",
		ReceiptPrinterIp:           " 192.168.77.13",
		ReceiptPrinterModel:        models.ReceiptPrinterModelTmM30,
		LabelPrinterPaperWidth:     models.PrinterPaperWidth58mm,
		ReceiptPrinterPaperWidth:   models.PrinterPaperWidth80mm,
		LabelPrinterPaperType:      models.PrinterPaperTypeReceipt,
		ReceiptPrinterPaperType:    models.PrinterPaperTypeDieCutLabel,
		LabelPrinterLabelLengthMm:  30.5,
		LabelPrinterPrintWidthDots: 384,
		LabelPrinterMarginMm:       1.5,
		LabelPrinterRotate180:      boolPtr(true),
	}).expect(http.StatusOK).decode(&saved)
	if saved != (models.PrinterSettingsResponse{
		LabelPrinterIp:             "192.168.77.12",
		ReceiptPrinterIp:           "192.168.77.13",
		ReceiptPrinterModel:        models.ReceiptPrinterModelTmM30,
		LabelPrinterPaperWidth:     models.PrinterPaperWidth58mm,
		ReceiptPrinterPaperWidth:   models.PrinterPaperWidth80mm,
		LabelPrinterPaperType:      models.PrinterPaperTypeReceipt,
		ReceiptPrinterPaperType:    models.PrinterPaperTypeDieCutLabel,
		LabelPrinterLabelLengthMm:  30.5,
		LabelPrinterPrintWidthDots: 384,
		LabelPrinterMarginMm:       1.5,
		LabelPrinterRotate180:      true,
	}) {
		t.Fatalf("saved: %+v", saved)
	}

	// 2 回目は 1 行を丸ごと置き換える。180° 回すかが無ければ（回せるようにする前のレジ）、保存してある値のまま
	replacement := models.PrinterSettingsUpdateRequest{
		LabelPrinterIp:             "192.168.77.22",
		ReceiptPrinterIp:           "192.168.77.23",
		ReceiptPrinterModel:        models.ReceiptPrinterModelTmL90,
		LabelPrinterPaperWidth:     models.PrinterPaperWidth80mm,
		ReceiptPrinterPaperWidth:   models.PrinterPaperWidth58mm,
		LabelPrinterPaperType:      models.PrinterPaperTypeDieCutLabel,
		ReceiptPrinterPaperType:    models.PrinterPaperTypeReceipt,
		LabelPrinterLabelLengthMm:  40,
		LabelPrinterPrintWidthDots: 560,
		LabelPrinterMarginMm:       2,
	}
	want := models.PrinterSettingsResponse{
		LabelPrinterIp:             "192.168.77.22",
		ReceiptPrinterIp:           "192.168.77.23",
		ReceiptPrinterModel:        models.ReceiptPrinterModelTmL90,
		LabelPrinterPaperWidth:     models.PrinterPaperWidth80mm,
		ReceiptPrinterPaperWidth:   models.PrinterPaperWidth58mm,
		LabelPrinterPaperType:      models.PrinterPaperTypeDieCutLabel,
		ReceiptPrinterPaperType:    models.PrinterPaperTypeReceipt,
		LabelPrinterLabelLengthMm:  40,
		LabelPrinterPrintWidthDots: 560,
		LabelPrinterMarginMm:       2,
		LabelPrinterRotate180:      true,
	}
	api.do(http.MethodPut, "/api/printer-settings", replacement).expect(http.StatusOK).decode(&saved)
	if saved != want {
		t.Fatalf("replaced response: %+v", saved)
	}
	api.do(http.MethodGet, "/api/printer-settings", nil).expect(http.StatusOK).decode(&got)
	if got != want {
		t.Fatalf("replaced: %+v", got)
	}
	// 180° 回すかを送れば、それにする
	replacement.LabelPrinterRotate180 = boolPtr(false)
	want.LabelPrinterRotate180 = false
	api.do(http.MethodPut, "/api/printer-settings", replacement).expect(http.StatusOK)
	api.do(http.MethodGet, "/api/printer-settings", nil).expect(http.StatusOK).decode(&got)
	if got != want {
		t.Fatalf("rotation turned off: %+v", got)
	}
	if n := api.count(&models.PrinterSetting{}, ""); n != 1 {
		t.Fatalf("%d printer settings", n)
	}

	// 不正な値では変えない
	api.do(http.MethodPut, "/api/printer-settings", `{"label_printer_ip": "printer.local", "receipt_printer_ip": "192.168.77.3", "receipt_printer_model": "tm_l90", "label_printer_paper_width": "80mm", "receipt_printer_paper_width": "58mm", "label_printer_paper_type": "die_cut_label", "receipt_printer_paper_type": "receipt"}`).expect(http.StatusBadRequest)
	api.do(http.MethodPut, "/api/printer-settings", `{"label_printer_ip": "192.168.77.2", "receipt_printer_model": "tm_l90", "label_printer_paper_width": "80mm", "receipt_printer_paper_width": "58mm", "label_printer_paper_type": "die_cut_label", "receipt_printer_paper_type": "receipt"}`).expect(http.StatusBadRequest)
	api.do(http.MethodPut, "/api/printer-settings", `{"label_printer_ip": "192.168.77.2", "receipt_printer_ip": "192.168.77.3", "label_printer_paper_width": "80mm", "receipt_printer_paper_width": "58mm", "label_printer_paper_type": "die_cut_label", "receipt_printer_paper_type": "receipt"}`).expect(http.StatusBadRequest)
	api.do(http.MethodPut, "/api/printer-settings", `{"label_printer_ip": "192.168.77.2", "receipt_printer_ip": "192.168.77.3", "receipt_printer_model": "tm_t88", "label_printer_paper_width": "80mm", "receipt_printer_paper_width": "58mm", "label_printer_paper_type": "die_cut_label", "receipt_printer_paper_type": "receipt"}`).expect(http.StatusBadRequest)
	// 用紙の幅・種類が無い（選べるようにする前のレジ）・知らない幅・種類
	api.do(http.MethodPut, "/api/printer-settings", `{"label_printer_ip": "192.168.77.2", "receipt_printer_ip": "192.168.77.3", "receipt_printer_model": "tm_l90"}`).expect(http.StatusBadRequest)
	api.do(http.MethodPut, "/api/printer-settings", `{"label_printer_ip": "192.168.77.2", "receipt_printer_ip": "192.168.77.3", "receipt_printer_model": "tm_l90", "label_printer_paper_width": "80mm", "receipt_printer_paper_width": "58mm"}`).expect(http.StatusBadRequest)
	api.do(http.MethodPut, "/api/printer-settings", `{"label_printer_ip": "192.168.77.2", "receipt_printer_ip": "192.168.77.3", "receipt_printer_model": "tm_l90", "label_printer_paper_width": "100mm", "receipt_printer_paper_width": "58mm", "label_printer_paper_type": "die_cut_label", "receipt_printer_paper_type": "receipt"}`).expect(http.StatusBadRequest)
	api.do(http.MethodPut, "/api/printer-settings", `{"label_printer_ip": "192.168.77.2", "receipt_printer_ip": "192.168.77.3", "receipt_printer_model": "tm_l90", "label_printer_paper_width": "80mm", "receipt_printer_paper_width": "58mm", "label_printer_paper_type": "label", "receipt_printer_paper_type": "receipt"}`).expect(http.StatusBadRequest)
	// シールの大きさが無い（決められるようにする前のレジ）・範囲の外・8 の倍数でない印字幅・印字する所が残らない余白
	api.do(http.MethodPut, "/api/printer-settings", `{"label_printer_ip": "192.168.77.2", "receipt_printer_ip": "192.168.77.3", "receipt_printer_model": "tm_l90", "label_printer_paper_width": "80mm", "receipt_printer_paper_width": "58mm", "label_printer_paper_type": "die_cut_label", "receipt_printer_paper_type": "receipt"}`).expect(http.StatusBadRequest)
	api.do(http.MethodPut, "/api/printer-settings", `{"label_printer_ip": "192.168.77.2", "receipt_printer_ip": "192.168.77.3", "receipt_printer_model": "tm_l90", "label_printer_paper_width": "80mm", "receipt_printer_paper_width": "58mm", "label_printer_paper_type": "die_cut_label", "receipt_printer_paper_type": "receipt", "label_printer_label_length_mm": 200, "label_printer_print_width_dots": 360, "label_printer_margin_mm": 0}`).expect(http.StatusBadRequest)
	api.do(http.MethodPut, "/api/printer-settings", `{"label_printer_ip": "192.168.77.2", "receipt_printer_ip": "192.168.77.3", "receipt_printer_model": "tm_l90", "label_printer_paper_width": "80mm", "receipt_printer_paper_width": "58mm", "label_printer_paper_type": "die_cut_label", "receipt_printer_paper_type": "receipt", "label_printer_label_length_mm": 29, "label_printer_print_width_dots": 362, "label_printer_margin_mm": 0}`).expect(http.StatusBadRequest)
	api.do(http.MethodPut, "/api/printer-settings", `{"label_printer_ip": "192.168.77.2", "receipt_printer_ip": "192.168.77.3", "receipt_printer_model": "tm_l90", "label_printer_paper_width": "80mm", "receipt_printer_paper_width": "58mm", "label_printer_paper_type": "die_cut_label", "receipt_printer_paper_type": "receipt", "label_printer_label_length_mm": 10, "label_printer_print_width_dots": 360, "label_printer_margin_mm": 5}`).expect(http.StatusBadRequest)
	api.do(http.MethodPut, "/api/printer-settings", `{`).expect(http.StatusBadRequest)
	api.do(http.MethodGet, "/api/printer-settings", nil).expect(http.StatusOK).decode(&got)
	if got != want {
		t.Fatalf("changed by invalid request: %+v", got)
	}
}
