// api/internal/models/printer_setting.go
package models

import "time"

// PrinterSettingID は printer_settings に唯一存在する行の ID。
//
// プリンターは全レジで共通なので、設定は 1 行だけ持つ。
const PrinterSettingID = "printer-settings"

// 一度も保存していないときに使うプリンターの IP アドレス。
// ラベル用は、管理画面で設定できるようにする前にレジに書き込んでいた値。
const (
	DefaultLabelPrinterIP   = "192.168.77.2"
	DefaultReceiptPrinterIP = "192.168.77.3"
)

// PrinterSetting はレジがつなぐ Epson のプリンター（ePOS-Print）の IP アドレス。
//
// レジのブラウザがこの IP アドレスへ直接つなぐ。サーバーはプリンターにはつながず、
// 値を持っておくだけ。
type PrinterSetting struct {
	ID               string    `gorm:"primary_key;size:64"`
	LabelPrinterIP   string    `gorm:"not null"` // カップに貼るシール
	ReceiptPrinterIP string    `gorm:"not null"` // レシートと領収書
	UpdatedAt        time.Time `gorm:"not null"`
}

// DefaultPrinterSetting は一度も保存していないときの設定。
func DefaultPrinterSetting() PrinterSetting {
	return PrinterSetting{
		ID:               PrinterSettingID,
		LabelPrinterIP:   DefaultLabelPrinterIP,
		ReceiptPrinterIP: DefaultReceiptPrinterIP,
	}
}
