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

// DefaultReceiptPrinterModel は一度も保存していないときのレシート用のプリンターの機種。
// 機種を選べるようにする前に保存した行も、この機種になる（列の既定値）。
const DefaultReceiptPrinterModel = ReceiptPrinterModelTmL90

// 一度も保存していないときのプリンターの用紙（幅と種類）。用紙を選べるようにする前に保存した行も、これになる（列の既定値）。
// どちらも、選べるようにする前にレジが決め打ちしていた用紙（ラベル用は 80mm のダイカットラベル、レシート用は 58mm のレシート紙）。
// ラベル用の用紙はもう使わない（シールの大きさは下の長さ・印字幅・余白で決める）が、別々に出すレジと API のために列を残す。
const (
	DefaultLabelPrinterPaperWidth   = PrinterPaperWidth80mm
	DefaultReceiptPrinterPaperWidth = PrinterPaperWidth58mm
	DefaultLabelPrinterPaperType    = PrinterPaperTypeDieCutLabel
	DefaultReceiptPrinterPaperType  = PrinterPaperTypeReceipt
)

// 一度も保存していないときのラベル用のシールの大きさ。シールの大きさを決められるようにする前に保存した行も、これになる（列の既定値）。
// 今のラベルロール（台紙 約 57mm、シール 約 53 × 30mm）でテスト印刷して決めた値（長さ 29mm、印字幅 360 ドット = 45mm、余白なし）。
const (
	DefaultLabelPrinterLabelLengthMm  = 29.0
	DefaultLabelPrinterPrintWidthDots = 360
	DefaultLabelPrinterMarginMm       = 0.0
)

// PrinterSetting はレジがつなぐ Epson のプリンター（ePOS-Print）の IP アドレス、ラベル用のシールの大きさ
// （長さ・印字幅・余白）、レシート用のプリンターの用紙（幅と種類）と機種。
//
// レジのブラウザがこの IP アドレスへ直接つなぐ。サーバーはプリンターにはつながず、
// 値を持っておくだけ。シールの大きさ・機種・用紙は、レジが刷るものの大きさを決めるのに使う。
type PrinterSetting struct {
	ID                         string    `gorm:"primary_key;size:64"`
	LabelPrinterIP             string    `gorm:"not null"`                                  // カップに貼るシール
	ReceiptPrinterIP           string    `gorm:"not null"`                                  // レシートと領収書
	ReceiptPrinterModel        string    `gorm:"not null;default:'tm_l90'"`                 // ReceiptPrinterModel（openapi.yaml）のいずれか
	LabelPrinterPaperWidth     string    `gorm:"not null;default:'80mm'"`                   // PrinterPaperWidth（openapi.yaml）のいずれか。使わない（列だけ残す）
	ReceiptPrinterPaperWidth   string    `gorm:"not null;default:'58mm'"`                   // PrinterPaperWidth（openapi.yaml）のいずれか
	LabelPrinterPaperType      string    `gorm:"not null;default:'die_cut_label'"`          // PrinterPaperType（openapi.yaml）のいずれか。使わない（列だけ残す）
	ReceiptPrinterPaperType    string    `gorm:"not null;default:'receipt'"`                // PrinterPaperType（openapi.yaml）のいずれか
	LabelPrinterLabelLengthMm  float64   `gorm:"type:double precision;not null;default:29"` // シール 1 枚の長さ（mm。DefaultLabelPrinterLabelLengthMm と同じ）
	LabelPrinterPrintWidthDots int       `gorm:"not null;default:360"`                      // 印字幅（ドット。DefaultLabelPrinterPrintWidthDots と同じ）
	LabelPrinterMarginMm       float64   `gorm:"type:double precision;not null;default:0"`  // 四辺の余白（mm。DefaultLabelPrinterMarginMm と同じ）
	UpdatedAt                  time.Time `gorm:"not null"`
}

// DefaultPrinterSetting は一度も保存していないときの設定。
func DefaultPrinterSetting() PrinterSetting {
	return PrinterSetting{
		ID:                         PrinterSettingID,
		LabelPrinterIP:             DefaultLabelPrinterIP,
		ReceiptPrinterIP:           DefaultReceiptPrinterIP,
		ReceiptPrinterModel:        string(DefaultReceiptPrinterModel),
		LabelPrinterPaperWidth:     string(DefaultLabelPrinterPaperWidth),
		ReceiptPrinterPaperWidth:   string(DefaultReceiptPrinterPaperWidth),
		LabelPrinterPaperType:      string(DefaultLabelPrinterPaperType),
		ReceiptPrinterPaperType:    string(DefaultReceiptPrinterPaperType),
		LabelPrinterLabelLengthMm:  DefaultLabelPrinterLabelLengthMm,
		LabelPrinterPrintWidthDots: DefaultLabelPrinterPrintWidthDots,
		LabelPrinterMarginMm:       DefaultLabelPrinterMarginMm,
	}
}
