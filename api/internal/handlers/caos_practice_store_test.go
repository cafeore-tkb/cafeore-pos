package handlers

import (
	"testing"
	"time"

	"github.com/google/uuid"

	"cafeore-pos/api/internal/caos"
	"cafeore-pos/api/internal/models"
)

// 2025 年の祭の 10:00（日本時間）から 30 分
var practiceStart = time.Date(2025, 11, 2, 10, 0, 0, 0, time.FixedZone("JST", 9*60*60))

func practiceInput() caos.PracticeInput {
	at := func(min int) time.Time { return practiceStart.Add(time.Duration(min) * time.Minute) }
	line := func(key, name, typ string, price, qty int) caos.PracticeLineInput {
		return caos.PracticeLineInput{ItemKey: key, Name: name, Type: typ, Price: price, Quantity: qty}
	}
	return caos.PracticeInput{
		StartsAt: practiceStart,
		EndsAt:   practiceStart.Add(30 * time.Minute),
		Orders: []caos.PracticeOrderInput{
			{OrderNo: 12, CreatedAt: at(5), BillingAmount: 400, Lines: []caos.PracticeLineInput{line("01_yukari_brend", "縁ブレンド", "hot", 400, 1)}},
			{OrderNo: 11, CreatedAt: at(1), BillingAmount: 1700, Lines: []caos.PracticeLineInput{
				line("01_yukari_brend", "縁ブレンド", "hot", 400, 3), line("40_ice_milk", "アイスミルク", "milk", 300, 1),
			}},
			{OrderNo: 13, CreatedAt: at(6), BillingAmount: 400, Lines: []caos.PracticeLineInput{line("01_yukari_brend", "縁ブレンド", "hot", 400, 1)}},
		},
		Lanes: []caos.PracticeLaneInput{{Dripper: 1, Name: "山田", Senior: true}},
	}
}

// 練習用の盤面の保存（CaosPracticeStore。本物の Postgres。CAOS_TEST_DATABASE_URL を渡したときだけ動く）。保存して読み直しても同じ盤面になること、片付け、本番の表に触らないこと。
func TestPracticeStoreFlowAndCleanup(t *testing.T) {
	db := testDB(t)
	s := NewCaosPracticeStore(db)
	realNow := time.Date(2026, 10, 8, 3, 0, 0, 0, time.UTC)
	s.now = func() time.Time { return realNow }

	state, err := s.Create(practiceInput())
	must(t, err)
	t0 := practiceStart.Add(6 * time.Minute)
	state, err = s.Advance(state.ID, t0)
	must(t, err)
	if len(state.Orders) != 3 || len(state.Drips) != 4 {
		t.Fatalf("注文が届く：%+v", state)
	}
	var target caos.Drip
	for _, d := range state.Drips {
		if d.Cups == 2 {
			target = d
		}
	}
	opID, state, err := s.Apply(state.ID, t0.Add(time.Second), caos.Op{Name: "assign", DripID: target.ID, Dripper: intPtr(4)})
	must(t, err)
	if opID == "" {
		t.Fatal("操作の記録の ID を返す")
	}
	// ルールに合わない操作は何も保存しない（時計も進まない）
	if _, _, err := s.Apply(state.ID, t0.Add(time.Hour), caos.Op{Name: "next", Dripper: intPtr(5)}); !caos.IsInvalid(err) {
		t.Fatalf("ルールに合わない操作：%v", err)
	}
	got, err := s.Get(state.ID)
	must(t, err)
	if got.Version != state.Version || !got.Now.Equal(t0.Add(time.Second)) {
		t.Fatalf("断った操作は保存しない：%+v", got)
	}
	_, state, err = s.Apply(state.ID, t0.Add(2*time.Second), caos.Op{Name: "undo", OpID: opID})
	must(t, err)
	for _, d := range state.Drips {
		if d.ID == target.ID && d.Status != caos.StatusUnassigned {
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
	if _, err := s.Get(state.ID); err != errPracticeNotFound {
		t.Fatalf("放置された練習は消える：%v", err)
	}
	if _, err := s.Get(fresh.ID); err != nil {
		t.Fatalf("新しい練習は残る：%v", err)
	}

	// 数の上限：PracticeMax を超えたら古いものから消す
	rows := make([]models.CaosPracticeRow, PracticeMax+5)
	for i := range rows {
		at := realNow.Add(-time.Duration(len(rows)-i) * time.Second)
		rows[i] = models.CaosPracticeRow{ID: uuid.New(), State: caos.PracticeDoc{}, CreatedAt: at, UpdatedAt: at}
	}
	must(t, db.Create(&rows).Error)
	_, err = s.Create(practiceInput())
	must(t, err)
	var n int64
	must(t, db.Model(&models.CaosPracticeRow{}).Count(&n).Error)
	if n != PracticeMax {
		t.Fatalf("練習の盤面は %d まで：%d", PracticeMax, n)
	}
	var oldest int64
	must(t, db.Model(&models.CaosPracticeRow{}).Where("id = ?", rows[0].ID).Count(&oldest).Error)
	if oldest != 0 {
		t.Fatal("古いものから消す")
	}

	must(t, s.Delete(fresh.ID))
	if _, err := s.Get(fresh.ID); err != errPracticeNotFound {
		t.Fatalf("消した練習は読めない：%v", err)
	}
	must(t, s.Delete(fresh.ID))
}
