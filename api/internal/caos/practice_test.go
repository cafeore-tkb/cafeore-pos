package caos

import (
	"encoding/json"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"
)

// 練習用の盤面の決まり（DB なし）。ルールは本番と同じ Board なので、ここでは「注文が時刻どおりに届く」「時刻が練習の時計で付く」
// 「準備完了と 1つ戻すが練習の盤面の中で閉じる」を確かめる（本番の表に触らないことは handlers の caos_practice_store_test.go）。

// 2025 年の祭の 10:00（日本時間）から 30 分
var practiceStart = time.Date(2025, 11, 2, 10, 0, 0, 0, jst)

func practiceInput() PracticeInput {
	at := func(min int) time.Time { return practiceStart.Add(time.Duration(min) * time.Minute) }
	return PracticeInput{
		StartsAt: practiceStart,
		EndsAt:   practiceStart.Add(30 * time.Minute),
		Orders: []PracticeOrderInput{
			// 並びは作った順でなくてもよい（サーバーが並べる）
			{OrderNo: 12, CreatedAt: at(5), BillingAmount: 400, Lines: []PracticeLineInput{
				{ItemKey: "01_yukari_brend", Name: "縁ブレンド", Type: "hot", Price: 400, Quantity: 1},
			}},
			{OrderNo: 11, CreatedAt: at(1), BillingAmount: 1700, Lines: []PracticeLineInput{
				{ItemKey: "01_yukari_brend", Name: "縁ブレンド", Type: "hot", Price: 400, Quantity: 3},
				{ItemKey: "40_ice_milk", Name: "アイスミルク", Type: "milk", Price: 300, Quantity: 1},
				{ItemKey: "50_coaster", Name: "コースター", Type: "others", Price: 200, Quantity: 1},
			}},
			{OrderNo: 13, CreatedAt: at(6), BillingAmount: 400, Lines: []PracticeLineInput{
				{ItemKey: "01_yukari_brend", Name: "縁ブレンド", Type: "hot", Price: 400, Quantity: 1},
			}},
		},
		Lanes: []PracticeLaneInput{{Dripper: 1, Name: " 山田 ", Senior: true}, {Dripper: 2, Name: "", Senior: true}},
	}
}

func seqIDs() func() string {
	n := 0
	return func() string {
		n++
		return fmt.Sprintf("00000000-0000-0000-0000-%012d", 1000+n)
	}
}

// newPractice は練習の盤面を作り、DB の行と同じく JSON を通した写しを返す（保存して読み直したときと同じ形で確かめる）
func newPractice(t *testing.T) *PracticeDoc {
	t.Helper()
	d, err := NewPracticeDoc(practiceInput(), seqIDs())
	if err != nil {
		t.Fatal(err)
	}
	return roundTrip(t, d)
}

func roundTrip(t *testing.T, d *PracticeDoc) *PracticeDoc {
	t.Helper()
	v, err := json.Marshal(d)
	if err != nil {
		t.Fatal(err)
	}
	var out PracticeDoc
	if err := json.Unmarshal(v, &out); err != nil {
		t.Fatal(err)
	}
	return &out
}

// step は CaosPracticeStore.Advance・CaosPracticeStore.Apply と同じく、練習の盤面を at まで進めて op を行う（op が空なら進めるだけ）。
// 渡した盤面は変えず、保存して読み直したときと同じ形（JSON を通した写し）を返す。断ったときは渡した盤面をそのまま返す（保存しない）
func step(t *testing.T, d *PracticeDoc, at time.Time, op *Op) (*PracticeDoc, string, error) {
	t.Helper()
	work := roundTrip(t, d)
	var id string
	var err error
	if op == nil {
		err = work.Advance(at)
	} else {
		id, err = work.Apply(at, *op, uuid.NewString)
	}
	if err != nil {
		return d, "", err
	}
	return roundTrip(t, work), id, nil
}

func mustStep(t *testing.T, d *PracticeDoc, at time.Time, op *Op) (*PracticeDoc, string) {
	t.Helper()
	d, id, err := step(t, d, at, op)
	if err != nil {
		t.Fatal(err)
	}
	return d, id
}

func TestPracticeDocFromInput(t *testing.T) {
	d := newPractice(t)
	if len(d.Items) != 3 {
		t.Fatalf("商品はキーごとに 1 つ：%+v", d.Items)
	}
	if d.Orders[0].OrderNo != 11 || d.Orders[1].OrderNo != 12 || d.Orders[2].OrderNo != 13 {
		t.Fatalf("注文は作った順に並ぶ：%+v", d.Orders)
	}
	if d.Arrived != 0 || len(d.Drips) != 0 || !d.Now.Equal(practiceStart) {
		t.Fatalf("始めは注文が届いていない：%+v", d)
	}
	s := d.State("x")
	if s.TotalOrders != 3 || len(s.Orders) != 0 || s.NextArrivalAt == nil || !s.NextArrivalAt.Equal(practiceStart.Add(time.Minute)) {
		t.Fatalf("次に届く注文の時刻：%+v", s)
	}
	if s.Lanes[0].Name != "山田" || !s.Lanes[0].Senior || s.Lanes[1].Senior || len(s.Lanes) != 6 {
		t.Fatalf("列の担当者の初めの状態（名前の無い列は上級生にしない）：%+v", s.Lanes)
	}

	bad := []func(*PracticeInput){
		func(in *PracticeInput) { in.EndsAt = in.StartsAt },
		func(in *PracticeInput) { in.EndsAt = in.StartsAt.Add(7 * time.Hour) },
		func(in *PracticeInput) { in.Orders[0].CreatedAt = in.StartsAt.Add(-time.Second) },
		func(in *PracticeInput) { in.Orders[0].Lines[0].Quantity = 0 },
		func(in *PracticeInput) { in.Orders[0].Lines[0].Name = " " },
		func(in *PracticeInput) { in.Lanes[0].Dripper = 7 },
	}
	for i, mutate := range bad {
		in := practiceInput()
		mutate(&in)
		if _, err := NewPracticeDoc(in, seqIDs()); !IsInvalid(err) {
			t.Errorf("%d: 正しくない入力は断る：%v", i, err)
		}
	}
}

func TestPracticeOrdersArriveOnTheClock(t *testing.T) {
	d := newPractice(t)
	d, _ = mustStep(t, d, practiceStart.Add(30*time.Second), nil)
	if d.Arrived != 0 || len(d.Drips) != 0 {
		t.Fatalf("時刻の前の注文は届かない：%+v", d.Drips)
	}
	d, _ = mustStep(t, d, practiceStart.Add(5*time.Minute), nil)
	if d.Arrived != 2 {
		t.Fatalf("時刻までの注文が届く：%d", d.Arrived)
	}
	// 本番と同じ分け方：縁 3 杯 → 2 杯と 1 杯。アイスミルクとグッズは抽出しない
	cups := map[int][]int{}
	for _, dr := range d.Drips {
		no := 0
		for _, o := range d.Orders {
			if o.ID == dr.OrderIDs[0] {
				no = o.OrderNo
			}
		}
		cups[no] = append(cups[no], dr.Cups)
		if dr.Status != StatusUnassigned || !dr.CreatedAt.Truncate(time.Second).Equal(practiceStart.Add(5*time.Minute)) {
			t.Fatalf("カードは未割当で、練習の時刻で作られる：%+v", dr)
		}
	}
	if fmt.Sprint(cups[11]) != "[2 1]" && fmt.Sprint(cups[11]) != "[1 2]" || fmt.Sprint(cups[12]) != "[1]" {
		t.Fatalf("本番と同じ分け方：%v", cups)
	}
	// 時刻は戻らない
	d, _ = mustStep(t, d, practiceStart.Add(time.Minute), nil)
	if !d.Now.Equal(practiceStart.Add(5 * time.Minute)) {
		t.Fatalf("時刻は戻らない：%v", d.Now)
	}
	if _, _, err := step(t, d, practiceStart.Add(-time.Second), nil); !IsInvalid(err) {
		t.Fatalf("時間帯の前の時刻は断る：%v", err)
	}
	if _, _, err := step(t, d, practiceStart.Add(30*time.Minute+PracticeOvertime+time.Second), nil); !IsInvalid(err) {
		t.Fatalf("終わりから延長の時間を過ぎた時刻は断る：%v", err)
	}
}

func dripOf(d *PracticeDoc, orderNo, cups int) Drip {
	for _, dr := range d.Drips {
		for _, o := range d.Orders {
			if o.OrderNo == orderNo && len(dr.OrderIDs) == 1 && dr.OrderIDs[0] == o.ID && dr.Cups == cups {
				return dr
			}
		}
	}
	return Drip{}
}

func TestPracticeOpsUseThePracticeClockAndReadiness(t *testing.T) {
	d := newPractice(t)
	t0 := practiceStart.Add(6 * time.Minute)
	d, _ = mustStep(t, d, t0, nil)
	one := ptr(1)

	// #12（1 杯）を 1 番へ → そのまま抽出中。開始は練習の時刻
	d, _ = mustStep(t, d, t0.Add(10*time.Second), &Op{Name: "assign", DripID: dripOf(d, 12, 1).ID, Dripper: one})
	dr := dripOf(d, 12, 1)
	if dr.Status != StatusBrewing || dr.StartedAt == nil || !dr.StartedAt.Truncate(time.Second).Equal(t0.Add(10*time.Second)) {
		t.Fatalf("練習の時刻で抽出を始める：%+v", dr)
	}
	// 次へ → 終わり、#12 は練習の盤面の中で準備完了（時刻は練習の時計）
	at := t0.Add(2*time.Minute + 30*time.Second)
	d, nextID := mustStep(t, d, at, &Op{Name: "next", Dripper: one, DripID: dr.ID})
	var o12 PracticeOrder
	for _, o := range d.Orders {
		if o.OrderNo == 12 {
			o12 = o
		}
	}
	if o12.ReadyAt == nil || !o12.ReadyAt.Equal(at) {
		t.Fatalf("注文のカードが全部終わったら、練習の時刻で準備完了：%+v", o12)
	}
	if d.Ops[len(d.Ops)-1].Readied[0] != o12.ID {
		t.Fatalf("操作の記録に、準備完了にした注文を残す：%+v", d.Ops)
	}

	// 1つ戻す → 抽出中に戻り、準備完了も外れる
	d, _ = mustStep(t, d, at.Add(time.Second), &Op{Name: "undo", OpID: nextID})
	if dripOf(d, 12, 1).Status != StatusBrewing {
		t.Fatalf("1つ戻すで抽出中に戻る：%+v", dripOf(d, 12, 1))
	}
	for _, o := range d.Orders {
		if o.OrderNo == 12 && o.ReadyAt != nil {
			t.Fatalf("1つ戻すで準備完了も外れる：%+v", o)
		}
	}
	if _, _, err := step(t, d, at.Add(2*time.Second), &Op{Name: "undo", OpID: nextID}); !IsInvalid(err) {
		t.Fatalf("同じ操作は 2 回戻せない：%v", err)
	}
	if _, _, err := step(t, d, at.Add(2*time.Second), &Op{Name: "next", Dripper: ptr(2)}); !IsInvalid(err) {
		t.Fatalf("ルールに合わない操作は本番と同じく断る：%v", err)
	}
}

func TestPracticeUndoKeepsCardsThatArrivedLater(t *testing.T) {
	d := newPractice(t)
	t0 := practiceStart.Add(5 * time.Minute)
	d, _ = mustStep(t, d, t0, nil)
	// #11 の 1 杯と #12 の 1 杯（同じ商品）を統合
	d, mergeID := mustStep(t, d, t0, &Op{Name: "merge", FirstID: dripOf(d, 11, 1).ID, SecondID: dripOf(d, 12, 1).ID})
	if len(d.Drips) != 2 {
		t.Fatalf("統合すると 2 枚：%+v", d.Drips)
	}
	// 統合の操作と一緒に #13 が届く（同じ要求の中で、操作の前に届く）。届いたカードは操作の記録に入らない
	d, _ = mustStep(t, d, t0.Add(time.Minute), &Op{Name: "assign", DripID: dripOf(d, 11, 2).ID, Dripper: ptr(3)})
	if d.Arrived != 3 || len(d.Drips) != 3 {
		t.Fatalf("#13 が届く：%+v", d.Drips)
	}
	assignOp := d.Ops[len(d.Ops)-1]
	if len(assignOp.Record.After) != 1 || len(assignOp.Record.Before) != 1 {
		t.Fatalf("届いたカードは操作の記録に入らない：%+v", assignOp.Record)
	}
	// 統合を戻しても、あとで届いた #13 のカードは残る
	d, _ = mustStep(t, d, t0.Add(2*time.Minute), &Op{Name: "undo", OpID: mergeID})
	if len(d.Drips) != 4 || dripOf(d, 13, 1).ID == "" {
		t.Fatalf("統合を戻す（届いたカードは残る）：%+v", d.Drips)
	}
}

func TestPracticeKeepsOnlyRecentOps(t *testing.T) {
	d := newPractice(t)
	t0 := practiceStart.Add(5 * time.Minute)
	d, _ = mustStep(t, d, t0, nil)
	for i := 0; i < practiceKeepOps+5; i++ {
		d, _ = mustStep(t, d, t0, &Op{Name: "set_lane", Dripper: ptr(2), Person: fmt.Sprintf("p%d", i)})
	}
	if len(d.Ops) != practiceKeepOps || d.Lanes[1].Name != fmt.Sprintf("p%d", practiceKeepOps+4) {
		t.Fatalf("操作の記録は新しいものだけ残す：%d %+v", len(d.Ops), d.Lanes[1])
	}
}
