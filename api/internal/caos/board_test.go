package caos

import (
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"
)

var (
	t0      = time.Date(2026, 10, 8, 10, 0, 0, 0, jst)
	blend   = uuid.MustParse("00000000-0000-0000-0000-00000000000b")
	kenya   = uuid.MustParse("00000000-0000-0000-0000-00000000000c")
	milk    = uuid.MustParse("00000000-0000-0000-0000-00000000000d")
	sticker = uuid.MustParse("00000000-0000-0000-0000-00000000000e")
)

type item struct {
	id         uuid.UUID
	name, kind string
}

var (
	itemBlend   = item{blend, "ブレンド", "hot"}
	itemKenya   = item{kenya, "ルワンダ", "hot"} // 商品名の順で「ブレンド」のあと
	itemMilk    = item{milk, "アイスミルク", "milk"}
	itemSticker = item{sticker, "ステッカー", "others"}
)

// order は注文番号 no の注文のカップを、items の順に作る。
func order(no int, items ...item) []Cup {
	id := uuid.New()
	cups := make([]Cup, len(items))
	for i, it := range items {
		cups[i] = Cup{ID: uuid.New(), OrderID: id, OrderNo: no, Position: i, ItemID: it.id, ItemName: it.name, ItemType: it.kind}
	}
	return cups
}

func nominate(cups []Cup, name string) []Cup {
	for i := range cups {
		cups[i].Nominee = &name
	}
	return cups
}

func board(orders ...[]Cup) *Board {
	b := &Board{}
	for _, o := range orders {
		b.Cups = append(b.Cups, o...)
	}
	return b
}

// 作る ID を 1, 2, 3, … にして、結果を確かめやすくする
func ids() func() uuid.UUID {
	n := 0
	return func() uuid.UUID {
		n++
		return uuid.MustParse(fmt.Sprintf("10000000-0000-0000-0000-%012d", n))
	}
}

func id(n int) uuid.UUID { return uuid.MustParse(fmt.Sprintf("10000000-0000-0000-0000-%012d", n)) }

func at(sec int) time.Time { return t0.Add(time.Duration(sec) * time.Second) }

func mustApply(t *testing.T, b *Board, op Op, now time.Time, newID func() uuid.UUID) {
	t.Helper()
	if err := b.Apply(op, now, newID); err != nil {
		t.Fatalf("%s: %v", op.Name, err)
	}
	b.Normalize()
}

func refOf(c Card) *CardRef {
	ref := &CardRef{ID: c.ID}
	for _, cup := range c.Cups {
		ref.CupIDs = append(ref.CupIDs, cup.ID)
	}
	return ref
}

func cupIDs(c Card) []uuid.UUID { return refOf(c).CupIDs }

func cardsWith(b *Board, status Status) []Card {
	var out []Card
	for _, c := range b.Cards() {
		if c.Status == status {
			out = append(out, c)
		}
	}
	return out
}

func cardByID(t *testing.T, b *Board, dripID uuid.UUID) Card {
	t.Helper()
	for _, c := range b.Cards() {
		if c.ID != nil && *c.ID == dripID {
			return c
		}
	}
	t.Fatalf("card %s not found", dripID)
	return Card{}
}

func sizes(cards []Card) []int {
	out := make([]int, len(cards))
	for i, c := range cards {
		out[i] = len(c.Cups)
	}
	return out
}

func equalInts(a, b []int) bool { return fmt.Sprint(a) == fmt.Sprint(b) }

func TestUnassignedCards(t *testing.T) {
	// 3 杯は 2 杯と 1 杯に分け、商品ごと・指名ごとに分ける。ミルクとグッズは抽出しない
	o2 := order(2, itemBlend, itemBlend, itemBlend, itemKenya, itemMilk, itemSticker)
	o1 := nominate(order(1, itemBlend, itemBlend), "3")
	o3 := order(3, itemBlend)
	o3[0].ReadyAt = &t0 // 準備完了のカップは出さない
	b := board(o2, o1, o3)
	b.Normalize()
	cards := b.Cards()
	if got := sizes(cards); !equalInts(got, []int{2, 2, 1, 1}) {
		t.Fatalf("cards = %v, want [2 2 1 1]", got)
	}
	if cards[0].Cups[0].ID != o1[0].ID {
		t.Fatalf("first card is not order 1")
	}
	// 注文 2：ブレンド 2 杯・1 杯、ルワンダ 1 杯（商品名の順）
	if cards[1].Cups[0].ID != o2[0].ID || cards[2].Cups[0].ID != o2[2].ID || cards[3].Cups[0].ID != o2[3].ID {
		t.Fatalf("order 2 cards are not split by item: %+v", cards)
	}
	for i, c := range cards {
		if c.ID != nil || c.Status != StatusUnassigned || c.Position != float64(i) {
			t.Fatalf("card %d = %+v, want unsaved unassigned at %d", i, c, i)
		}
	}
}

func TestAssignAndNext(t *testing.T) {
	o1 := order(1, itemBlend, itemBlend, itemKenya)
	o2 := order(2, itemBlend)
	b := board(o1, o2)
	b.Normalize()
	newID := ids()
	cards := b.Cards()

	// 空いている列に入れると、そのまま抽出を始める
	mustApply(t, b, Op{Name: OpAssign, Card: refOf(cards[0]), Lane: 1}, at(1), newID)
	brewing := cardByID(t, b, id(1))
	if brewing.Status != StatusBrewing || *brewing.Lane != 1 || !brewing.StartedAt.Equal(at(1)) {
		t.Fatalf("assigned card = %+v, want brewing on 1", brewing)
	}
	if b.Cups[0].DripID == nil || *b.Cups[0].DripID != id(1) || b.Cups[2].DripID != nil {
		t.Fatalf("cups not linked to the card: %+v", b.Cups[:3])
	}

	// 注文 2 を先に、注文 1 のケニアをあとに入れても、待機は注文番号の順
	mustApply(t, b, Op{Name: OpAssign, Card: refOf(cards[2]), Lane: 1}, at(2), newID)
	mustApply(t, b, Op{Name: OpAssign, Card: refOf(cards[1]), Lane: 1}, at(3), newID)
	queued := cardsWith(b, StatusQueued)
	if len(queued) != 2 || *queued[0].ID != id(3) || *queued[1].ID != id(2) {
		t.Fatalf("queue = %+v, want order 1 then order 2", queued)
	}

	// 画面が見ていたカードと違えば断る
	if err := b.Apply(Op{Name: OpNext, Lane: 1, Card: &CardRef{ID: ptr(id(3))}}, at(4), newID); !IsInvalid(err) {
		t.Fatalf("next with a stale card = %v, want invalid", err)
	}

	// 次へ：そのカードのカップだけ準備完了にし、待機の先頭を始める
	mustApply(t, b, Op{Name: OpNext, Lane: 1, Card: &CardRef{ID: ptr(id(1))}}, at(5), newID)
	if b.Cups[0].ReadyAt == nil || b.Cups[1].ReadyAt == nil || b.Cups[2].ReadyAt != nil || b.Cups[3].ReadyAt != nil {
		t.Fatalf("ready = %v %v %v %v, want only the first card's cups", b.Cups[0].ReadyAt, b.Cups[1].ReadyAt, b.Cups[2].ReadyAt, b.Cups[3].ReadyAt)
	}
	if c := cardByID(t, b, id(1)); c.Status != StatusDone || !c.FinishedAt.Equal(at(5)) {
		t.Fatalf("finished card = %+v", c)
	}
	if c := cardByID(t, b, id(3)); c.Status != StatusBrewing || !c.StartedAt.Equal(at(5)) {
		t.Fatalf("next card = %+v, want brewing", c)
	}

	// 列の外は断る
	if err := b.Apply(Op{Name: OpAssign, Card: refOf(cardByID(t, b, id(2))), Lane: 7}, at(6), newID); !IsInvalid(err) {
		t.Fatalf("assign to lane 7 = %v, want invalid", err)
	}
	// 抽出中・終了のカードは動かせない
	if err := b.Apply(Op{Name: OpAssign, Card: &CardRef{ID: ptr(id(3))}, Lane: 2}, at(6), newID); !IsInvalid(err) {
		t.Fatalf("assign a brewing card = %v, want invalid", err)
	}
	// 列の移動：待機のカードを別の列へ。空いていればそのまま始める
	mustApply(t, b, Op{Name: OpAssign, Card: &CardRef{ID: ptr(id(2))}, Lane: 2}, at(7), newID)
	if c := cardByID(t, b, id(2)); c.Status != StatusBrewing || *c.Lane != 2 {
		t.Fatalf("moved card = %+v, want brewing on 2", c)
	}
	// 終わったら待機が無くなる。抽出中も待機も無い列の「次へ」は断る
	mustApply(t, b, Op{Name: OpNext, Lane: 2}, at(8), newID)
	if err := b.Apply(Op{Name: OpNext, Lane: 2}, at(9), newID); !IsInvalid(err) {
		t.Fatalf("next on an empty lane = %v, want invalid", err)
	}
}

func ptr[T any](v T) *T { return &v }

func TestUnassignAndReorder(t *testing.T) {
	b := board(order(1, itemBlend), order(2, itemBlend), order(3, itemBlend), order(4, itemKenya, itemKenya))
	b.Normalize()
	newID := ids()
	cards := b.Cards()
	for _, c := range cards {
		mustApply(t, b, Op{Name: OpAssign, Card: refOf(c), Lane: 1}, at(1), newID)
	}
	// 1 が抽出中、2・3・4 が待機。4 を待機の先頭へ
	mustApply(t, b, Op{Name: OpAssign, Card: &CardRef{ID: ptr(id(4))}, Lane: 1, Index: ptr(0)}, at(2), newID)
	queued := cardsWith(b, StatusQueued)
	if len(queued) != 3 || *queued[0].ID != id(4) || *queued[1].ID != id(2) {
		t.Fatalf("queue = %+v, want 4, 2, 3", queued)
	}
	// 3 を 4 と 2 の間へ
	mustApply(t, b, Op{Name: OpAssign, Card: &CardRef{ID: ptr(id(3))}, Lane: 1, Index: ptr(1)}, at(3), newID)
	queued = cardsWith(b, StatusQueued)
	if *queued[0].ID != id(4) || *queued[1].ID != id(3) || *queued[2].ID != id(2) {
		t.Fatalf("queue = %+v, want 4, 3, 2", queued)
	}

	// 未割当に戻す：カードの行を消してカップの ID を空にする。抽出中は戻せない
	if err := b.Apply(Op{Name: OpUnassign, Card: &CardRef{ID: ptr(id(1))}}, at(4), newID); !IsInvalid(err) {
		t.Fatalf("unassign a brewing card = %v, want invalid", err)
	}
	mustApply(t, b, Op{Name: OpUnassign, Card: &CardRef{ID: ptr(id(4))}}, at(5), newID)
	if len(b.Drips) != 3 || b.Cups[3].DripID != nil || b.Cups[4].DripID != nil {
		t.Fatalf("unassigned card is still saved: %+v", b.Drips)
	}
	if un := cardsWith(b, StatusUnassigned); len(un) != 1 || len(un[0].Cups) != 2 || un[0].ID != nil {
		t.Fatalf("unassigned = %+v, want the 2-cup card back", un)
	}
	// 消えたカードは断る
	if err := b.Apply(Op{Name: OpUnassign, Card: &CardRef{ID: ptr(id(4))}}, at(6), newID); !IsInvalid(err) {
		t.Fatalf("unassign a gone card = %v, want invalid", err)
	}
}

func TestMerge(t *testing.T) {
	o1, o2, o3 := order(1, itemBlend), order(2, itemBlend), order(3, itemKenya)
	o4 := nominate(order(4, itemBlend), "2")
	b := board(o1, o2, o3, o4)
	b.Normalize()
	newID := ids()
	cards := b.Cards()

	// 違う商品・違う指名・同じカードは統合できない
	for _, pair := range [][2]Card{{cards[0], cards[2]}, {cards[0], cards[3]}, {cards[0], cards[0]}} {
		if err := b.Apply(Op{Name: OpMerge, Card: refOf(pair[0]), With: refOf(pair[1])}, at(1), newID); !IsInvalid(err) {
			t.Fatalf("merge %v = %v, want invalid", pair, err)
		}
	}

	// 未割当どうし：両方のカップに同じ ID を入れる。カードの行はまだ作らない
	mustApply(t, b, Op{Name: OpMerge, Card: refOf(cards[0]), With: refOf(cards[1])}, at(2), newID)
	if len(b.Drips) != 0 || b.Cups[0].DripID == nil || b.Cups[1].DripID == nil || *b.Cups[0].DripID != *b.Cups[1].DripID {
		t.Fatalf("merged cups = %+v", b.Cups[:2])
	}
	un := cardsWith(b, StatusUnassigned)
	if len(un) != 3 || un[0].ID == nil || *un[0].ID != id(1) || len(un[0].Cups) != 2 {
		t.Fatalf("unassigned = %+v, want the merged card first", un)
	}
	// 2 杯になったカードはもう統合できない
	if err := b.Apply(Op{Name: OpMerge, Card: refOf(un[0]), With: refOf(un[1])}, at(3), newID); !IsInvalid(err) {
		t.Fatalf("merge a 2-cup card = %v, want invalid", err)
	}
	// 割り当てると、その ID のままカードの行になる
	mustApply(t, b, Op{Name: OpAssign, Card: &CardRef{ID: ptr(id(1))}, Lane: 3}, at(4), newID)
	if c := cardByID(t, b, id(1)); c.Status != StatusBrewing || len(c.Cups) != 2 {
		t.Fatalf("assigned merged card = %+v", c)
	}
	// 片方の注文が消えると、カードは残りのカップだけになる
	b.Cups = b.Cups[1:]
	b.Normalize()
	if c := cardByID(t, b, id(1)); len(c.Cups) != 1 {
		t.Fatalf("card after the order was deleted = %+v", c)
	}

	// 待機どうし：相手のカップをこちらのカードへ入れ、相手のカードの行を消す
	o5, o6 := order(5, itemKenya), order(6, itemKenya)
	b.Cups = append(b.Cups, o5...)
	b.Cups = append(b.Cups, o6...)
	b.Normalize()
	for _, c := range cardsWith(b, StatusUnassigned) {
		if c.Cups[0].ID == o5[0].ID || c.Cups[0].ID == o6[0].ID || c.Cups[0].ID == o3[0].ID {
			mustApply(t, b, Op{Name: OpAssign, Card: refOf(c), Lane: 4}, at(5), newID)
		}
	}
	// 4 に o3（抽出中）・o5・o6（待機）
	first, second := cardsWith(b, StatusQueued)[0], cardsWith(b, StatusQueued)[1]
	mustApply(t, b, Op{Name: OpMerge, Card: refOf(first), With: refOf(second)}, at(6), newID)
	if q := cardsWith(b, StatusQueued); len(q) != 1 || len(q[0].Cups) != 2 || *q[0].ID != *first.ID {
		t.Fatalf("queue after merge = %+v", q)
	}
	// 抽出中と待機は統合できない
	brewing := cardsWith(b, StatusBrewing)
	if err := b.Apply(Op{Name: OpMerge, Card: refOf(brewing[1]), With: refOf(cardsWith(b, StatusQueued)[0])}, at(7), newID); !IsInvalid(err) {
		t.Fatalf("merge brewing and queued = %v, want invalid", err)
	}
}

func TestOrderChangesAndMasterReady(t *testing.T) {
	o1 := order(1, itemBlend, itemBlend, itemBlend)
	o2 := order(2, itemKenya)
	b := board(o1, o2)
	b.Normalize()
	newID := ids()
	cards := b.Cards()
	mustApply(t, b, Op{Name: OpAssign, Card: refOf(cards[0]), Lane: 1}, at(1), newID) // id1 抽出中（2 杯）
	mustApply(t, b, Op{Name: OpAssign, Card: refOf(cards[2]), Lane: 1}, at(1), newID) // id2 待機（注文 2）

	// 注文の編集で消えたカップは、カードから自然に抜ける
	b.Cups = append(b.Cups[1:3:3], b.Cups[3:]...)
	b.Normalize()
	if c := cardByID(t, b, id(1)); len(c.Cups) != 1 {
		t.Fatalf("card after edit = %+v", c)
	}
	// マスターでカップを準備完了にしたら、そのカードは終わり扱い（終わった時刻は準備完了の時刻）
	b.Cups[0].ReadyAt = ptr(at(30))
	b.Normalize()
	if c := cardByID(t, b, id(1)); c.Status != StatusDone || !c.FinishedAt.Equal(at(30)) {
		t.Fatalf("card after master ready = %+v", c)
	}
	// 抽出中が無くなった列の「次へ」は、待機の先頭を始める
	if err := b.Apply(Op{Name: OpNext, Lane: 1, Card: &CardRef{ID: ptr(id(1))}}, at(31), newID); !IsInvalid(err) {
		t.Fatalf("next on a card finished at the master = %v, want invalid", err)
	}
	mustApply(t, b, Op{Name: OpNext, Lane: 1}, at(32), newID)
	if c := cardByID(t, b, id(2)); c.Status != StatusBrewing || !c.StartedAt.Equal(at(32)) {
		t.Fatalf("next card = %+v", c)
	}
	// 注文の削除でカップが無くなったカードは除く（抽出中だった列は空く）
	b.Cups = b.Cups[:2]
	b.Normalize()
	if len(b.Drips) != 1 || b.brewing(1) >= 0 {
		t.Fatalf("drips after delete = %+v", b.Drips)
	}
	// 待機中にマスターで準備完了になったカードも終わり扱い（抽出はしていない）
	o3 := order(3, itemBlend)
	b.Cups = append(b.Cups, o3...)
	b.Normalize()
	mustApply(t, b, Op{Name: OpAssign, Card: refOf(cardsWith(b, StatusUnassigned)[0]), Lane: 2}, at(40), newID)
	mustApply(t, b, Op{Name: OpAssign, Card: refOf(cardsWith(b, StatusUnassigned)[0]), Lane: 2}, at(40), newID)
	b.Cups[len(b.Cups)-1].ReadyAt = ptr(at(41))
	b.Normalize()
	if q := cardsWith(b, StatusQueued); len(q) != 0 {
		t.Fatalf("queue = %+v, want empty", q)
	}
}

func TestUndo(t *testing.T) {
	o1 := order(1, itemBlend, itemBlend)
	o2 := order(2, itemKenya)
	b := board(o1, o2)
	b.Normalize()
	newID := ids()
	cards := b.Cards()

	do := func(op Op, now time.Time) Change {
		t.Helper()
		before := b.Clone()
		mustApply(t, b, op, now, newID)
		return Diff(&before, b)
	}

	assign1 := do(Op{Name: OpAssign, Card: refOf(cards[0]), Lane: 1}, at(1))
	assign2 := do(Op{Name: OpAssign, Card: refOf(cards[1]), Lane: 1}, at(2))
	next := do(Op{Name: OpNext, Lane: 1}, at(3))
	if len(next.Drips) != 2 || len(next.Cups) != 2 {
		t.Fatalf("next changed %+v, want 2 cards and 2 cups", next)
	}

	// 先の操作は、あとの操作で触ったので戻せない
	if err := b.Revert(assign2); !IsInvalid(err) {
		t.Fatalf("revert an older op = %v, want invalid", err)
	}
	// 「次へ」を戻すと、カードと準備完了が元に戻る
	snapshot := b.Clone()
	if err := b.Revert(next); err != nil {
		t.Fatal(err)
	}
	if b.Cups[0].ReadyAt != nil || cardByID(t, b, id(1)).Status != StatusBrewing || cardByID(t, b, id(2)).Status != StatusQueued {
		t.Fatalf("after undo next: %+v", b.Cards())
	}
	// 続けて手前の操作も戻せる
	if err := b.Revert(assign2); err != nil {
		t.Fatal(err)
	}
	if err := b.Revert(assign1); err != nil {
		t.Fatal(err)
	}
	if len(b.Drips) != 0 || b.Cups[0].DripID != nil || len(cardsWith(b, StatusUnassigned)) != 2 {
		t.Fatalf("after undo all: %+v %+v", b.Drips, b.Cups)
	}

	// 提供済みにしたカップがあれば戻さない
	*b = snapshot
	b.Cups[0].ServedAt = ptr(at(4))
	if err := b.Revert(next); !IsInvalid(err) {
		t.Fatalf("revert after served = %v, want invalid", err)
	}
	// 注文の削除でカップが無くなっていたら戻さない
	*b = snapshot
	b.Cups = b.Cups[1:]
	b.Normalize()
	if err := b.Revert(next); !IsInvalid(err) {
		t.Fatalf("revert after the order was deleted = %v, want invalid", err)
	}
	// 断ったときは何も変わっていない
	*b = snapshot.Clone()
	b.Cups[0].ServedAt = ptr(at(4))
	kept := b.Clone()
	_ = b.Revert(next)
	if ch := Diff(&kept, b); !ch.Empty() || len(kept.Drips) != len(b.Drips) {
		t.Fatalf("failed revert changed %+v", ch)
	}
}

func TestDay(t *testing.T) {
	// 日本時間の 0 時で日付が変わる
	if got := Day(time.Date(2026, 10, 8, 14, 59, 0, 0, time.UTC)); got != "2026-10-08" {
		t.Fatalf("Day = %s", got)
	}
	if got := Day(time.Date(2026, 10, 8, 15, 0, 0, 0, time.UTC)); got != "2026-10-09" {
		t.Fatalf("Day = %s", got)
	}
	start, end, err := DayRange("2026-10-09")
	if err != nil || !start.Equal(time.Date(2026, 10, 8, 15, 0, 0, 0, time.UTC)) || end.Sub(start) != 24*time.Hour {
		t.Fatalf("DayRange = %v %v %v", start, end, err)
	}
}
