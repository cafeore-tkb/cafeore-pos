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
// ラベル用の用紙の種類は、ダイカットラベルの位置合わせか、レシート紙の送り・カットかを決める。
// ラベル用の用紙幅は使わず、シールの大きさは下の長さ・印字幅・余白で決める。
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

// DefaultLabelPrinterRotate180 は一度も保存していないときに、ラベル用のシールを 180° 回して刷るか。
// 回せるようにする前に保存した行も、これになる（列の既定値）。
const DefaultLabelPrinterRotate180 = true

// DefaultLabelPrinterTrailingFeed は一度も保存していないときの、ラベル用のプリンターの一連の印刷の最後の送り方。
// 選べるようにする前に保存した行も、これになる（列の既定値）。
const DefaultLabelPrinterTrailingFeed = LabelPrinterTrailingFeedBlankLabel

// DefaultLabelPrinterReceiptCut はレシート紙を使うときの既定の切り方。
// 従来の CUT_FEED と同じパーシャルカットにする。
const DefaultLabelPrinterReceiptCut = LabelPrinterReceiptCutPartial

// PrinterSetting はレジがつなぐ Epson のプリンター（ePOS-Print）の IP アドレス、ラベル用のシールの大きさ
// （長さ・印字幅・余白）と向き（180° 回すか）と一連の印刷の最後の送り方、レシート用のプリンターの用紙（幅と種類）と機種。
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
	LabelPrinterPaperType      string    `gorm:"not null;default:'die_cut_label'"`          // PrinterPaperType（openapi.yaml）のいずれか。位置合わせ・カット方法を決める
	ReceiptPrinterPaperType    string    `gorm:"not null;default:'receipt'"`                // PrinterPaperType（openapi.yaml）のいずれか
	LabelPrinterLabelLengthMm  float64   `gorm:"type:double precision;not null;default:29"` // シール 1 枚の長さ（mm。DefaultLabelPrinterLabelLengthMm と同じ）
	LabelPrinterPrintWidthDots int       `gorm:"not null;default:360"`                      // 印字幅（ドット。DefaultLabelPrinterPrintWidthDots と同じ）
	LabelPrinterMarginMm       float64   `gorm:"type:double precision;not null;default:0"`  // 四辺の余白（mm。DefaultLabelPrinterMarginMm と同じ）
	LabelPrinterRotate180      *bool     `gorm:"not null;default:true"`                     // カップ・緊急・キャンセルのシールを 180° 回して刷るか（DefaultLabelPrinterRotate180 と同じ。Rotate180 で読む）
	LabelPrinterTrailingFeed   string    `gorm:"not null;default:'blank_label'"`            // LabelPrinterTrailingFeed（openapi.yaml）のいずれか（DefaultLabelPrinterTrailingFeed と同じ）
	LabelPrinterReceiptCut     string    `gorm:"not null;default:'partial'"`                // LabelPrinterReceiptCut（openapi.yaml）のいずれか
	UpdatedAt                  time.Time `gorm:"not null"`
}

// Rotate180 はシールを 180° 回して刷るか。値が無ければ既定（DefaultLabelPrinterRotate180）。
//
// LabelPrinterRotate180 がポインタなのは、列の既定値が true でも false を書けるようにするため
// （GORM は既定値のある列のゼロ値を、INSERT で列の既定値に置き換える）。
func (s *PrinterSetting) Rotate180() bool {
	if s.LabelPrinterRotate180 == nil {
		return DefaultLabelPrinterRotate180
	}
	return *s.LabelPrinterRotate180
}

// DefaultPrinterSetting は一度も保存していないときの設定。
func DefaultPrinterSetting() PrinterSetting {
	rotate180 := DefaultLabelPrinterRotate180
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
		LabelPrinterRotate180:      &rotate180,
		LabelPrinterTrailingFeed:   string(DefaultLabelPrinterTrailingFeed),
		LabelPrinterReceiptCut:     string(DefaultLabelPrinterReceiptCut),
	}
}
