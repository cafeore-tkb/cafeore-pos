package handlers

import (
	"net/http"
	"testing"

	"cafeore-pos/api/internal/models"
)

func TestBuildPrinterSettingNormalizesAddresses(t *testing.T) {
	setting, err := buildPrinterSetting(models.PrinterSettingsUpdateRequest{
		LabelPrinterIp:   " 192.168.77.2 ",
		ReceiptPrinterIp: "10.0.0.13",
	})
	if err != nil {
		t.Fatal(err)
	}
	if setting.ID != models.PrinterSettingID || setting.LabelPrinterIP != "192.168.77.2" || setting.ReceiptPrinterIP != "10.0.0.13" {
		t.Fatalf("incorrect setting: %+v", setting)
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
			if _, err := buildPrinterSetting(models.PrinterSettingsUpdateRequest{LabelPrinterIp: ip, ReceiptPrinterIp: "192.168.77.3"}); err == nil {
				t.Fatal("expected validation error")
			}
		})
		t.Run("receipt "+name, func(t *testing.T) {
			if _, err := buildPrinterSetting(models.PrinterSettingsUpdateRequest{LabelPrinterIp: "192.168.77.2", ReceiptPrinterIp: ip}); err == nil {
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
	if got.LabelPrinterIp != models.DefaultLabelPrinterIP || got.ReceiptPrinterIp != models.DefaultReceiptPrinterIP {
		t.Fatalf("defaults: %+v", got)
	}

	var saved models.PrinterSettingsResponse
	api.do(http.MethodPut, "/api/printer-settings", models.PrinterSettingsUpdateRequest{
		LabelPrinterIp:   "192.168.77.12",
		ReceiptPrinterIp: " 192.168.77.13",
	}).expect(http.StatusOK).decode(&saved)
	if saved.LabelPrinterIp != "192.168.77.12" || saved.ReceiptPrinterIp != "192.168.77.13" {
		t.Fatalf("saved: %+v", saved)
	}

	// 2 回目は 1 行を丸ごと置き換える
	api.do(http.MethodPut, "/api/printer-settings", models.PrinterSettingsUpdateRequest{
		LabelPrinterIp:   "192.168.77.22",
		ReceiptPrinterIp: "192.168.77.23",
	}).expect(http.StatusOK)
	api.do(http.MethodGet, "/api/printer-settings", nil).expect(http.StatusOK).decode(&got)
	if got.LabelPrinterIp != "192.168.77.22" || got.ReceiptPrinterIp != "192.168.77.23" {
		t.Fatalf("replaced: %+v", got)
	}
	if n := api.count(&models.PrinterSetting{}, ""); n != 1 {
		t.Fatalf("%d printer settings", n)
	}

	// 不正な値では変えない
	api.do(http.MethodPut, "/api/printer-settings", `{"label_printer_ip": "printer.local", "receipt_printer_ip": "192.168.77.3"}`).expect(http.StatusBadRequest)
	api.do(http.MethodPut, "/api/printer-settings", `{"label_printer_ip": "192.168.77.2"}`).expect(http.StatusBadRequest)
	api.do(http.MethodPut, "/api/printer-settings", `{`).expect(http.StatusBadRequest)
	api.do(http.MethodGet, "/api/printer-settings", nil).expect(http.StatusOK).decode(&got)
	if got.LabelPrinterIp != "192.168.77.22" || got.ReceiptPrinterIp != "192.168.77.23" {
		t.Fatalf("changed by invalid request: %+v", got)
	}
}
