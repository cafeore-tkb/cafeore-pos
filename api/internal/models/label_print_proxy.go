package models

import "time"

// LabelPrintProxy は、代理印刷をしているレジ（label_print_proxies）。代理印刷をオンにしていて、ラベル用のプリンターが
// つながっているあいだ、レジが PUT /api/label-print-proxies/{deviceId} で間をおいて知らせる（handlers/label_print.go）。
//
// LastSeenAt から決まった長さ（handlers の labelPrintProxyTTL）知らせが無ければ、もう代理印刷をしていないとみなす
// （閉じた・落ちたレジは知らせずに消えるので）。レジは、ほかに代理印刷をしているレジが無ければ代理印刷をオンにする。
type LabelPrintProxy struct {
	// 代理印刷をしているレジ（ページを開くたびに画面が作る id。代理印刷の頼みの ClaimedBy と同じ）
	DeviceID   string    `gorm:"size:64;primaryKey"`
	LastSeenAt time.Time `gorm:"not null;index"`
}
