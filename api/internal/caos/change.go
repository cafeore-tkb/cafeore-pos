package caos

import (
	"cmp"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"
)

// CupMarks はカップのうち、操作で変わりうるもの（と、戻すときに確かめる提供済み）。
type CupMarks struct {
	DripID   *uuid.UUID `json:"drip_id"`
	ReadyAt  *time.Time `json:"ready_at"`
	ServedAt *time.Time `json:"served_at"`
}

// Marks はカップの今の CupMarks。
func (c *Cup) Marks() CupMarks {
	return CupMarks{DripID: c.DripID, ReadyAt: c.ReadyAt, ServedAt: c.ServedAt}
}

// SetMarks はカップに CupMarks を書く。
func (c *Cup) SetMarks(m CupMarks) {
	c.DripID, c.ReadyAt, c.ServedAt = m.DripID, m.ReadyAt, m.ServedAt
}

// Equal は同じ中身か（時刻は Equal で比べる）。
func (m CupMarks) Equal(o CupMarks) bool {
	return sameID(m.DripID, o.DripID) && sameTime(m.ReadyAt, o.ReadyAt) && sameTime(m.ServedAt, o.ServedAt)
}

// Equal は同じ中身か（時刻は Equal で比べる）。
func (d Drip) Equal(o Drip) bool {
	return d.ID == o.ID && d.Lane == o.Lane && d.Position == o.Position && d.Status == o.Status &&
		sameTime(d.StartedAt, o.StartedAt) && sameTime(d.FinishedAt, o.FinishedAt) && d.CreatedAt.Equal(o.CreatedAt)
}

func sameID(a, b *uuid.UUID) bool {
	return (a == nil && b == nil) || (a != nil && b != nil && *a == *b)
}

func sameTime(a, b *time.Time) bool {
	return (a == nil && b == nil) || (a != nil && b != nil && a.Equal(*b))
}

// DripChange は 1 枚のカードの前後。Before が nil なら作った、After が nil なら消した。
type DripChange struct {
	ID     uuid.UUID `json:"id"`
	Before *Drip     `json:"before"`
	After  *Drip     `json:"after"`
}

// CupChange は 1 杯のカップの前後。
type CupChange struct {
	ID      uuid.UUID `json:"id"`
	OrderID uuid.UUID `json:"order_id"`
	Before  CupMarks  `json:"before"`
	After   CupMarks  `json:"after"`
}

// Change は盤面の変わったところ。保存（handlers）と、操作の記録（「1つ戻す」）に使う。
type Change struct {
	Drips []DripChange `json:"drips"`
	Cups  []CupChange  `json:"cups"`
}

// Empty は何も変わっていないこと。
func (c Change) Empty() bool { return len(c.Drips) == 0 && len(c.Cups) == 0 }

// Diff は before から after への変わったところ。並びは ID の順（毎回同じにする）。
// カップは before にあるものだけを見る（操作でカップが増えたり減ったりはしない）。
func Diff(before, after *Board) Change {
	ch := Change{Drips: []DripChange{}, Cups: []CupChange{}}
	ids := map[uuid.UUID]bool{}
	for _, d := range before.Drips {
		ids[d.ID] = true
	}
	for _, d := range after.Drips {
		ids[d.ID] = true
	}
	for id := range ids {
		var x, y *Drip
		if i := before.dripIndex(id); i >= 0 {
			v := before.Drips[i]
			x = &v
		}
		if i := after.dripIndex(id); i >= 0 {
			v := after.Drips[i]
			y = &v
		}
		if x != nil && y != nil && x.Equal(*y) {
			continue
		}
		ch.Drips = append(ch.Drips, DripChange{ID: id, Before: x, After: y})
	}
	slices.SortFunc(ch.Drips, func(a, b DripChange) int { return strings.Compare(a.ID.String(), b.ID.String()) })

	afterCups := make(map[uuid.UUID]*Cup, len(after.Cups))
	for i := range after.Cups {
		afterCups[after.Cups[i].ID] = &after.Cups[i]
	}
	for i := range before.Cups {
		x := &before.Cups[i]
		y, ok := afterCups[x.ID]
		if !ok || x.Marks().Equal(y.Marks()) {
			continue
		}
		ch.Cups = append(ch.Cups, CupChange{ID: x.ID, OrderID: x.OrderID, Before: x.Marks(), After: y.Marks()})
	}
	slices.SortFunc(ch.Cups, func(a, b CupChange) int {
		return cmp.Or(strings.Compare(a.OrderID.String(), b.OrderID.String()), strings.Compare(a.ID.String(), b.ID.String()))
	})
	return ch
}

// Revert は「1つ戻す」。記録した操作の変わったところ（ch）を、操作の前に戻す。
// 操作のあと、関係するカードとカップが誰にも触られていない（今が ch.After と同じ）ときだけ戻す。
// 確かめてから変えるので、断ったとき（ErrInvalid）は何も変わっていない。Normalize のあとに呼ぶこと。
func (b *Board) Revert(ch Change) error {
	for _, dc := range ch.Drips {
		i := b.dripIndex(dc.ID)
		if (dc.After == nil) != (i < 0) || (i >= 0 && !b.Drips[i].Equal(*dc.After)) {
			return invalid("ほかの端末で変更されたため、元に戻せません")
		}
	}
	for _, cc := range ch.Cups {
		i := b.cupIndex(cc.ID)
		if i < 0 {
			return invalid("注文が変わったため、元に戻せません")
		}
		if !b.Cups[i].Marks().Equal(cc.After) {
			return invalid("ほかの端末で変更されたため、元に戻せません")
		}
	}
	// 戻したあとに、1 つの列で抽出中が重ならないか（ほかの操作でその列が次のカードを始めていたら戻さない）
	brewing := map[int]bool{}
	touched := map[uuid.UUID]bool{}
	for _, dc := range ch.Drips {
		touched[dc.ID] = true
	}
	for _, d := range b.Drips {
		if !touched[d.ID] && d.Status == StatusBrewing {
			brewing[d.Lane] = true
		}
	}
	for _, dc := range ch.Drips {
		if dc.Before == nil || dc.Before.Status != StatusBrewing {
			continue
		}
		if brewing[dc.Before.Lane] {
			return invalid("列 %d がほかのカードを抽出中のため、元に戻せません", dc.Before.Lane)
		}
		brewing[dc.Before.Lane] = true
	}

	for _, dc := range ch.Drips {
		i := b.dripIndex(dc.ID)
		switch {
		case dc.Before == nil:
			b.Drips = slices.Delete(b.Drips, i, i+1)
		case i < 0:
			b.Drips = append(b.Drips, *dc.Before)
		default:
			b.Drips[i] = *dc.Before
		}
	}
	for _, cc := range ch.Cups {
		b.Cups[b.cupIndex(cc.ID)].SetMarks(cc.Before)
	}
	return nil
}
