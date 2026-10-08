package caos

import (
	"fmt"
	"slices"
	"strings"
	"testing"
)

// 列（ドリッパー 1〜6）の担当者のルール。

func laneOf(b *Board, n int) Lane { return b.LaneRows([]int{n})[0] }

// 盤面には 1〜6 の列が必ずあり、最初は担当者なし
func TestLanesStartEmpty(t *testing.T) {
	b := newBoard()
	lanes := b.Lanes()
	if len(lanes) != 6 {
		t.Fatalf("6 列そろう：%+v", lanes)
	}
	for i, l := range lanes {
		if l.Dripper != i+1 || l.Name != "" || l.Senior || l.UpdatedAt != nil {
			t.Fatalf("最初は担当者なし：%+v", l)
		}
	}
}

// 交代：名前の前後の空白を落とす。空にすると担当者なし（上級生でもない）。カードには触らない
func TestSetLane(t *testing.T) {
	b := seeded(t)
	before := fmt.Sprint(b.List())
	cs := apply(t, b, Op{Name: "set_lane", Dripper: ptr(2), Person: "  山田 ", Senior: true})
	if l := laneOf(b, 2); l.Name != "山田" || !l.Senior || l.UpdatedAt == nil {
		t.Fatalf("交代：%+v", l)
	}
	if !slices.Equal(cs.Lanes, []int{2}) || cs.Changed.Len() != 0 || cs.Empty() {
		t.Fatalf("変わったのは列だけ：%+v", cs)
	}
	if fmt.Sprint(b.List()) != before {
		t.Fatal("交代でカードは変わらない")
	}
	apply(t, b, Op{Name: "set_lane", Dripper: ptr(2), Person: " ", Senior: true})
	if l := laneOf(b, 2); l.Name != "" || l.Senior || l.UpdatedAt == nil {
		t.Fatalf("空にすると担当者なし・上級生でもない：%+v", l)
	}
	isInvalid(t, applyErr(b, Op{Name: "set_lane", Dripper: ptr(7), Person: "佐藤"}), "ドリッパーは 1〜6 です")
	isInvalid(t, applyErr(b, Op{Name: "set_lane", Person: "佐藤"}), "ドリッパーは 1〜6 です")
	isInvalid(t, applyErr(b, Op{Name: "set_lane", Dripper: ptr(1), Person: strings.Repeat("あ", 41)}), "名前は 40 文字までです")
	apply(t, b, Op{Name: "set_lane", Dripper: ptr(1), Person: strings.Repeat("あ", 40)})
}

// 抽出中・待機中のカードがある列でも、その場で替えられる（限定の確認は画面が出す）。カードは列に残る
func TestSetLaneKeepsCards(t *testing.T) {
	b := seeded(t)
	first, second := cardsOf(b, 2)[0], cardsOf(b, 3)[0]
	apply(t, b, Op{Name: "assign", DripID: first.ID, Dripper: ptr(1)})
	apply(t, b, Op{Name: "assign", DripID: second.ID, Dripper: ptr(1)})
	apply(t, b, Op{Name: "set_lane", Dripper: ptr(1), Person: "佐藤"})
	apply(t, b, Op{Name: "swap_lanes", Dripper: ptr(1), OtherDripper: ptr(2)})
	if !slices.Equal(statuses(b, 1), []Status{StatusBrewing, StatusQueued}) {
		t.Fatalf("交代・入れ替えでカードは動かない：%v", statuses(b, 1))
	}
}

// 入れ替え：名前と上級生かが入れ替わる（担当者なしの列とも入れ替えられる）
func TestSwapLanes(t *testing.T) {
	b := newBoard()
	apply(t, b, Op{Name: "set_lane", Dripper: ptr(1), Person: "山田", Senior: true})
	apply(t, b, Op{Name: "set_lane", Dripper: ptr(3), Person: "鈴木"})
	cs := apply(t, b, Op{Name: "swap_lanes", Dripper: ptr(1), OtherDripper: ptr(3)})
	if x, y := laneOf(b, 1), laneOf(b, 3); x.Name != "鈴木" || x.Senior || y.Name != "山田" || !y.Senior {
		t.Fatalf("入れ替え：%+v %+v", x, y)
	}
	if !slices.Equal(cs.Lanes, []int{1, 3}) {
		t.Fatalf("変わった列：%v", cs.Lanes)
	}
	apply(t, b, Op{Name: "swap_lanes", Dripper: ptr(3), OtherDripper: ptr(6)})
	if x, y := laneOf(b, 3), laneOf(b, 6); x.Name != "" || x.Senior || y.Name != "山田" || !y.Senior {
		t.Fatalf("担当者なしの列と入れ替え：%+v %+v", x, y)
	}
	isInvalid(t, applyErr(b, Op{Name: "swap_lanes", Dripper: ptr(1), OtherDripper: ptr(1)}), "同じ列どうしは入れ替えられません")
	isInvalid(t, applyErr(b, Op{Name: "swap_lanes", Dripper: ptr(1)}), "入れ替える相手のドリッパーは 1〜6 です")
	isInvalid(t, applyErr(b, Op{Name: "swap_lanes", Dripper: ptr(1), OtherDripper: ptr(0)}), "入れ替える相手のドリッパーは 1〜6 です")
}

// 1つ戻す：操作の前の担当者に戻る。一度も替えていない列は「替えていない」状態に戻る。
// 記録のあとほかの端末で替えていたら断り、何も変えない
func TestRestoreLanes(t *testing.T) {
	b := newBoard()
	apply(t, b, Op{Name: "set_lane", Dripper: ptr(1), Person: "山田", Senior: true})
	before := b.LaneRows([]int{1, 2})
	cs := apply(t, b, Op{Name: "swap_lanes", Dripper: ptr(1), OtherDripper: ptr(2)})
	after := b.LaneRows(cs.Lanes)
	restored := &Changeset{}
	if err := b.RestoreLanes(restored, before, after); err != nil {
		t.Fatal(err)
	}
	if x, y := laneOf(b, 1), laneOf(b, 2); x.Name != "山田" || !x.Senior || y.Name != "" || y.UpdatedAt != nil {
		t.Fatalf("戻す：%+v %+v", x, y)
	}
	if !slices.Equal(restored.Lanes, []int{1, 2}) {
		t.Fatalf("戻した列：%v", restored.Lanes)
	}

	cs = apply(t, b, Op{Name: "set_lane", Dripper: ptr(1), Person: "佐藤"})
	after = b.LaneRows(cs.Lanes)
	apply(t, b, Op{Name: "set_lane", Dripper: ptr(1), Person: "鈴木"})
	state := fmt.Sprint(b.Lanes())
	isInvalid(t, b.RestoreLanes(&Changeset{}, before[:1], after), "ほかの端末で担当者を替えたため、元に戻せません")
	if fmt.Sprint(b.Lanes()) != state {
		t.Fatal("断ったのに変わった")
	}
}

// 保存してある担当者を読み込む（範囲外の列は無視する）
func TestLoadLanes(t *testing.T) {
	b := newBoard()
	b.LoadLanes([]Lane{{Dripper: 4, Name: "山田", Senior: true}, {Dripper: 9, Name: "誰か"}})
	if l := laneOf(b, 4); l.Name != "山田" || !l.Senior {
		t.Fatalf("読み込み：%+v", l)
	}
	if len(b.Lanes()) != 6 {
		t.Fatalf("6 列のまま：%+v", b.Lanes())
	}
}

// 保存をまとめる MergeChanges も、担当者が変わった列を落とさない
func TestMergeChangesKeepsLanes(t *testing.T) {
	b := seeded(t)
	ingest := &Changeset{}
	b.IngestOrders(ingest, []Order{order1(1), single(2), single(3), single(4)}, true)
	cs := apply(t, b, Op{Name: "swap_lanes", Dripper: ptr(4), OtherDripper: ptr(2)})
	merged := b.MergeChanges(ingest, cs)
	if !slices.Equal(merged.Lanes, []int{4, 2}) || merged.Changed.Len() == 0 {
		t.Fatalf("列もカードもまとめる：%+v", merged)
	}
}

// ApplyRecorded・Undo（本番の CaosStore と練習用の盤面が同じように使う「1つ戻す」）：
// 記録には操作で変わったカードと列だけが入り、戻すとカードも列も操作の前に戻る。あとで触られていたら断り、何も変えない
func TestApplyRecordedAndUndo(t *testing.T) {
	b := seeded(t)
	first := cardsOf(b, 2)[0]
	rec, err := b.ApplyRecorded(&Changeset{}, Op{Name: "assign", DripID: first.ID, Dripper: ptr(3)})
	if err != nil {
		t.Fatal(err)
	}
	if len(rec.Before) != 1 || rec.Before[0].Status != StatusUnassigned || len(rec.After) != 1 || rec.After[0].Status != StatusBrewing ||
		len(rec.LanesBefore) != 0 || len(rec.LanesAfter) != 0 {
		t.Fatalf("割当の記録：%+v", rec)
	}
	laneRec, err := b.ApplyRecorded(&Changeset{}, Op{Name: "set_lane", Dripper: ptr(3), Person: "山田"})
	if err != nil {
		t.Fatal(err)
	}
	if len(laneRec.Before) != 0 || len(laneRec.LanesBefore) != 1 || laneRec.LanesBefore[0].Name != "" || laneRec.LanesAfter[0].Name != "山田" {
		t.Fatalf("交代の記録：%+v", laneRec)
	}
	if _, err := b.ApplyRecorded(&Changeset{}, Op{Name: "next", Dripper: ptr(5)}); !IsInvalid(err) {
		t.Fatalf("ルールに合わない操作は断る：%v", err)
	}

	// 交代のあとにもう一度替えていたら、交代は戻せない（何も変えない）
	apply(t, b, Op{Name: "set_lane", Dripper: ptr(3), Person: "佐藤"})
	state := fmt.Sprint(b.List(), b.Lanes())
	isInvalid(t, b.Undo(&Changeset{}, laneRec), "ほかの端末で担当者を替えたため、元に戻せません")
	if fmt.Sprint(b.List(), b.Lanes()) != state {
		t.Fatal("断ったのに変わった")
	}
	// 割当は戻せる（カードは未割当に戻る）
	cs := &Changeset{}
	if err := b.Undo(cs, rec); err != nil {
		t.Fatal(err)
	}
	checkInvariants(t, b)
	if d := b.Drips[first.ID]; d.Status != StatusUnassigned || d.Dripper != nil || !slices.Equal(cs.Changed.List(), []string{first.ID}) {
		t.Fatalf("割当を戻す：%+v %v", d, cs.Changed.List())
	}
	isInvalid(t, b.Undo(&Changeset{}, OpRecord{After: rec.After}), "ほかの端末で変更されたため、元に戻せません")
}
