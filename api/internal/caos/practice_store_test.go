package caos

import (
	"testing"
	"time"

	"github.com/google/uuid"
)

// 練習用の盤面の保存（本物の Postgres）。保存して読み直しても同じ盤面になること、片付け、本番の表に触らないこと。
func TestPracticeStoreFlowAndCleanup(t *testing.T) {
	db := testDB(t)
	s := NewPracticeStore(db)
	realNow := time.Date(2026, 10, 8, 12, 0, 0, 0, jst)
	s.now = func() time.Time { return realNow }

	state, err := s.Create(practiceInput())
	must(t, err)
	t0 := practiceStart.Add(6 * time.Minute)
	state, err = s.Advance(state.ID, t0)
	must(t, err)
	if len(state.Orders) != 3 || len(state.Drips) != 4 {
		t.Fatalf("注文が届く：%+v", state)
	}
	var target Drip
	for _, d := range state.Drips {
		if d.Cups == 2 {
			target = d
		}
	}
	opID, state, err := s.Apply(state.ID, t0.Add(time.Second), Op{Name: "assign", DripID: target.ID, Dripper: ptr(4)})
	must(t, err)
	if opID == "" {
		t.Fatal("操作の記録の ID を返す")
	}
	// ルールに合わない操作は何も保存しない（時計も進まない）
	if _, _, err := s.Apply(state.ID, t0.Add(time.Hour), Op{Name: "next", Dripper: ptr(5)}); !IsInvalid(err) {
		t.Fatalf("ルールに合わない操作：%v", err)
	}
	got, err := s.Get(state.ID)
	must(t, err)
	if got.Version != state.Version || !got.Now.Equal(t0.Add(time.Second)) {
		t.Fatalf("断った操作は保存しない：%+v", got)
	}
	_, state, err = s.Apply(state.ID, t0.Add(2*time.Second), Op{Name: "undo", OpID: opID})
	must(t, err)
	for _, d := range state.Drips {
		if d.ID == target.ID && d.Status != StatusUnassigned {
			t.Fatalf("1つ戻すで未割当に戻る：%+v", d)
		}
	}

	// 本番の盤面の表には何も入らない
	for _, table := range []string{"caos_drips", "caos_ops", "caos_lanes", "orders"} {
		var n int64
		must(t, db.Table(table).Count(&n).Error)
		if n != 0 {
			t.Fatalf("練習で本番の %s に行ができた：%d", table, n)
		}
	}

	// 片付け：最後に触ってから PracticeTTL を過ぎた練習は、次に練習を始めたときに消える
	realNow = realNow.Add(PracticeTTL + time.Minute)
	fresh, err := s.Create(practiceInput())
	must(t, err)
	if _, err := s.Get(state.ID); err != ErrPracticeNotFound {
		t.Fatalf("放置された練習は消える：%v", err)
	}
	if _, err := s.Get(fresh.ID); err != nil {
		t.Fatalf("新しい練習は残る：%v", err)
	}

	// 数の上限：PracticeMax を超えたら古いものから消す
	rows := make([]PracticeRow, PracticeMax+5)
	for i := range rows {
		at := realNow.Add(-time.Duration(len(rows)-i) * time.Second)
		rows[i] = PracticeRow{ID: uuid.New(), State: jsonValue[practiceDoc]{practiceDoc{}}, CreatedAt: at, UpdatedAt: at}
	}
	must(t, db.Create(&rows).Error)
	_, err = s.Create(practiceInput())
	must(t, err)
	var n int64
	must(t, db.Model(&PracticeRow{}).Count(&n).Error)
	if n != PracticeMax {
		t.Fatalf("練習の盤面は %d まで：%d", PracticeMax, n)
	}
	var oldest int64
	must(t, db.Model(&PracticeRow{}).Where("id = ?", rows[0].ID).Count(&oldest).Error)
	if oldest != 0 {
		t.Fatal("古いものから消す")
	}

	must(t, s.Delete(fresh.ID))
	if _, err := s.Get(fresh.ID); err != ErrPracticeNotFound {
		t.Fatalf("消した練習は読めない：%v", err)
	}
	must(t, s.Delete(fresh.ID))
}
