// Package caos は CaOS（ドリップ管制）の盤面の決まり。DB を使わない純粋な関数だけを置く。
//
// 盤面はカップ中心で、注文のカップ（order_cups）を正とする。CaOS が決めたことだけをカップに足す：
//   - Cup.DripID：最初に淹れたカード
//   - Cup.EmergencyAt：緊急（入れ直し）にした時刻
//   - Cup.EmergencyDripID：入れ直しで淹れたカード
//
// カード（Drip）が持つのは、担当の列・列の中の順番・状態・時刻・中断・緊急のカードかだけで、
// 中身（どのカップを淹れるか）はカップから引く。未割当のカードは保存せず、読むたびにカップから組み立てる（Cards）。
//
// 置き場所：表のモデルは models の CaosDrip（caos_drips）・CaosOpRecord（caos_ops）、
// 読み書き・API・配信は handlers/caos.go。練習用の盤面もこの決まりをそのまま使えるよう、ここはカップの構造体の上だけで動く。
package caos

import (
	"cmp"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"
)

// Status はカードの状態。保存するカードは queued・brewing・done のどれか。
type Status string

const (
	// StatusUnassigned は未割当（保存しない。カップから組み立てる）。
	StatusUnassigned Status = "unassigned"
	// StatusQueued は列の待機。
	StatusQueued Status = "queued"
	// StatusBrewing は抽出中。1 つの列で同時に抽出中は 1 枚だけ。
	StatusBrewing Status = "brewing"
	// StatusDone は抽出終了。
	StatusDone Status = "done"
)

const (
	// Lanes は列（ドリッパー）の数。列は 1〜Lanes。
	Lanes = 6
	// MaxCups は 1 枚のカード（1 回のドリップ）で淹れる最大の杯数。
	MaxCups = 2
)

// Cup は盤面が使う注文の 1 杯。
type Cup struct {
	ID      uuid.UUID
	OrderID uuid.UUID
	// 注文番号
	OrderNo int
	// 注文の中の並び順
	Position int
	ItemID   uuid.UUID
	ItemName string
	// 商品の種類の名前（hot・ice・milk・others など）
	ItemType string
	// 指名（明細の assignee の前後の空白を落としたもの。無ければ nil）
	Nominee  *string
	ReadyAt  *time.Time
	ServedAt *time.Time

	DripID          *uuid.UUID
	EmergencyAt     *time.Time
	EmergencyDripID *uuid.UUID
}

// Drip は保存するカード（caos_drips の 1 行）。中身はカップから引く。
type Drip struct {
	ID   uuid.UUID `json:"id"`
	Lane int       `json:"lane"`
	// 列の中の順番（小さいほど先）。ふつうは注文番号。緊急のカードは順番にかかわらず先に並ぶ
	Position    float64    `json:"position"`
	Status      Status     `json:"status"`
	Emergency   bool       `json:"emergency"`
	Interrupted bool       `json:"interrupted"`
	StartedAt   *time.Time `json:"started_at"`
	FinishedAt  *time.Time `json:"finished_at"`
	CreatedAt   time.Time  `json:"created_at"`
}

// Board は 1 つの営業日の盤面（保存したカードと、その日の注文のカップ）。
type Board struct {
	Drips []Drip
	Cups  []Cup
}

// Clone は書き換えても元に響かない写し。
func (b *Board) Clone() Board {
	cups := make([]Cup, len(b.Cups))
	copy(cups, b.Cups)
	return Board{Drips: slices.Clone(b.Drips), Cups: cups}
}

// NeedsDrip は抽出の要る商品の種類か。アイスミルク（milk）とグッズ（others）は抽出しない。
func NeedsDrip(itemType string) bool { return itemType != "milk" && itemType != "others" }

// ---------------------------------------------------------------- エラー

// ErrInvalid はルールに合わない操作。
var ErrInvalid = errors.New("invalid")

// InvalidError はルールに合わない操作の理由。画面にそのまま出す。
type InvalidError struct{ Message string }

func (e *InvalidError) Error() string { return e.Message }
func (e *InvalidError) Unwrap() error { return ErrInvalid }

// IsInvalid はルールに合わない操作のエラーか。
func IsInvalid(err error) bool { return errors.Is(err, ErrInvalid) }

func invalid(format string, args ...any) error {
	return &InvalidError{Message: fmt.Sprintf(format, args...)}
}

// ---------------------------------------------------------------- 日付

var jst = time.FixedZone("JST", 9*60*60)

// Day は営業日（日本時間の日付。YYYY-MM-DD）。
func Day(t time.Time) string { return t.In(jst).Format(time.DateOnly) }

// DayRange はその営業日の始まりと終わり（日本時間の 0:00 から翌日の 0:00 まで）。
func DayRange(day string) (time.Time, time.Time, error) {
	start, err := time.ParseInLocation(time.DateOnly, day, jst)
	if err != nil {
		return time.Time{}, time.Time{}, err
	}
	return start, start.AddDate(0, 0, 1), nil
}

// ---------------------------------------------------------------- 内部の索引

func (b *Board) dripIndex(id uuid.UUID) int {
	return slices.IndexFunc(b.Drips, func(d Drip) bool { return d.ID == id })
}

func (b *Board) cupIndex(id uuid.UUID) int {
	return slices.IndexFunc(b.Cups, func(c Cup) bool { return c.ID == id })
}

// カードの中のカップ（緊急のカードは EmergencyDripID、ふつうのカードは DripID で指す）。並びは注文番号・注文の中の順。
func (b *Board) cupsOf(id uuid.UUID, emergency bool) []int {
	var out []int
	for i := range b.Cups {
		ref := b.Cups[i].DripID
		if emergency {
			ref = b.Cups[i].EmergencyDripID
		}
		if ref != nil && *ref == id {
			out = append(out, i)
		}
	}
	b.sortCups(out)
	return out
}

func (b *Board) sortCups(idx []int) {
	slices.SortStableFunc(idx, func(x, y int) int {
		a, c := &b.Cups[x], &b.Cups[y]
		return cmp.Or(cmp.Compare(a.OrderNo, c.OrderNo), strings.Compare(a.OrderID.String(), c.OrderID.String()), cmp.Compare(a.Position, c.Position))
	})
}

func latest(times ...*time.Time) *time.Time {
	var out *time.Time
	for _, t := range times {
		if t != nil && (out == nil || t.After(*out)) {
			v := *t
			out = &v
		}
	}
	return out
}

// Normalize は、注文の側で変わったことをカードに写す。読むたび（配信）と操作の前に呼ぶ。
//   - カップが 1 つも無くなったカード（注文の編集・削除で消えた）は除く
//   - ふつうのカードで、カップが全部準備完了になったもの（マスターで準備完了にした）は終わり扱いにする。
//     終わった時刻はカップの準備完了のいちばん遅い時刻。緊急のカードは「次へ」でだけ終わる（カップがもう準備完了のことが多いので）
func (b *Board) Normalize() {
	kept := b.Drips[:0:0]
	for _, d := range b.Drips {
		cups := b.cupsOf(d.ID, d.Emergency)
		if len(cups) == 0 {
			continue
		}
		if !d.Emergency && d.Status != StatusDone {
			var at []*time.Time
			for _, i := range cups {
				at = append(at, b.Cups[i].ReadyAt)
			}
			if !slices.Contains(at, nil) {
				d.Status = StatusDone
				d.FinishedAt = latest(at...)
			}
		}
		kept = append(kept, d)
	}
	b.Drips = kept
}

// ---------------------------------------------------------------- カード

// CardCup はカードの中の 1 杯。
type CardCup struct {
	ID          uuid.UUID  `json:"id"`
	EmergencyAt *time.Time `json:"emergency_at"`
}

// Card は画面に配るカード。保存したカードと、カップから組み立てた未割当のカード。
type Card struct {
	// 保存したカードの ID。未割当のカードは null（中のカップの ID で指す）。
	// ただし統合した未割当のカードは、カップに入れた ID を持つ
	ID          *uuid.UUID `json:"id"`
	Status      Status     `json:"status"`
	Lane        *int       `json:"lane"`
	Position    float64    `json:"position"`
	Emergency   bool       `json:"emergency"`
	Interrupted bool       `json:"interrupted"`
	StartedAt   *time.Time `json:"started_at"`
	FinishedAt  *time.Time `json:"finished_at"`
	Cups        []CardCup  `json:"cups"`
}

// 盤面の中のカード。cups は Board.Cups の添字、drip は Board.Drips の添字（未割当は -1）。
type card struct {
	Card
	cups []int
	drip int
}

func (b *Board) toCard(c card) Card {
	out := c.Card
	out.Cups = make([]CardCup, len(c.cups))
	for i, ci := range c.cups {
		out.Cups[i] = CardCup{ID: b.Cups[ci].ID, EmergencyAt: b.Cups[ci].EmergencyAt}
	}
	return out
}

// Cards は盤面の全部のカード。未割当（緊急がいちばん上、次に注文番号の順）、そのあと保存したカード（列・順番の順）。
// Normalize のあとに呼ぶこと。
func (b *Board) Cards() []Card {
	cards := b.cards()
	out := make([]Card, len(cards))
	for i, c := range cards {
		out[i] = b.toCard(c)
	}
	return out
}

func (b *Board) cards() []card {
	out := b.unassigned()
	saved := b.savedOrder()
	for _, i := range saved {
		d := b.Drips[i]
		lane := d.Lane
		out = append(out, card{
			Card: Card{
				ID: &d.ID, Status: d.Status, Lane: &lane, Position: d.Position, Emergency: d.Emergency,
				Interrupted: d.Interrupted, StartedAt: d.StartedAt, FinishedAt: d.FinishedAt,
			},
			cups: b.cupsOf(d.ID, d.Emergency),
			drip: i,
		})
	}
	return out
}

// 保存したカードの並び：列、状態（終了・抽出中・待機）、待機は順番。
func (b *Board) savedOrder() []int {
	idx := make([]int, len(b.Drips))
	for i := range idx {
		idx[i] = i
	}
	rank := map[Status]int{StatusDone: 0, StatusBrewing: 1, StatusQueued: 2}
	slices.SortStableFunc(idx, func(x, y int) int {
		a, c := &b.Drips[x], &b.Drips[y]
		if r := cmp.Or(cmp.Compare(a.Lane, c.Lane), cmp.Compare(rank[a.Status], rank[c.Status])); r != 0 {
			return r
		}
		if a.Status == StatusDone {
			return cmp.Compare(timeKey(a.FinishedAt), timeKey(c.FinishedAt))
		}
		return compareQueued(a, c)
	})
	return idx
}

func timeKey(t *time.Time) int64 {
	if t == nil {
		return 0
	}
	return t.UnixMicro()
}

// 待機の並び：緊急が先、次に順番、作った順。
func compareQueued(a, c *Drip) int {
	return cmp.Or(
		-cmp.Compare(boolInt(a.Emergency), boolInt(c.Emergency)),
		cmp.Compare(a.Position, c.Position),
		a.CreatedAt.Compare(c.CreatedAt),
		strings.Compare(a.ID.String(), c.ID.String()),
	)
}

func boolInt(v bool) int {
	if v {
		return 1
	}
	return 0
}

// 未割当のカードを組み立てる（#795 の分け方と同じ）。
//   - ふつう：抽出が要り、まだ準備完了でなく、まだカードに入っていないカップ。注文ごと・商品ごと・指名ごとに分け、1 枚は最大 2 杯
//     （並びは種類・商品名・指名の順。指名の無いものが先）
//   - 統合した未割当：カップに入った ID のカードがまだ保存されていない（統合しただけで、まだ割り当てていない）もの。その ID ごとに 1 枚
//   - 緊急：緊急の印があり、まだ入れ直しのカードに入っていないカップ。分け方はふつうと同じ
//
// 並びは、緊急がいちばん上（印を付けた順）、そのあと注文番号の順。
func (b *Board) unassigned() []card {
	saved := map[uuid.UUID]bool{}
	for _, d := range b.Drips {
		saved[d.ID] = true
	}
	idx := make([]int, len(b.Cups))
	for i := range idx {
		idx[i] = i
	}
	b.sortCups(idx)

	type groupKey struct {
		order     uuid.UUID
		item      uuid.UUID
		nominee   string
		emergency bool
	}
	type group struct {
		key     groupKey
		id      *uuid.UUID
		cups    []int
		keyCups int // 並べるときに見るカップ
	}
	var groups []*group
	byKey := map[groupKey]*group{}
	byDrip := map[uuid.UUID]*group{}
	add := func(k groupKey, i int) {
		g, ok := byKey[k]
		if !ok {
			g = &group{key: k, keyCups: i}
			byKey[k] = g
			groups = append(groups, g)
		}
		g.cups = append(g.cups, i)
	}
	for _, i := range idx {
		c := &b.Cups[i]
		nominee := ""
		if c.Nominee != nil {
			nominee = *c.Nominee
		}
		if c.EmergencyAt != nil && (c.EmergencyDripID == nil || !saved[*c.EmergencyDripID]) {
			add(groupKey{order: c.OrderID, item: c.ItemID, nominee: nominee, emergency: true}, i)
		}
		if !NeedsDrip(c.ItemType) || c.ReadyAt != nil {
			continue
		}
		switch {
		case c.DripID == nil:
			add(groupKey{order: c.OrderID, item: c.ItemID, nominee: nominee}, i)
		case !saved[*c.DripID]:
			g, ok := byDrip[*c.DripID]
			if !ok {
				id := *c.DripID
				g = &group{id: &id, keyCups: i}
				byDrip[id] = g
				groups = append(groups, g)
			}
			g.cups = append(g.cups, i)
		}
	}

	type unit struct {
		card
		sortCup   int
		emergency *time.Time
	}
	var units []unit
	for _, g := range groups {
		if g.id != nil {
			units = append(units, unit{card: card{Card: Card{ID: g.id}, cups: g.cups, drip: -1}, sortCup: g.keyCups})
			continue
		}
		for start := 0; start < len(g.cups); start += MaxCups {
			cups := g.cups[start:min(start+MaxCups, len(g.cups))]
			u := unit{card: card{Card: Card{Emergency: g.key.emergency}, cups: slices.Clone(cups), drip: -1}, sortCup: g.keyCups}
			if g.key.emergency {
				for _, i := range cups {
					u.emergency = latest(u.emergency, b.Cups[i].EmergencyAt)
				}
			}
			units = append(units, u)
		}
	}
	slices.SortStableFunc(units, func(x, y unit) int {
		a, c := &b.Cups[x.sortCup], &b.Cups[y.sortCup]
		return cmp.Or(
			-cmp.Compare(boolInt(x.Emergency), boolInt(y.Emergency)),
			cmp.Compare(timeKey(x.emergency), timeKey(y.emergency)),
			cmp.Compare(a.OrderNo, c.OrderNo),
			strings.Compare(a.OrderID.String(), c.OrderID.String()),
			strings.Compare(a.ItemType, c.ItemType),
			strings.Compare(a.ItemName, c.ItemName),
			strings.Compare(nomineeKey(a.Nominee), nomineeKey(c.Nominee)),
			cmp.Compare(a.Position, c.Position),
		)
	})
	out := make([]card, len(units))
	for i, u := range units {
		u.Status = StatusUnassigned
		u.Position = float64(i)
		out[i] = u.card
	}
	return out
}

func nomineeKey(n *string) string {
	if n == nil {
		return ""
	}
	return "\x01" + *n
}
