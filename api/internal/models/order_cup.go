package models

import (
	"time"

	"github.com/google/uuid"
)

// OrderCup は注文の1杯。注文明細（メニュー）の構成品のうちグッズ（others）以外を、
// 数量分に展開して注文時に作る。後からメニューの構成が変わっても、作った時点の
// item を指したまま変わらない。
//
// 状態は preparing（ReadyAt, ServedAt とも nil）/ ready（ReadyAt あり）/
// served（ServedAt あり）。served のカップは必ず ReadyAt も持つ。
type OrderCup struct {
	ID          uuid.UUID `gorm:"type:uuid;primaryKey;default:uuid_generate_v4()"`
	OrderID     uuid.UUID `gorm:"type:uuid;not null;index"`
	OrderMenuID uuid.UUID `gorm:"type:uuid;not null;index"`
	ItemID      uuid.UUID `gorm:"type:uuid;not null"`
	// 注文内での並び順（0 始まり）
	Position int `gorm:"not null"`
	ReadyAt  *time.Time
	ServedAt *time.Time

	// CaOS（ドリップ管制）が決めたこと。書くのは handlers/caos.go（PUT /api/caos/cups と「次へ」）・caos_emergency.go（緊急）・caos_undo.go（1つ戻す）だけ。
	// 注文の応答（OrderResponse の cups）に載せるが、CaOS 以外の画面は読まない。
	// 注文の編集では、ほかの列と同じく引き継いだカップは同じ値のまま入れ直す（新しい明細のカップは未割当）。
	//
	// カード（1 回のドリップ。最大 2 杯）は DripID が同じカップの組。状態は列の値で決まる：
	//   - Dripper が nil：未割当（DripID があれば統合した未割当）
	//   - Dripper あり・BrewStartedAt が nil：そのドリッパーの待機
	//   - BrewStartedAt あり・BrewFinishedAt が nil：抽出中（1 つのドリッパーで同時に 1 枚）
	//   - BrewFinishedAt あり：終わり
	// どのカップも準備完了（ReadyAt あり）になったカード（マスターで準備完了にした）も終わりとみなす。
	// 同じ DripID のカップは、Dripper・DripperPosition・BrewStartedAt・BrewFinishedAt も同じ値を持つ（PUT で確かめる）。

	// ドリッパーの番号（1〜6。画面では 1st〜6th）。指名の番号と同じもの
	Dripper *int `gorm:"type:smallint;check:order_cups_dripper_check,dripper BETWEEN 1 AND 6"`
	// そのドリッパーの中の順番（小さいほど先。ふつうは注文番号。間に入れるときは前後の間の値）
	DripperPosition *float64 `gorm:"type:double precision"`
	// 同じカードで淹れるカップをまとめる印（統合したら同じ値）
	DripID *uuid.UUID `gorm:"type:uuid;index"`
	// 抽出を始めた時刻・終えた時刻
	BrewStartedAt  *time.Time
	BrewFinishedAt *time.Time

	// 緊急（入れ直し）。マスターの緊急ボタンと CaOS の入れ直しのパネルが付ける（handlers/caos_emergency.go）。
	// 同じカップは 2 回緊急にしない（EmergencyAt があれば何もしない）。
	//   - EmergencyAt：緊急にした時刻。緊急にしても上の最初の抽出の列（Dripper・DripperPosition・DripID・BrewStartedAt・
	//     BrewFinishedAt）はそのまま残す（抽出の統計で最初の抽出も数えるため）
	//   - EmergencyDripper・EmergencyDripperPosition・EmergencyDripID・EmergencyBrewStartedAt・EmergencyBrewFinishedAt：
	//     入れ直しのカード。上の 5 つの列と同じ意味で、緊急のカップでは CaOS のカードはこちらで決まる（PUT /api/caos/cups・
	//     「次へ」が読み書きするのもこちら）。EmergencyDripID が空なら未割当の緊急のカード（CaOS の未割当のいちばん上に出る）
	//   - EmergencyPrintedAt：緊急のシールを印刷した時刻。プリンターにつないだレジが、空なら付けてから印刷する
	//     （付けられたときだけ印刷するので 2 重に印刷しない）。印刷に失敗したら空に戻す
	EmergencyAt              *time.Time
	EmergencyDripper         *int       `gorm:"type:smallint;check:order_cups_emergency_dripper_check,emergency_dripper BETWEEN 1 AND 6"`
	EmergencyDripperPosition *float64   `gorm:"type:double precision"`
	EmergencyDripID          *uuid.UUID `gorm:"type:uuid;index"`
	EmergencyBrewStartedAt   *time.Time
	EmergencyBrewFinishedAt  *time.Time
	EmergencyPrintedAt       *time.Time

	Item Item `gorm:"foreignKey:ItemID;references:ID"`
}
