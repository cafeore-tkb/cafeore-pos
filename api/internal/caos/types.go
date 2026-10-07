// Package caos は CaOS（ドリップ管制）の盤面。抽出カードの保存と、割当・次へ・統合などのルールを持つ。
//
// 盤面は営業日（日本時間）ごとに 1 つ。カードは POS の注文から作り、注文のハンドラーと同じトランザクションの中で連動させる。
// カードが全部終わった注文は、既存の準備完了の処理（ReadyFunc。POS の PATCH /ready と同じ切り替え）で同じトランザクションの中で準備完了にする。
// 「1つ戻す」は、サーバーが残した操作の記録（caos_ops）で戻す。
// 配信は注文と同じく DB の通知から（caos_drips_changed の通知 → 各インスタンスが今日のカードと列の担当者を読み直して配る）。
//
// 列（ドリッパー 1〜6）の担当者（名前と、上級生＝限定を淹れられるか）も盤面の一部として営業日ごとに持つ（caos_lanes）。
// 担当者を替えるのは CaOS の画面からの操作（set_lane・swap_lanes）だけで、カードと同じく「1つ戻す」で戻せる。
package caos

import "time"

// Status は抽出カードの状態。
type Status string

const (
	// StatusUnassigned は未割当。
	StatusUnassigned Status = "unassigned"
	// StatusQueued は担当の待機列。
	StatusQueued Status = "queued"
	// StatusBrewing は抽出中。1 人のドリッパーが同時に抽出できるのは 1 枚だけ。
	StatusBrewing Status = "brewing"
	// StatusDone は抽出終了。
	StatusDone Status = "done"
)

// DripLine は抽出カードの中身の 1 行（どの注文の、どの商品を、何杯）。
// 注文番号や商品名は持たない（画面は /api/ws/orders で受け取る注文から引く）。
// 指名（POS の明細の dripper。指名したドリッパーの番号 1〜6）は、同じ商品でも指名ごとにカードを分けるので持つ。
// 指名の自由記述（明細の assignee）は持たない（番号の無い自由記述だけの古い明細は、指名なしとして扱う）。
type DripLine struct {
	OrderID string `json:"order_id"`
	ItemID  string `json:"item_id"`
	// 指名したドリッパーの番号（1〜6）。指名なしは null。担当のドリッパー（Drip.Dripper）とは別
	Dripper *int `json:"dripper"`
	Cups    int  `json:"cups"`
}

// Drip は抽出カード。1 回のドリップ（最大 2 杯）が 1 枚。
// 保存するのは事実だけ（どの注文の何杯か、担当、状態、開始・終了時刻）。待機カードの予定時刻は画面で計算する
// （抽出時間 1 杯 135 秒・2 杯 195 秒と予定時刻の決め方は modules/common/src/lib/caosTiming.ts。サーバーは持たない）。
type Drip struct {
	ID     string `json:"id"`
	Status Status `json:"status"`
	// 担当のドリッパー（1〜6）
	Dripper *int `json:"dripper"`
	// 待機列の並び順。ふだんは注文番号で、入れ直しのときだけ差し込む位置に合わせる
	QueuePos float64 `json:"queue_pos"`
	// 中身の注文。統合したカードは 2 注文になる
	OrderIDs []string   `json:"order_ids"`
	Lines    []DripLine `json:"lines"`
	Cups     int        `json:"cups"`
	// 入れ直しのカードなら、元のカード
	RebrewOf *string `json:"rebrew_of"`
	// 入れ直しのために途中でやめた抽出
	Interrupted bool       `json:"interrupted"`
	StartedAt   *time.Time `json:"started_at"`
	FinishedAt  *time.Time `json:"finished_at"`
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at"`
}

// Lane は列（ドリッパー 1〜6）の担当者。盤面には 1〜6 の 6 列が必ずあり、担当者がいない列は Name が空。
// 上級生（限定を淹れられる）かは、交代したときに画面が sohosai-shift の名簿で判定したものをそのまま持つ
// （名簿を読めない端末でも同じ表示になるように）。
type Lane struct {
	Dripper int `json:"dripper"`
	// 担当者の名前（前後の空白を落としたもの）。空なら担当者なし
	Name string `json:"name"`
	// 上級生（限定を淹れられる）か。担当者がいない列は false
	Senior bool `json:"senior"`
	// 最後に替えた時刻。一度も替えていない列は null（「1つ戻す」は、この値が操作の記録と同じときだけ戻す）
	UpdatedAt *time.Time `json:"updated_at"`
}

// Order は盤面が使う注文の中身（POS の orders と明細から作る）。
type Order struct {
	ID        string
	OrderNo   int
	CreatedAt time.Time
	Ready     bool
	Served    bool
	Lines     []OrderLine
}

// OrderLine は注文の明細の中の 1 品（メニューのセットは品ごとに分ける）。
type OrderLine struct {
	// 明細の指名の番号（dripper。1〜6、指名なしは nil）
	Dripper  *int
	ItemID   string
	Name     string
	Abbr     string
	Type     string
	Quantity int
}

// Op は画面からの操作。Name で種類を分け、使うフィールドだけを埋める。
type Op struct {
	Name string `json:"name"`
	// assign・unassign。next では任意で、終わらせるカード（今抽出中のカードと違えば断る）
	DripID string `json:"drip_id,omitempty"`
	// assign・next・rebrew（rebrew は null なら未割当に置く）
	Dripper *int `json:"dripper,omitempty"`
	// merge
	FirstID  string `json:"first_id,omitempty"`
	SecondID string `json:"second_id,omitempty"`
	// rebrew
	SourceID  string   `json:"source_id,omitempty"`
	Cups      int      `json:"cups,omitempty"`
	Interrupt bool     `json:"interrupt,omitempty"`
	QueuePos  *float64 `json:"queue_pos,omitempty"`
	// undo（1つ戻す）：戻す操作。操作の結果の op_id
	OpID string `json:"op_id,omitempty"`
	// set_lane（dripper の列の担当者を替える）：名前（空なら担当者なし）と、上級生か
	Person string `json:"person,omitempty"`
	Senior bool   `json:"senior,omitempty"`
	// swap_lanes（dripper の列と other_dripper の列の担当者を入れ替える）
	OtherDripper *int `json:"other_dripper,omitempty"`
}

// Result は操作の結果。呼んだ画面はこれですぐ反映する。
type Result struct {
	// この操作の記録の ID。「1つ戻す」（undo）で指定する。undo そのものの結果では空
	OpID    string   `json:"op_id"`
	Changed []Drip   `json:"changed"`
	Deleted []string `json:"deleted"`
	// この操作で準備完了にした注文（undo では、準備完了を外した注文）
	Readied []string `json:"readied"`
	// この操作で変わった列の担当者（undo では、戻した列）
	Lanes []Lane `json:"lanes"`
}
