package caos

import (
	"slices"
	"time"

	"github.com/google/uuid"
)

// 画面からの操作。どれも「確かめてから変える」順に書く。ErrInvalid のときは盤面は何も変わっていない。
// 1 つの盤面への操作は、呼ぶ側（handlers）がその日の advisory lock を取って 1 件ずつ順番に呼ぶので、ここではロックを考えない。

// 操作の名前。
const (
	OpAssign    = "assign"
	OpUnassign  = "unassign"
	OpNext      = "next"
	OpMerge     = "merge"
	OpEmergency = "emergency"
	OpUndo      = "undo"
)

// CardRef はカードの指し方。保存したカード（と統合した未割当のカード）は ID、
// 未割当のカードは中のカップの ID の組（配った Card.Cups と同じ組）で指す。
type CardRef struct {
	ID     *uuid.UUID
	CupIDs []uuid.UUID
}

// Op は画面からの操作。Name で種類を選び、使うものだけを埋める。
type Op struct {
	Name string
	// assign・unassign・merge の対象。next では任意で、画面が抽出中と見ていたカード（今の抽出中と違えば断る）
	Card *CardRef
	// merge の相手
	With *CardRef
	// assign・next の列（1〜6）
	Lane int
	// assign：列の待機の中の位置（0 始まり。緊急とふつうのカードはそれぞれの中で数える）。nil なら注文番号の順
	Index *int
	// emergency：緊急にするカップ
	CupIDs []uuid.UUID
	// emergency：抽出中なら中断する（そのカードのカップを全部緊急にする）
	Interrupt bool
}

// Apply は操作を 1 つ行う。now は操作の時刻、newID は新しいカードの ID を作る。
func (b *Board) Apply(op Op, now time.Time, newID func() uuid.UUID) error {
	switch op.Name {
	case OpAssign:
		return b.assign(op.Card, op.Lane, op.Index, now, newID)
	case OpUnassign:
		return b.unassign(op.Card)
	case OpNext:
		return b.next(op.Lane, op.Card, now)
	case OpMerge:
		return b.merge(op.Card, op.With, newID)
	case OpEmergency:
		return b.emergency(op.CupIDs, op.Interrupt, now)
	default:
		return invalid("知らない操作です")
	}
}

func validLane(lane int) bool { return lane >= 1 && lane <= Lanes }

// find はカードを探す。
func (b *Board) find(ref *CardRef) (card, bool) {
	if ref == nil {
		return card{}, false
	}
	for _, c := range b.cards() {
		if ref.ID != nil {
			if c.ID != nil && *c.ID == *ref.ID {
				return c, true
			}
			continue
		}
		if c.ID == nil && sameCups(b, c.cups, ref.CupIDs) {
			return c, true
		}
	}
	return card{}, false
}

func sameCups(b *Board, cups []int, ids []uuid.UUID) bool {
	if len(cups) != len(ids) {
		return false
	}
	for _, i := range cups {
		if !slices.Contains(ids, b.Cups[i].ID) {
			return false
		}
	}
	return true
}

var errGone = invalid("このカードはもうありません（ほかの端末で変わったかもしれません）")

// カードの注文番号（中のカップのいちばん小さいもの）。
func (b *Board) orderNo(c card) int {
	n := 0
	for i, ci := range c.cups {
		if i == 0 || b.Cups[ci].OrderNo < n {
			n = b.Cups[ci].OrderNo
		}
	}
	return n
}

// queued は列の待機のカード（Drips の添字）を並びの順に返す。
func (b *Board) queued(lane int) []int {
	var out []int
	for i := range b.Drips {
		if b.Drips[i].Lane == lane && b.Drips[i].Status == StatusQueued {
			out = append(out, i)
		}
	}
	slices.SortFunc(out, func(x, y int) int { return compareQueued(&b.Drips[x], &b.Drips[y]) })
	return out
}

func (b *Board) brewing(lane int) int {
	return slices.IndexFunc(b.Drips, func(d Drip) bool { return d.Lane == lane && d.Status == StatusBrewing })
}

// 列の待機に入れるときの順番。index が nil なら注文番号。
// index があれば、同じ種類（緊急・ふつう）の待機の index 番目に入るよう、前後のカードの間の値にする。
func (b *Board) queuePosition(lane int, self uuid.UUID, emergency bool, orderNo int, index *int) float64 {
	if index == nil {
		return float64(orderNo)
	}
	var ps []float64
	for _, i := range b.queued(lane) {
		if d := b.Drips[i]; d.ID != self && d.Emergency == emergency {
			ps = append(ps, d.Position)
		}
	}
	i := max(0, min(*index, len(ps)))
	switch {
	case len(ps) == 0:
		return float64(orderNo)
	case i == 0:
		return ps[0] - 1
	case i == len(ps):
		return ps[len(ps)-1] + 1
	default:
		return (ps[i-1] + ps[i]) / 2
	}
}

// promote は列に抽出中が無ければ、待機の先頭の抽出を始める。
func (b *Board) promote(lane int, now time.Time) {
	if b.brewing(lane) >= 0 {
		return
	}
	if q := b.queued(lane); len(q) > 0 {
		d := &b.Drips[q[0]]
		d.Status = StatusBrewing
		d.StartedAt = &now
	}
}

// setCupsDrip はカードのカップにカードの ID を入れる（緊急のカードなら EmergencyDripID）。id が nil なら外す。
func (b *Board) setCupsDrip(cups []int, emergency bool, id *uuid.UUID) {
	for _, i := range cups {
		var v *uuid.UUID
		if id != nil {
			x := *id
			v = &x
		}
		if emergency {
			b.Cups[i].EmergencyDripID = v
		} else {
			b.Cups[i].DripID = v
		}
	}
}

// assign は未割当・待機のカードを列に入れる（別の列への移動・列の中の順番の入れ替えも同じ）。
// 未割当のカードはここで保存するカードになり、カップにその ID が入る。列が空いていればそのまま抽出を始める。
func (b *Board) assign(ref *CardRef, lane int, index *int, now time.Time, newID func() uuid.UUID) error {
	if !validLane(lane) {
		return invalid("列は 1〜%d です", Lanes)
	}
	c, ok := b.find(ref)
	if !ok {
		return errGone
	}
	switch c.Status {
	case StatusUnassigned:
		id := newID()
		if c.ID != nil {
			id = *c.ID // 統合した未割当のカードは、カップに入っている ID のまま保存する
		}
		b.setCupsDrip(c.cups, c.Emergency, &id)
		b.Drips = append(b.Drips, Drip{
			ID: id, Lane: lane, Status: StatusQueued, Emergency: c.Emergency, CreatedAt: now,
			Position: b.queuePosition(lane, id, c.Emergency, b.orderNo(c), index),
		})
	case StatusQueued:
		d := &b.Drips[c.drip]
		if d.Lane == lane && index == nil {
			return nil
		}
		d.Position = b.queuePosition(lane, d.ID, d.Emergency, b.orderNo(c), index)
		d.Lane = lane
	default:
		return invalid("抽出中・終了のカードは動かせません")
	}
	b.promote(lane, now)
	return nil
}

// unassign は待機のカードを未割当に戻す。カードの行を消し、カップの ID を空にする（統合していたカードは分かれる）。
func (b *Board) unassign(ref *CardRef) error {
	c, ok := b.find(ref)
	if !ok {
		return errGone
	}
	if c.Status != StatusQueued {
		return invalid("待機のカードだけ未割当に戻せます")
	}
	b.setCupsDrip(c.cups, c.Emergency, nil)
	b.Drips = slices.Delete(b.Drips, c.drip, c.drip+1)
	return nil
}

// next は「次へ」。列の抽出中のカードを終わらせ、そのカードのカップだけを準備完了にして、待機の次を始める。
//   - ふつうのカード：まだ準備完了でないカップを準備完了にする。緊急の印のあるカップは、入れ直しのカードで準備完了にするので触らない
//   - 緊急のカード：まだ準備完了でないカップを準備完了にする（もう準備完了・提供済みならそのまま）
//
// 注文の準備完了は、カップから決まる今の仕組み（保存する側）に任せる。
// 抽出中が無ければ（マスターで準備完了にして終わり扱いになった、など）待機の先頭を始めるだけ。
// ref を付けると、それが今の抽出中のときだけ終わらせる（二度押しや、ほかの端末と同時に押したときに次のカードまで終わらせない）。
func (b *Board) next(lane int, ref *CardRef, now time.Time) error {
	if !validLane(lane) {
		return invalid("列は 1〜%d です", Lanes)
	}
	i := b.brewing(lane)
	if ref != nil && ref.ID != nil && (i < 0 || b.Drips[i].ID != *ref.ID) {
		return invalid("このカードはもう終わっています（ほかの端末で「次へ」を押したかもしれません）")
	}
	if i < 0 {
		if len(b.queued(lane)) == 0 {
			return invalid("この列には抽出中・待機のカードがありません")
		}
		b.promote(lane, now)
		return nil
	}
	d := &b.Drips[i]
	d.Status = StatusDone
	d.FinishedAt = &now
	for _, ci := range b.cupsOf(d.ID, d.Emergency) {
		c := &b.Cups[ci]
		if c.ReadyAt == nil && (d.Emergency || c.EmergencyAt == nil) {
			c.ReadyAt = &now
		}
	}
	b.promote(lane, now)
	return nil
}

// merge は 1 杯のカード同士を 2 杯の同時抽出にまとめる（#795 と同じく、同じ商品・同じ指名で、緊急でないもの）。
//   - 未割当どうし：両方のカップに新しい同じ ID を入れる（カードの行はまだ作らない。割り当てたときに作る）
//   - 待機どうし：相手のカップに、こちらのカードの ID を入れ、相手のカードの行を消す（こちらの列・順番のまま）
func (b *Board) merge(first, second *CardRef, newID func() uuid.UUID) error {
	a, ok1 := b.find(first)
	c, ok2 := b.find(second)
	if !ok1 || !ok2 {
		return errGone
	}
	if !canMerge(b, a, c) {
		return invalid("このカード同士は統合できません")
	}
	if a.Status == StatusUnassigned {
		id := newID()
		b.setCupsDrip(append(slices.Clone(a.cups), c.cups...), false, &id)
		return nil
	}
	b.setCupsDrip(c.cups, false, a.ID)
	b.Drips = slices.Delete(b.Drips, c.drip, c.drip+1)
	return nil
}

func canMerge(b *Board, a, c card) bool {
	if a.Status != c.Status || (a.Status != StatusUnassigned && a.Status != StatusQueued) ||
		a.Emergency || c.Emergency || len(a.cups) != 1 || len(c.cups) != 1 || a.cups[0] == c.cups[0] {
		return false
	}
	x, y := b.Cups[a.cups[0]], b.Cups[c.cups[0]]
	return x.ItemID == y.ItemID && nomineeKey(x.Nominee) == nomineeKey(y.Nominee)
}

// emergency は緊急（入れ直し）。カップに緊急の印（EmergencyAt）を付けるだけで、入れ直しのカードは未割当にカップから組み立てる。
// カップは、抽出中か終了のカードに入っている、同じカードのものだけ。もう印のあるカップは何もしない（2 回は緊急にしない）。
// interrupt で、抽出中のカードを中断にして終わらせ、そのカードのカップを全部緊急にする（列は次を始める）。
func (b *Board) emergency(cupIDs []uuid.UUID, interrupt bool, now time.Time) error {
	if len(cupIDs) == 0 {
		return invalid("緊急にするカップを選んでください")
	}
	drip := -1
	var targets []int
	for _, id := range cupIDs {
		ci := b.cupIndex(id)
		if ci < 0 || b.Cups[ci].DripID == nil {
			return invalid("このカップは緊急にできません（割り当てたカードのカップだけです）")
		}
		di := b.dripIndex(*b.Cups[ci].DripID)
		if di < 0 || (drip >= 0 && di != drip) {
			return invalid("緊急にするカップは同じカードのものだけです")
		}
		drip = di
		targets = append(targets, ci)
	}
	d := &b.Drips[drip]
	if d.Status != StatusBrewing && d.Status != StatusDone {
		return invalid("抽出中か終了のカードだけ緊急にできます")
	}
	if interrupt && d.Status == StatusBrewing {
		d.Status = StatusDone
		d.Interrupted = true
		d.FinishedAt = &now
		targets = b.cupsOf(d.ID, false)
		defer b.promote(d.Lane, now)
	}
	for _, ci := range targets {
		if b.Cups[ci].EmergencyAt == nil {
			b.Cups[ci].EmergencyAt = &now
		}
	}
	return nil
}
