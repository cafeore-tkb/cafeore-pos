package caos

import (
	"errors"
	"fmt"
	"math/rand/v2"
	"slices"
	"strings"
	"testing"
	"time"
)

// 盤面のルール。CaOS の SQL のテスト（caos_test.sql）と、Durable Object 版（CaOS#16）のテストの流れをそのまま確かめる。

type item struct{ id, name, abbr, typ string }

var (
	champ = item{"item-champ", "優勝ブレンド", "優勝", "hot"}
	ore   = item{"item-ore", "珈琲・俺ブレンド", "俺ブレ", "hot"}
	ice   = item{"item-ice", "アイスコーヒー", "氷", "ice"}
	milk  = item{"item-milk", "アイスミルク", "ミルク", "milk"}
	tote  = item{"item-tote", "トートバッグ", "トート", "others"}
)

type menuLine struct {
	items    []item
	qty      []int
	assignee *string
}

func one(it item, qty int) menuLine { return menuLine{items: []item{it}, qty: []int{qty}} }

// abbr は商品の ID から略称を引く（カードには商品名を写さないので、テストでも注文の側から引く）
func abbr(itemID string) string {
	for _, it := range []item{champ, ore, ice, milk, tote} {
		if it.id == itemID {
			return it.abbr
		}
	}
	return itemID
}

func orderID(no int) string { return fmt.Sprintf("00000000-0000-0000-0000-%012d", no) }

func order(no int, lines ...menuLine) Order {
	o := Order{ID: orderID(no), OrderNo: no, CreatedAt: time.Date(2026, 11, 1, 1, no%60, 0, 0, time.UTC)}
	for _, ml := range lines {
		for i, it := range ml.items {
			o.Lines = append(o.Lines, OrderLine{Assignee: ml.assignee, ItemID: it.id, Name: it.name, Abbr: it.abbr, Type: it.typ, Quantity: ml.qty[i]})
		}
	}
	return o
}

// SQL のテストと同じ注文 #1：優勝 3 杯・アイスミルク・トートセット（優勝＋トート）・俺ブレ（指名 ２）
func order1(oreCups int) Order {
	return order(1,
		one(champ, 3),
		one(milk, 1),
		menuLine{items: []item{champ, tote}, qty: []int{1, 1}},
		menuLine{items: []item{ore}, qty: []int{oreCups}, assignee: ptr(" ２ ")},
	)
}

func single(no int) Order { return order(no, one(champ, 1)) }

func newBoard() *Board {
	t := time.Date(2026, 11, 1, 1, 0, 0, 0, time.UTC)
	n := 0
	return NewBoard(nil, nil, func() time.Time {
		t = t.Add(time.Second)
		return t
	}, func() string {
		n++
		return fmt.Sprintf("drip-%d", n)
	})
}

func seeded(t *testing.T) *Board {
	t.Helper()
	b := newBoard()
	b.IngestOrders(&Changeset{}, []Order{order1(1), single(2), single(3)}, true)
	return b
}

func apply(t *testing.T, b *Board, op Op) *Changeset {
	t.Helper()
	cs := &Changeset{}
	if err := b.Apply(cs, op); err != nil {
		t.Fatalf("%s: %v", op.Name, err)
	}
	checkInvariants(t, b)
	return cs
}

func applyErr(b *Board, op Op) error { return b.Apply(&Changeset{}, op) }

// restore は記録しておいた操作を取り消す（Store が caos_ops の記録から行うのと同じ）
func restore(t *testing.T, b *Board, before, after []Drip) {
	t.Helper()
	if err := b.Restore(&Changeset{}, before, after); err != nil {
		t.Fatalf("restore: %v", err)
	}
	checkInvariants(t, b)
}

func cardsOf(b *Board, no int) []Drip {
	var out []Drip
	for _, d := range b.List() {
		if slices.Contains(d.OrderIDs, orderID(no)) {
			out = append(out, d)
		}
	}
	return out
}

func statuses(b *Board, dripper int) []Status {
	var out []Status
	for _, d := range b.List() {
		if d.Dripper != nil && *d.Dripper == dripper {
			out = append(out, d.Status)
		}
	}
	return out
}

func rows(b *Board, cs *Changeset) []Drip { return b.Rows(cs.Changed.List()) }

// 1 人のドリッパーが同時に抽出できるのは 1 枚だけ・状態と担当の組み合わせ・杯数
func checkInvariants(t *testing.T, b *Board) {
	t.Helper()
	brewing := map[int]bool{}
	for _, d := range b.Drips {
		if d.Status == StatusBrewing {
			if brewing[*d.Dripper] {
				t.Fatalf("ドリッパー %d に抽出中が 2 枚ある", *d.Dripper)
			}
			brewing[*d.Dripper] = true
		}
		if (d.Status == StatusUnassigned) != (d.Dripper == nil) && d.Status != StatusDone {
			t.Fatalf("状態と担当が合わない：%+v", d)
		}
		if d.Cups != sumCups(d.Lines) || d.Cups < 1 || d.Cups > 2 {
			t.Fatalf("杯数が合わない：%+v", d)
		}
		if !slices.Equal(d.OrderIDs, distinctOrders(d.Lines)) {
			t.Fatalf("order_ids が明細と合わない：%+v", d)
		}
	}
}

func isInvalid(t *testing.T, err error, want string) {
	t.Helper()
	var ie *InvalidError
	if !errors.As(err, &ie) || !strings.Contains(ie.Message, want) {
		t.Fatalf("want invalid %q, got %v", want, err)
	}
}

// ---------------------------------------------------------------- 注文 → カード

func TestIngestSplitsIntoTwoCupCards(t *testing.T) {
	b := seeded(t)
	var got [][2]any
	for _, d := range cardsOf(b, 1) {
		got = append(got, [2]any{abbr(d.Lines[0].ItemID), d.Cups})
		if d.Status != StatusUnassigned || d.QueuePos != 1 {
			t.Fatalf("未割当・注文番号の位置で作る：%+v", d)
		}
	}
	want := [][2]any{{"優勝", 2}, {"優勝", 2}, {"俺ブレ", 1}}
	if fmt.Sprint(got) != fmt.Sprint(want) {
		t.Fatalf("2 杯ずつに分け、アイスミルクとグッズは載せない：%v", got)
	}
	if len(b.Drips) != 5 {
		t.Fatalf("全部で 5 枚：%d", len(b.Drips))
	}
	checkInvariants(t, b)
}

func TestIngestTrimsNominee(t *testing.T) {
	b := seeded(t)
	for _, d := range cardsOf(b, 1) {
		if d.Lines[0].ItemID == ore.id && (d.Lines[0].Nominee == nil || *d.Lines[0].Nominee != "２") {
			t.Fatalf("指名は前後の空白を落として写す：%v", d.Lines[0].Nominee)
		}
	}
}

func TestIngestSkipsReadyAndServed(t *testing.T) {
	b := newBoard()
	ready, served := single(6), single(7)
	ready.Ready, served.Served = true, true
	b.IngestOrders(&Changeset{}, []Order{single(5), ready, served}, true)
	if len(b.Drips) != 1 || len(cardsOf(b, 5)) != 1 {
		t.Fatalf("準備完了・提供済みで受け取った注文にはカードを作らない：%v", b.List())
	}
}

func TestIngestSameOrderTwiceChangesNothing(t *testing.T) {
	b := seeded(t)
	before := b.List()
	cs := &Changeset{}
	b.IngestOrders(cs, []Order{order1(1), single(2), single(3)}, true)
	if !cs.Empty() {
		t.Fatalf("中身が同じなら何も変えない：%v", cs.Changed.List())
	}
	if fmt.Sprint(b.List()) != fmt.Sprint(before) {
		t.Fatal("カードの id が変わった")
	}
}

func TestIngestSkipsGoodsAndZeroQuantity(t *testing.T) {
	b := newBoard()
	b.IngestOrders(&Changeset{}, []Order{order(11, one(tote, 1)), order(12, one(champ, 0))}, true)
	if len(b.Drips) != 0 {
		t.Fatalf("グッズだけの注文・数量 0 の明細はカードにしない：%v", b.List())
	}
}

// ---------------------------------------------------------------- 操作

func TestMerge(t *testing.T) {
	b := seeded(t)
	a, c := cardsOf(b, 2)[0], cardsOf(b, 3)[0]
	cs := apply(t, b, Op{Name: "merge", FirstID: a.ID, SecondID: c.ID})
	merged := cardsOf(b, 3)
	if len(merged) != 1 || merged[0].Cups != 2 || !slices.Equal(merged[0].OrderIDs, []string{orderID(2), orderID(3)}) || merged[0].QueuePos != 2 {
		t.Fatalf("1 枚 2 杯になる：%+v", merged)
	}
	if !slices.Equal(cs.Deleted.List(), []string{c.ID}) {
		t.Fatalf("消えたカードを返す：%v", cs.Deleted.List())
	}
}

func TestMergeRejects(t *testing.T) {
	b := seeded(t)
	champ2 := cardsOf(b, 1)[0]
	oreCard := cardsOf(b, 1)[2]
	c2 := cardsOf(b, 2)[0]
	before := fmt.Sprint(b.List())
	isInvalid(t, applyErr(b, Op{Name: "merge", FirstID: champ2.ID, SecondID: c2.ID}), "統合できません")  // 2 杯
	isInvalid(t, applyErr(b, Op{Name: "merge", FirstID: oreCard.ID, SecondID: c2.ID}), "統合できません") // 別の商品
	isInvalid(t, applyErr(b, Op{Name: "merge", FirstID: c2.ID, SecondID: c2.ID}), "統合できません")
	if fmt.Sprint(b.List()) != before {
		t.Fatal("断ったのに変わった")
	}
}

func TestAssignStartsBrewingWhenFree(t *testing.T) {
	b := seeded(t)
	a, c := cardsOf(b, 1)[0], cardsOf(b, 1)[1]
	apply(t, b, Op{Name: "assign", DripID: a.ID, Dripper: ptr(1)})
	apply(t, b, Op{Name: "assign", DripID: c.ID, Dripper: ptr(1)})
	if got := statuses(b, 1); !slices.Equal(got, []Status{StatusBrewing, StatusQueued}) {
		t.Fatalf("空いていればすぐ抽出中、2 枚目は待機：%v", got)
	}
	if b.Drips[a.ID].StartedAt == nil {
		t.Fatal("started_at が付かない")
	}
}

func TestAssignRejects(t *testing.T) {
	b := seeded(t)
	a, c := cardsOf(b, 1)[0], cardsOf(b, 1)[1]
	apply(t, b, Op{Name: "assign", DripID: a.ID, Dripper: ptr(1)})
	isInvalid(t, applyErr(b, Op{Name: "assign", DripID: a.ID, Dripper: ptr(2)}), "割り当てられません")
	isInvalid(t, applyErr(b, Op{Name: "assign", DripID: "nope", Dripper: ptr(2)}), "")
	isInvalid(t, applyErr(b, Op{Name: "assign", DripID: c.ID, Dripper: ptr(7)}), "1〜6")
	isInvalid(t, applyErr(b, Op{Name: "assign", DripID: c.ID}), "1〜6")
	isInvalid(t, applyErr(b, Op{Name: "nope"}), "知らない操作")
}

func TestUnassignOnlyQueued(t *testing.T) {
	b := seeded(t)
	a, c := cardsOf(b, 1)[0], cardsOf(b, 1)[1]
	apply(t, b, Op{Name: "assign", DripID: a.ID, Dripper: ptr(1)})
	apply(t, b, Op{Name: "assign", DripID: c.ID, Dripper: ptr(1)})
	isInvalid(t, applyErr(b, Op{Name: "unassign", DripID: a.ID}), "戻せません")
	apply(t, b, Op{Name: "unassign", DripID: c.ID})
	if d := b.Drips[c.ID]; d.Status != StatusUnassigned || d.Dripper != nil {
		t.Fatalf("未割当に戻る：%+v", d)
	}
}

func TestEditRecreatesOnlyUnassigned(t *testing.T) {
	b := seeded(t)
	a, c := cardsOf(b, 1)[0], cardsOf(b, 1)[1]
	apply(t, b, Op{Name: "assign", DripID: a.ID, Dripper: ptr(1)})
	apply(t, b, Op{Name: "assign", DripID: c.ID, Dripper: ptr(1)})
	b.IngestOrders(&Changeset{}, []Order{order1(2)}, false)
	var unassigned []string
	for _, d := range cardsOf(b, 1) {
		if d.Status == StatusUnassigned {
			unassigned = append(unassigned, fmt.Sprintf("%s%d", abbr(d.Lines[0].ItemID), d.Cups))
		}
	}
	if !slices.Equal(unassigned, []string{"俺ブレ2"}) {
		t.Fatalf("杯数を増やすと未割当の分だけ作り直す：%v", unassigned)
	}
	if got := statuses(b, 1); !slices.Equal(got, []Status{StatusBrewing, StatusQueued}) {
		t.Fatalf("割当済みはそのまま：%v", got)
	}
	checkInvariants(t, b)
}

func TestNextReadyAndRestore(t *testing.T) {
	b := seeded(t)
	cards := cardsOf(b, 1)
	a, c, oreCard := cards[0], cards[1], cards[2]
	apply(t, b, Op{Name: "assign", DripID: a.ID, Dripper: ptr(1)})
	apply(t, b, Op{Name: "assign", DripID: c.ID, Dripper: ptr(1)})

	// 次へ：1 枚目が終わり 2 枚目が始まる。俺ブレが残るので準備完了にしない
	cs := apply(t, b, Op{Name: "next", Dripper: ptr(1)})
	if got := statuses(b, 1); !slices.Equal(got, []Status{StatusDone, StatusBrewing}) {
		t.Fatalf("次へで次のカードが始まる：%v", got)
	}
	if cs.Completed.Len() != 0 {
		t.Fatalf("カードが残っている注文は終わりにしない：%v", cs.Completed.List())
	}

	// 俺ブレを 2 へ、次へを 1・2 の順に押すと注文 #1 が準備完了になる
	apply(t, b, Op{Name: "assign", DripID: oreCard.ID, Dripper: ptr(2)})
	apply(t, b, Op{Name: "next", Dripper: ptr(1)})
	before := []Drip{*b.Drips[oreCard.ID]}
	last := apply(t, b, Op{Name: "next", Dripper: ptr(2)})
	lastRows := rows(b, last) // 画面が受け取った操作の結果
	if !slices.Equal(last.Completed.List(), []string{orderID(1)}) {
		t.Fatalf("最後のカードの次へで、注文のカードが全部終わったと返す（準備完了は既存の API で付ける）：%v", last.Completed.List())
	}

	// 1つ戻す：抽出中に戻る（Store と同じく、その操作で準備完了にした注文は外してから戻す）
	for _, id := range last.Completed.List() {
		b.Orders[id].Ready = false
	}
	restore(t, b, before, lastRows)
	if b.Drips[oreCard.ID].Status != StatusBrewing {
		t.Fatal("1つ戻すで抽出中に戻る")
	}

	// ほかの端末が後から動かしていたら断る
	isInvalid(t, b.Restore(&Changeset{}, before, lastRows), "ほかの端末で変更された")
}

// 「次へ」に終わらせるカードを付けると、二度押し（2 回目は次のカードが抽出中）を断る
func TestNextWithDripIDRejectsDoublePress(t *testing.T) {
	b := seeded(t)
	cards := cardsOf(b, 1)
	a, c := cards[0], cards[1]
	apply(t, b, Op{Name: "assign", DripID: a.ID, Dripper: ptr(1)})
	apply(t, b, Op{Name: "assign", DripID: c.ID, Dripper: ptr(1)})
	apply(t, b, Op{Name: "next", Dripper: ptr(1), DripID: a.ID})
	isInvalid(t, applyErr(b, Op{Name: "next", Dripper: ptr(1), DripID: a.ID}), "もう終わっています")
	if got := statuses(b, 1); !slices.Equal(got, []Status{StatusDone, StatusBrewing}) {
		t.Fatalf("2 回目は何も変えない：%v", got)
	}
	apply(t, b, Op{Name: "next", Dripper: ptr(1), DripID: c.ID})
	checkInvariants(t, b)
}

func TestNextRejectsIdleDripper(t *testing.T) {
	isInvalid(t, applyErr(seeded(t), Op{Name: "next", Dripper: ptr(4)}), "抽出中ではありません")
}

func TestRebrewMergedAndRestore(t *testing.T) {
	b := seeded(t)
	c2, c3 := cardsOf(b, 2)[0], cardsOf(b, 3)[0]
	apply(t, b, Op{Name: "merge", FirstID: c2.ID, SecondID: c3.ID})
	apply(t, b, Op{Name: "assign", DripID: c2.ID, Dripper: ptr(3)})
	apply(t, b, Op{Name: "next", Dripper: ptr(3)})
	before := []Drip{*b.Drips[c2.ID]}
	cs := apply(t, b, Op{Name: "rebrew", SourceID: c2.ID, Cups: 1, Dripper: ptr(4)})
	var made *Drip
	for _, d := range b.Drips {
		if d.RebrewOf != nil && *d.RebrewOf == c2.ID {
			made = d
		}
	}
	if made == nil || made.Status != StatusBrewing || *made.Dripper != 4 || made.Cups != 1 || len(made.Lines) != 1 || !slices.Equal(made.OrderIDs, []string{orderID(2)}) {
		t.Fatalf("1 杯で、空いているドリッパーですぐ始まる：%+v", made)
	}
	restore(t, b, before, rows(b, cs))
	for _, d := range b.Drips {
		if d.RebrewOf != nil {
			t.Fatal("入れ直しを取り消すとカードが消える")
		}
	}
}

func TestRebrewInterrupt(t *testing.T) {
	b := seeded(t)
	a := cardsOf(b, 1)[0]
	apply(t, b, Op{Name: "assign", DripID: a.ID, Dripper: ptr(1)})
	apply(t, b, Op{Name: "rebrew", SourceID: a.ID, Cups: 2, Interrupt: true, Dripper: ptr(1)})
	if d := b.Drips[a.ID]; d.Status != StatusDone || !d.Interrupted {
		t.Fatalf("途中でやめる：%+v", d)
	}
	for _, d := range b.Drips {
		if d.RebrewOf != nil && (d.Status != StatusBrewing || *d.Dripper != 1 || d.Cups != 2) {
			t.Fatalf("同じドリッパーで入れ直す：%+v", d)
		}
	}
}

func TestRebrewRejectsMoreCupsThanSource(t *testing.T) {
	b := seeded(t)
	c2 := cardsOf(b, 2)[0]
	apply(t, b, Op{Name: "assign", DripID: c2.ID, Dripper: ptr(1)})
	isInvalid(t, applyErr(b, Op{Name: "rebrew", SourceID: c2.ID, Cups: 2, Dripper: ptr(2)}), "より多い杯数")
}

func TestRebrewMustFinishBeforeReady(t *testing.T) {
	b := newBoard()
	b.IngestOrders(&Changeset{}, []Order{single(8)}, true)
	a := cardsOf(b, 8)[0]
	apply(t, b, Op{Name: "assign", DripID: a.ID, Dripper: ptr(1)})
	apply(t, b, Op{Name: "rebrew", SourceID: a.ID, Cups: 1, Interrupt: true, Dripper: ptr(2)})
	if b.Orders[orderID(8)].Ready {
		t.Fatal("入れ直しが終わるまで準備完了にしない")
	}
	if cs := apply(t, b, Op{Name: "next", Dripper: ptr(2)}); !slices.Equal(cs.Completed.List(), []string{orderID(8)}) {
		t.Fatalf("入れ直しが終わったら、注文のカードが全部終わる：%v", cs.Completed.List())
	}
}

// ---------------------------------------------------------------- POS からの変更

func TestPosReadyFinishesMergedAndPartner(t *testing.T) {
	b := seeded(t)
	c2, c3 := cardsOf(b, 2)[0], cardsOf(b, 3)[0]
	apply(t, b, Op{Name: "merge", FirstID: c2.ID, SecondID: c3.ID})
	apply(t, b, Op{Name: "assign", DripID: c2.ID, Dripper: ptr(3)})
	ready := single(2)
	ready.Ready = true
	cs := &Changeset{}
	b.IngestOrders(cs, []Order{ready, single(3)}, false)
	if b.Drips[c2.ID].Status != StatusDone {
		t.Fatal("POS で準備完了にすると抽出終了になる")
	}
	if !slices.Equal(cs.Completed.List(), []string{orderID(3)}) || !b.Orders[orderID(3)].Ready {
		t.Fatalf("統合相手の注文もカードが全部終わる（同じ一覧の古い状態で上書きしない）：%v", cs.Completed.List())
	}
	checkInvariants(t, b)
}

func TestPosReadyPromotesNext(t *testing.T) {
	b := seeded(t)
	a, c := cardsOf(b, 1)[0], cardsOf(b, 1)[1]
	c2 := cardsOf(b, 2)[0]
	apply(t, b, Op{Name: "assign", DripID: c2.ID, Dripper: ptr(1)})
	apply(t, b, Op{Name: "assign", DripID: a.ID, Dripper: ptr(1)})
	ready := single(2)
	ready.Ready = true
	b.IngestOrders(&Changeset{}, []Order{ready}, false)
	if b.Drips[a.ID].Status != StatusBrewing || b.Drips[c.ID].Status != StatusUnassigned {
		t.Fatal("抽出中だったドリッパーは次のカードを始める")
	}
}

func TestRemovedOrders(t *testing.T) {
	b := newBoard()
	b.IngestOrders(&Changeset{}, []Order{order(4, one(ice, 1)), single(9), single(10)}, true)
	if len(cardsOf(b, 4)) != 1 {
		t.Fatal("アイスコーヒーはカードになる")
	}
	done := cardsOf(b, 10)[0]
	apply(t, b, Op{Name: "assign", DripID: done.ID, Dripper: ptr(1)})
	apply(t, b, Op{Name: "next", Dripper: ptr(1)})
	b.IngestOrders(&Changeset{}, []Order{single(9)}, false)
	if len(cardsOf(b, 4)) != 1 {
		t.Fatal("一部だけの一覧（full でない）では消さない")
	}
	b.IngestOrders(&Changeset{}, []Order{single(9)}, true)
	if len(cardsOf(b, 4)) != 0 || len(cardsOf(b, 10)) != 1 {
		t.Fatal("全部の一覧に載っていない注文のカードを片付ける（終わったカードは残す）")
	}
	if _, ok := b.Orders[orderID(4)]; ok {
		t.Fatal("消えた注文を覚えたまま")
	}
}

func TestRemoveOrderTrimsMerged(t *testing.T) {
	b := seeded(t)
	c2, c3 := cardsOf(b, 2)[0], cardsOf(b, 3)[0]
	apply(t, b, Op{Name: "merge", FirstID: c2.ID, SecondID: c3.ID})
	apply(t, b, Op{Name: "assign", DripID: c2.ID, Dripper: ptr(5)})
	cs := &Changeset{}
	b.RemoveOrder(cs, orderID(3))
	if d := b.Drips[c2.ID]; !slices.Equal(d.OrderIDs, []string{orderID(2)}) || d.Cups != 1 || d.Status != StatusBrewing {
		t.Fatalf("その分だけ外して残す：%+v", d)
	}
	checkInvariants(t, b)
}

// ---------------------------------------------------------------- いろいろな操作を続けても壊れない

func TestRandomOpsKeepInvariants(t *testing.T) {
	for seed := range uint64(30) {
		t.Run(fmt.Sprint(seed), func(t *testing.T) { randomOps(t, seed) })
	}
}

func randomOps(t *testing.T, seed uint64) {
	r := rand.New(rand.NewPCG(seed, 42))
	b := newBoard()
	var orders []Order
	for i := range 12 {
		orders = append(orders, order(i+1, one([]item{champ, ore, ice}[i%3], 1+i%4)))
	}
	b.IngestOrders(&Changeset{}, orders, true)
	pick := func() string {
		list := b.List()
		if len(list) == 0 {
			return "x"
		}
		return list[r.IntN(len(list))].ID
	}
	for range 400 {
		var dripper *int
		if r.IntN(3) != 0 {
			dripper = ptr(1 + r.IntN(6))
		}
		ops := []Op{
			{Name: "assign", DripID: pick(), Dripper: ptr(1 + r.IntN(6))},
			{Name: "unassign", DripID: pick()},
			{Name: "next", Dripper: ptr(1 + r.IntN(6))},
			{Name: "merge", FirstID: pick(), SecondID: pick()},
			{Name: "rebrew", SourceID: pick(), Cups: 1 + r.IntN(2), Interrupt: r.IntN(2) == 0, Dripper: dripper},
		}
		if err := b.Apply(&Changeset{}, ops[r.IntN(len(ops))]); err != nil && !errors.Is(err, ErrInvalid) {
			t.Fatal(err)
		}
		checkInvariants(t, b)
	}
}

// 「1つ戻す」は、戻したあとに抽出中が重なるなら断る（A の次へ → 同じドリッパーで B が始まる → A の次へを戻す）
func TestRestoreRejectsBrewingConflict(t *testing.T) {
	b := seeded(t)
	a, c := cardsOf(b, 1)[0], cardsOf(b, 2)[0]
	apply(t, b, Op{Name: "assign", DripID: a.ID, Dripper: ptr(1)})
	before := []Drip{*b.Drips[a.ID]}
	next := apply(t, b, Op{Name: "next", Dripper: ptr(1)})
	after := rows(b, next)
	apply(t, b, Op{Name: "assign", DripID: c.ID, Dripper: ptr(1)}) // ドリッパー 1 で B が始まる
	snapshot := fmt.Sprint(b.List())
	isInvalid(t, b.Restore(&Changeset{}, before, after), "ほかのカードを抽出中")
	if fmt.Sprint(b.List()) != snapshot {
		t.Fatal("断ったのに変わった")
	}
}

// 「1つ戻す」は、終わっていないカードとして戻す注文が消された・提供済み・準備完了なら断る
func TestRestoreRejectsChangedOrders(t *testing.T) {
	for name, change := range map[string]func(b *Board){
		"消された": func(b *Board) { delete(b.Orders, orderID(1)) },
		"提供済み": func(b *Board) { b.Orders[orderID(1)].Served = true },
		"準備完了": func(b *Board) { b.Orders[orderID(1)].Ready = true },
	} {
		t.Run(name, func(t *testing.T) {
			b := seeded(t)
			a := cardsOf(b, 1)[0]
			before := []Drip{*b.Drips[a.ID]}
			assigned := apply(t, b, Op{Name: "assign", DripID: a.ID, Dripper: ptr(1)})
			change(b)
			snapshot := fmt.Sprint(b.List())
			isInvalid(t, b.Restore(&Changeset{}, before, rows(b, assigned)), "元に戻せません")
			if fmt.Sprint(b.List()) != snapshot {
				t.Fatal("断ったのに変わった")
			}
		})
	}
}
