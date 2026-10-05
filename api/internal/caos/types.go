// Package caos は CaOS（ドリップ管制）の盤面。抽出カードの保存と、割当・次へ・統合などのルールを持つ。
//
// 盤面は営業日（日本時間）ごとに 1 つ。カードは POS の注文から作り、注文のカードが全部終わったら注文を準備完了にする。
// 書き込みは全部この API を通るので、POS の注文のハンドラーと同じトランザクションの中で連動させる（DB のトリガーは使わない）。
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
// 注文番号や商品名はカードを作った時点のものを写しておく（画面が注文を引かずに済むように）。
type DripLine struct {
	OrderID string  `json:"order_id"`
	OrderNo int     `json:"order_no"`
	ItemID  string  `json:"item_id"`
	Name    string  `json:"name"`
	Abbr    string  `json:"abbr"`
	Type    string  `json:"type"`
	Nominee *string `json:"nominee"`
	Cups    int     `json:"cups"`
}

// Drip は抽出カード。1 回のドリップ（最大 2 杯）が 1 枚。
// 保存するのは事実だけ（どの注文の何杯か、担当、状態、開始・終了時刻）。待機カードの予定時刻は画面で計算する。
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
	Assignee *string
	ItemID   string
	Name     string
	Abbr     string
	Type     string
	Quantity int
}

// Op は画面からの操作。Name で種類を分け、使うフィールドだけを埋める。
type Op struct {
	Name string `json:"name"`
	// assign・unassign
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
	// restore
	Before  []Drip   `json:"before,omitempty"`
	After   []Drip   `json:"after,omitempty"`
	Readied []string `json:"readied,omitempty"`
}

// Result は操作の結果。呼んだ画面はこれですぐ反映し、「1つ戻す」に使う。
type Result struct {
	Day     string   `json:"day"`
	Version int64    `json:"v"`
	Changed []Drip   `json:"changed"`
	Deleted []string `json:"deleted"`
	// この操作で準備完了にした注文
	Readied []string `json:"readied"`
}
