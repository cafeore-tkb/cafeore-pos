package caos

import (
	"cmp"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"
)

// 盤面のルール。DB には触らず、メモリ上のカードと注文だけを変える（テストはここに厚く書く）。
// 1 つの盤面（営業日）への処理は Store が行ロックで 1 件ずつ順番に呼ぶので、ここではロックを考えない。
// 操作は「確かめてから変える」順に書く。ErrInvalid のときは何も変わっていない。

// ErrInvalid はルールに合わない操作。画面には理由をそのまま出す。
var ErrInvalid = errors.New("invalid")

// InvalidError はルールに合わない操作の理由。
type InvalidError struct{ Message string }

func (e *InvalidError) Error() string { return e.Message }
func (e *InvalidError) Unwrap() error { return ErrInvalid }

func invalid(format string, args ...any) error {
	return &InvalidError{Message: fmt.Sprintf(format, args...)}
}

// OrderState は盤面が覚えている注文の状態。
type OrderState struct {
	ID        string
	OrderNo   int
	CreatedAt time.Time
	Ready     bool
	Served    bool
}

// orderedSet は入れた順を覚えている集合（結果の並びを毎回同じにするため）。
type orderedSet struct {
	keys []string
	has  map[string]bool
}

func (s *orderedSet) add(k string) {
	if s.has == nil {
		s.has = map[string]bool{}
	}
	if !s.has[k] {
		s.has[k] = true
		s.keys = append(s.keys, k)
	}
}

func (s *orderedSet) remove(k string) {
	if s.has[k] {
		delete(s.has, k)
		s.keys = slices.DeleteFunc(s.keys, func(x string) bool { return x == k })
	}
}

func (s *orderedSet) contains(k string) bool { return s.has[k] }

// List は入れた順の要素。
func (s *orderedSet) List() []string { return slices.Clone(s.keys) }

func (s *orderedSet) Len() int { return len(s.keys) }

// Changeset は処理で起きた変更。保存と配信に使う。
type Changeset struct {
	Changed orderedSet
	Deleted orderedSet
	// カードが全部終わった（準備完了にしてよい）注文
	Completed orderedSet
}

func (cs *Changeset) touch(id string) {
	cs.Changed.add(id)
	cs.Deleted.remove(id)
}

func (cs *Changeset) drop(id string) {
	cs.Changed.remove(id)
	cs.Deleted.add(id)
}

// Empty はカードが何も変わっていないこと。
func (cs *Changeset) Empty() bool { return cs.Changed.Len() == 0 && cs.Deleted.Len() == 0 }

// Board は 1 つの営業日の盤面。
type Board struct {
	Drips  map[string]*Drip
	Orders map[string]*OrderState
	clock  func() time.Time
	newID  func() string
}

// MonotonicClock は 1 マイクロ秒ずつは必ず進む時計（DB の timestamptz の精度に合わせる。
// 「1つ戻す」は updated_at が同じかで、ほかの端末が触っていないかを見るため）。
func MonotonicClock(now func() time.Time) func() time.Time {
	var last time.Time
	return func() time.Time {
		t := now().Truncate(time.Microsecond)
		if !t.After(last) {
			t = last.Add(time.Microsecond)
		}
		last = t
		return t
	}
}

// NewBoard は盤面を作る。clock・newID が nil なら今の時刻と UUID を使う。
func NewBoard(drips []Drip, orders []OrderState, clock func() time.Time, newID func() string) *Board {
	b := &Board{Drips: map[string]*Drip{}, Orders: map[string]*OrderState{}, clock: clock, newID: newID}
	if b.clock == nil {
		b.clock = MonotonicClock(time.Now)
	}
	if b.newID == nil {
		b.newID = func() string { return uuid.NewString() }
	}
	for i := range drips {
		d := drips[i]
		b.Drips[d.ID] = &d
	}
	for i := range orders {
		o := orders[i]
		b.Orders[o.ID] = &o
	}
	return b
}

func compareQueue(a, b *Drip) int {
	return cmp.Or(cmp.Compare(a.QueuePos, b.QueuePos), a.CreatedAt.Compare(b.CreatedAt), strings.Compare(a.ID, b.ID))
}

// List は作った順の全カード。
func (b *Board) List() []Drip {
	list := make([]*Drip, 0, len(b.Drips))
	for _, d := range b.Drips {
		list = append(list, d)
	}
	slices.SortFunc(list, func(x, y *Drip) int { return cmp.Or(x.CreatedAt.Compare(y.CreatedAt), strings.Compare(x.ID, y.ID)) })
	out := make([]Drip, len(list))
	for i, d := range list {
		out[i] = *d
	}
	return out
}

// Rows は指定したカードの今の中身（消えたものは飛ばす）。
func (b *Board) Rows(ids []string) []Drip {
	out := make([]Drip, 0, len(ids))
	for _, id := range ids {
		if d, ok := b.Drips[id]; ok {
			out = append(out, *d)
		}
	}
	return out
}

func (b *Board) sorted(filter func(*Drip) bool) []*Drip {
	var out []*Drip
	for _, d := range b.Drips {
		if filter(d) {
			out = append(out, d)
		}
	}
	slices.SortFunc(out, compareQueue)
	return out
}

func (b *Board) update(cs *Changeset, d *Drip, patch func(*Drip)) {
	patch(d)
	d.UpdatedAt = b.clock()
	cs.touch(d.ID)
}

func (b *Board) insert(cs *Changeset, d Drip) *Drip {
	at := b.clock()
	d.ID, d.CreatedAt, d.UpdatedAt = b.newID(), at, at
	b.Drips[d.ID] = &d
	cs.touch(d.ID)
	return &d
}

func (b *Board) delete(cs *Changeset, id string) {
	delete(b.Drips, id)
	cs.drop(id)
}

func onlyOrder(d *Drip, orderID string) bool { return len(d.OrderIDs) == 1 && d.OrderIDs[0] == orderID }

func isDripper(n int) bool { return n >= 1 && n <= 6 }

func ptr[T any](v T) *T { return &v }

func sameNominee(a, b *string) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}

func distinctOrders(lines []DripLine) []string {
	var out []string
	for _, l := range lines {
		if !slices.Contains(out, l.OrderID) {
			out = append(out, l.OrderID)
		}
	}
	return out
}

func sumCups(lines []DripLine) int {
	n := 0
	for _, l := range lines {
		n += l.Cups
	}
	return n
}

// ---------------------------------------------------------------- 内部

// promote はドリッパーが空いていれば、待機列の先頭の抽出を始める。
func (b *Board) promote(cs *Changeset, dripper *int) {
	if dripper == nil {
		return
	}
	n := *dripper
	for _, d := range b.Drips {
		if d.Dripper != nil && *d.Dripper == n && d.Status == StatusBrewing {
			return
		}
	}
	queued := b.sorted(func(d *Drip) bool { return d.Dripper != nil && *d.Dripper == n && d.Status == StatusQueued })
	if len(queued) > 0 {
		b.update(cs, queued[0], func(d *Drip) {
			d.Status = StatusBrewing
			d.StartedAt = ptr(b.clock())
		})
	}
}

// completeOrders はカードが全部抽出終了になった注文を Completed に入れる（入れ直しのカードも終わるまで待つ。既に準備完了ならそのまま）。
// 準備完了そのものは盤面では付けない（既存の注文の API が付ける）。
func (b *Board) completeOrders(cs *Changeset, orderIDs []string) {
	for _, id := range orderIDs {
		o, ok := b.Orders[id]
		if !ok || o.Ready {
			continue
		}
		mine, done := 0, true
		for _, d := range b.Drips {
			if slices.Contains(d.OrderIDs, id) {
				mine++
				done = done && d.Status == StatusDone
			}
		}
		if mine == 0 || !done {
			continue
		}
		o.Ready = true
		cs.Completed.add(id)
	}
}

type wantedItem struct {
	ItemID, Name, Abbr, Type string
	Nominee                  *string
	Cups                     int
}

// wantedItems は注文の明細から、抽出するもの（商品と指名ごとの杯数）。アイスミルク（milk）とグッズ（others）は抽出しない。
func wantedItems(o Order) []wantedItem {
	var items []*wantedItem
	for _, l := range o.Lines {
		if l.Type == "others" || l.Type == "milk" || l.Quantity <= 0 {
			continue
		}
		var nominee *string
		if l.Assignee != nil {
			if s := strings.TrimSpace(*l.Assignee); s != "" {
				nominee = &s
			}
		}
		i := slices.IndexFunc(items, func(w *wantedItem) bool { return w.ItemID == l.ItemID && sameNominee(w.Nominee, nominee) })
		if i >= 0 {
			items[i].Cups += l.Quantity
			continue
		}
		items = append(items, &wantedItem{ItemID: l.ItemID, Name: l.Name, Abbr: l.Abbr, Type: l.Type, Nominee: nominee, Cups: l.Quantity})
	}
	slices.SortStableFunc(items, func(a, c *wantedItem) int {
		nominee := func(n *string) string {
			if n == nil {
				return ""
			}
			return "\x01" + *n
		}
		return cmp.Or(strings.Compare(a.Type, c.Type), strings.Compare(a.Name, c.Name), strings.Compare(nominee(a.Nominee), nominee(c.Nominee)))
	})
	out := make([]wantedItem, len(items))
	for i, w := range items {
		out[i] = *w
	}
	return out
}

func canonicalLines(lines []DripLine) string {
	keyed := slices.Clone(lines)
	key := func(l DripLine) string {
		k, _ := json.Marshal([]any{l.ItemID, l.Nominee, l.Cups})
		return string(k)
	}
	slices.SortFunc(keyed, func(a, c DripLine) int { return strings.Compare(key(a), key(c)) })
	s, _ := json.Marshal(keyed)
	return string(s)
}

// syncOrder は注文の明細から、あるべき抽出カード（最大 2 杯ずつ）を作り直す。
// 作り直すのは「未割当で、その注文だけのカード」だけ。割当済み・抽出中・終了・統合・入れ直しのカードには触らず、
// その分の杯数を差し引いて足りない分だけ作る。中身が変わらないときは何もしない（カードの id が変わると、画面で選んでいたカードが外れる）。
func (b *Board) syncOrder(cs *Changeset, o Order) {
	var wanted []DripLine
	for _, item := range wantedItems(o) {
		locked := 0
		for _, d := range b.Drips {
			if !slices.Contains(d.OrderIDs, o.ID) || d.RebrewOf != nil {
				continue
			}
			if d.Status == StatusUnassigned && onlyOrder(d, o.ID) {
				continue
			}
			for _, l := range d.Lines {
				if l.OrderID == o.ID && l.ItemID == item.ItemID && sameNominee(l.Nominee, item.Nominee) {
					locked += l.Cups
				}
			}
		}
		for remaining := item.Cups - locked; remaining > 0; remaining -= 2 {
			wanted = append(wanted, DripLine{
				OrderID: o.ID, ItemID: item.ItemID, Nominee: item.Nominee, Cups: min(2, remaining),
			})
		}
	}

	current := b.sorted(func(d *Drip) bool { return onlyOrder(d, o.ID) && d.Status == StatusUnassigned && d.RebrewOf == nil })
	currentLines := make([]DripLine, len(current))
	for i, d := range current {
		currentLines[i] = d.Lines[0]
	}
	if canonicalLines(currentLines) == canonicalLines(wanted) {
		return
	}
	for _, d := range current {
		b.delete(cs, d.ID)
	}
	for _, line := range wanted {
		b.insert(cs, Drip{
			Status: StatusUnassigned, QueuePos: float64(o.OrderNo), OrderIDs: []string{o.ID},
			Lines: []DripLine{line}, Cups: line.Cups,
		})
	}
}

// removeOrder は注文が消えたとき。終わっていないカードからその注文を外す。
func (b *Board) removeOrder(cs *Changeset, orderID string) {
	for _, d := range b.sorted(func(d *Drip) bool { return slices.Contains(d.OrderIDs, orderID) && d.Status != StatusDone }) {
		if onlyOrder(d, orderID) {
			b.delete(cs, d.ID)
			continue
		}
		b.update(cs, d, func(d *Drip) {
			d.Lines = slices.DeleteFunc(slices.Clone(d.Lines), func(l DripLine) bool { return l.OrderID == orderID })
			d.OrderIDs = slices.DeleteFunc(slices.Clone(d.OrderIDs), func(id string) bool { return id == orderID })
			d.Cups = sumCups(d.Lines)
		})
	}
	delete(b.Orders, orderID)
}

// finishOrder は注文が POS で準備完了・提供済みになったとき。その注文のカードを抽出終了にし、抽出中だったドリッパーは次を始める。
// 統合していた相手の注文も、それでカードが全部終わったなら準備完了にする。
func (b *Board) finishOrder(cs *Changeset, orderID string) {
	var drippers []int
	var others []string
	for _, d := range b.sorted(func(d *Drip) bool {
		return slices.Contains(d.OrderIDs, orderID) && d.Status != StatusDone && d.RebrewOf == nil
	}) {
		if d.Dripper != nil && !slices.Contains(drippers, *d.Dripper) {
			drippers = append(drippers, *d.Dripper)
		}
		for _, id := range d.OrderIDs {
			if id != orderID && !slices.Contains(others, id) {
				others = append(others, id)
			}
		}
		b.update(cs, d, func(d *Drip) {
			d.Status = StatusDone
			d.FinishedAt = ptr(b.clock())
		})
	}
	slices.Sort(drippers)
	for _, n := range drippers {
		b.promote(cs, ptr(n))
	}
	b.completeOrders(cs, others)
}

// ---------------------------------------------------------------- POS の注文を取り込む

// IngestOrders は POS の注文を盤面に反映する。何度同じものを受け取っても結果は同じ。
// full なら orders はその日の注文の全部で、載っていない注文は消えたとみなす。
func (b *Board) IngestOrders(cs *Changeset, orders []Order, full bool) {
	// この取り込みの中でカードが全部終わった注文（統合相手）は、渡された（古い）状態で上書きしない
	mine := func(id string) bool { return cs.Completed.contains(id) }
	seen := map[string]bool{}
	for _, o := range orders {
		seen[o.ID] = true
		state := &OrderState{ID: o.ID, OrderNo: o.OrderNo, CreatedAt: o.CreatedAt, Ready: o.Ready, Served: o.Served}
		if prev, ok := b.Orders[o.ID]; ok && mine(o.ID) {
			state.Ready = prev.Ready
		}
		b.Orders[o.ID] = state
		if mine(o.ID) {
			continue
		}
		if o.Ready || o.Served {
			b.finishOrder(cs, o.ID)
		} else {
			b.syncOrder(cs, o)
		}
	}
	if !full {
		return
	}
	known := map[string]bool{}
	for id := range b.Orders {
		known[id] = true
	}
	for _, d := range b.Drips {
		for _, id := range d.OrderIDs {
			known[id] = true
		}
	}
	ids := make([]string, 0, len(known))
	for id := range known {
		ids = append(ids, id)
	}
	slices.Sort(ids)
	for _, id := range ids {
		if !seen[id] && !mine(id) {
			b.removeOrder(cs, id)
		}
	}
}

// Snapshot は今のカードの写し（操作の前の中身を記録するのに使う）。
func (b *Board) Snapshot() map[string]Drip {
	out := make(map[string]Drip, len(b.Drips))
	for id, d := range b.Drips {
		c := *d
		c.Lines = slices.Clone(d.Lines)
		c.OrderIDs = slices.Clone(d.OrderIDs)
		out[id] = c
	}
	return out
}

// RemoveOrder は POS で注文が消えたとき。
func (b *Board) RemoveOrder(cs *Changeset, orderID string) { b.removeOrder(cs, orderID) }

// ---------------------------------------------------------------- 画面からの操作

// Apply は画面からの操作を 1 つ行う。
func (b *Board) Apply(cs *Changeset, op Op) error {
	dripper := func() (int, error) {
		if op.Dripper == nil || !isDripper(*op.Dripper) {
			return 0, invalid("ドリッパーは 1〜6 です")
		}
		return *op.Dripper, nil
	}
	switch op.Name {
	case "assign":
		n, err := dripper()
		if err != nil {
			return err
		}
		return b.assign(cs, op.DripID, n)
	case "unassign":
		return b.unassign(cs, op.DripID)
	case "next":
		n, err := dripper()
		if err != nil {
			return err
		}
		return b.next(cs, n, op.DripID)
	case "merge":
		return b.merge(cs, op.FirstID, op.SecondID)
	case "rebrew":
		return b.rebrew(cs, op.SourceID, op.Cups, op.Interrupt, op.Dripper, op.QueuePos)
	default:
		return invalid("知らない操作です")
	}
}

// assign は未割当・待機中のカードをドリッパーへ割り当てる（別のドリッパーへの移動も同じ）。ドリッパーが空いていれば、そのまま抽出を始める。
func (b *Board) assign(cs *Changeset, dripID string, dripper int) error {
	d, ok := b.Drips[dripID]
	if !ok || (d.Status != StatusUnassigned && d.Status != StatusQueued) {
		return invalid("このカードは割り当てられません")
	}
	b.update(cs, d, func(d *Drip) {
		d.Status = StatusQueued
		d.Dripper = ptr(dripper)
	})
	b.promote(cs, ptr(dripper))
	return nil
}

// unassign は待機中のカードを未割当に戻す。
func (b *Board) unassign(cs *Changeset, dripID string) error {
	d, ok := b.Drips[dripID]
	if !ok || d.Status != StatusQueued {
		return invalid("このカードは未割当に戻せません")
	}
	b.update(cs, d, func(d *Drip) {
		d.Status = StatusUnassigned
		d.Dripper = nil
	})
	return nil
}

// next は「次へ」。抽出中のカードを終わらせ、待機列の次を始める。注文のカードが全部終わったら、その注文を準備完了にする。
//
// dripID を付けると、それが今そのドリッパーで抽出中のカードのときだけ終わらせる（違えば ErrInvalid）。
// 画面が見ていたカードを送るので、二度押しやほかの端末と同時に押したときに、次のカードまで終わらせない。
func (b *Board) next(cs *Changeset, dripper int, dripID string) error {
	var brewing *Drip
	for _, d := range b.Drips {
		if d.Dripper != nil && *d.Dripper == dripper && d.Status == StatusBrewing {
			brewing = d
		}
	}
	if brewing == nil {
		return invalid("ドリッパー %d は抽出中ではありません", dripper)
	}
	if dripID != "" && brewing.ID != dripID {
		return invalid("このカードはもう終わっています（ほかの端末で「次へ」を押したかもしれません）")
	}
	b.update(cs, brewing, func(d *Drip) {
		d.Status = StatusDone
		d.FinishedAt = ptr(b.clock())
	})
	b.promote(cs, ptr(dripper))
	b.completeOrders(cs, brewing.OrderIDs)
	return nil
}

// merge は同じ商品・同じ指名の 1 杯の未割当カード同士を、2 杯の同時抽出にまとめる。
func (b *Board) merge(cs *Changeset, firstID, secondID string) error {
	first, ok1 := b.Drips[firstID]
	second, ok2 := b.Drips[secondID]
	if !ok1 || !ok2 || firstID == secondID ||
		first.Status != StatusUnassigned || second.Status != StatusUnassigned ||
		first.Cups != 1 || second.Cups != 1 ||
		first.RebrewOf != nil || second.RebrewOf != nil ||
		len(first.Lines) == 0 || len(second.Lines) == 0 ||
		first.Lines[0].ItemID != second.Lines[0].ItemID ||
		!sameNominee(first.Lines[0].Nominee, second.Lines[0].Nominee) {
		return invalid("このカード同士は統合できません")
	}
	b.update(cs, first, func(d *Drip) {
		d.Lines = append(slices.Clone(first.Lines), second.Lines...)
		d.OrderIDs = distinctOrders(d.Lines)
		d.Cups = 2
		d.QueuePos = min(first.QueuePos, second.QueuePos)
	})
	b.delete(cs, secondID)
	return nil
}

// rebrew は入れ直し。元のカード（抽出中・終了）と同じ中身で、杯数を選んだ新しいカードを作る。
// interrupt：抽出中の元のカードを途中でやめる。dripper：担当（nil なら未割当に置く）。
// queuePos：待機列での位置（画面が前後のカードの間の値を渡す）。nil なら元のカードの位置。
func (b *Board) rebrew(cs *Changeset, sourceID string, cups int, interrupt bool, dripper *int, queuePos *float64) error {
	if cups != 1 && cups != 2 {
		return invalid("杯数は 1〜2 杯です")
	}
	if dripper != nil && !isDripper(*dripper) {
		return invalid("ドリッパーは 1〜6 です")
	}
	src, ok := b.Drips[sourceID]
	if !ok || (src.Status != StatusBrewing && src.Status != StatusDone) {
		return invalid("このカードは入れ直せません")
	}
	// 明細の杯数が足りなくなるので、元のカードより多くは入れ直さない
	if cups > src.Cups {
		return invalid("元のカード（%d 杯）より多い杯数では入れ直せません", src.Cups)
	}
	if interrupt && src.Status == StatusBrewing {
		b.update(cs, src, func(d *Drip) {
			d.Status = StatusDone
			d.Interrupted = true
			d.FinishedAt = ptr(b.clock())
		})
	}
	// 杯数が元より少なければ、先頭の明細から必要な杯数だけ取る
	var lines []DripLine
	taken := 0
	for _, l := range src.Lines {
		if taken >= cups {
			break
		}
		n := min(l.Cups, cups-taken)
		l.Cups = n
		lines = append(lines, l)
		taken += n
	}
	status := StatusQueued
	if dripper == nil {
		status = StatusUnassigned
	}
	pos := src.QueuePos
	if queuePos != nil {
		pos = *queuePos
	}
	b.insert(cs, Drip{
		Status: status, Dripper: dripper, QueuePos: pos, OrderIDs: distinctOrders(lines),
		Lines: lines, Cups: cups, RebrewOf: ptr(src.ID),
	})
	b.promote(cs, src.Dripper)
	b.promote(cs, dripper)
	return nil
}

// Restore は「1つ戻す」で、記録しておいた操作をカードの上で取り消す（Store が caos_ops の記録から呼ぶ）。
// before：操作の前の行（操作で変わった・消えたカードの、操作の前の中身。サーバーが DB から取ったもの）。
// after：操作の後の行（操作で変わった・できたカード）。この時点から誰も触っていないときだけ戻す。
// 確かめてから変えるので、断ったときは何も変わっていない。確かめること：after のカードが触られていない、
// 戻したあとに抽出中が重ならない、終わっていないカードとして戻す注文が今もあって提供済み・準備完了でない。
func (b *Board) Restore(cs *Changeset, before, after []Drip) error {
	for _, a := range after {
		now, ok := b.Drips[a.ID]
		if !ok || !now.UpdatedAt.Equal(a.UpdatedAt) {
			return invalid("ほかの端末で変更されたため、元に戻せません")
		}
	}
	beforeIDs := map[string]bool{}
	for _, d := range before {
		beforeIDs[d.ID] = true
	}
	afterIDs := map[string]bool{}
	for _, a := range after {
		afterIDs[a.ID] = true
	}
	// 戻したあとに、1 人のドリッパーの抽出中が重ならないか（ほかの操作でそのドリッパーが次のカードを始めていたら戻さない）
	brewing := map[int]bool{}
	for id, d := range b.Drips {
		if !beforeIDs[id] && !afterIDs[id] && d.Status == StatusBrewing && d.Dripper != nil {
			brewing[*d.Dripper] = true
		}
	}
	for _, d := range before {
		if d.Status != StatusBrewing || d.Dripper == nil {
			continue
		}
		if brewing[*d.Dripper] {
			return invalid("ドリッパー %d がほかのカードを抽出中のため、元に戻せません", *d.Dripper)
		}
		brewing[*d.Dripper] = true
	}
	// 終わっていないカードとして戻す注文が、今もあって、提供済みでも準備完了でもないか
	// （その操作で付けた準備完了は、呼ぶ側が先に外した状態にしておく）
	for _, d := range before {
		if d.Status == StatusDone {
			continue
		}
		for _, id := range d.OrderIDs {
			o, ok := b.Orders[id]
			switch {
			case !ok:
				return invalid("注文が消されたため、元に戻せません")
			case o.Served:
				return invalid("提供済みの注文があるため、元に戻せません")
			case o.Ready:
				return invalid("準備完了になった注文があるため、元に戻せません")
			}
		}
	}
	// 操作でできたカードは消す（入れ直し）
	for _, a := range after {
		if !beforeIDs[a.ID] {
			b.delete(cs, a.ID)
		}
	}
	// 操作の前の中身を、updated_at も含めてそのまま書き戻す。戻したあとのカードは「手前の操作の直後」と同じになるので、
	// 続けて手前の操作も戻せる（その操作の after と同じかで確かめる）
	for _, d := range before {
		row := d
		row.Lines = slices.Clone(d.Lines)
		row.OrderIDs = slices.Clone(d.OrderIDs)
		b.Drips[row.ID] = &row
		cs.touch(row.ID)
	}
	return nil
}
