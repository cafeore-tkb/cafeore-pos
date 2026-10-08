package handlers

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"cafeore-pos/api/internal/caos"
)

// 抽出時間の集計（GET /api/caos/brew-stats）を、本物の Postgres で、盤面への操作から通して確かめる。
// CAOS_TEST_DATABASE_URL を渡したときだけ動く（caos_store_test.go と同じ）。

func TestCaosStoreBrewStats(t *testing.T) {
	db := testDB(t)
	cat := seedCatalog(t, db)
	s := newStore(db)
	now := dayStart.Add(9 * time.Hour)
	s.clock = caos.MonotonicClock(func() time.Time { return now })
	at := func(h, m, sec int) {
		now = dayStart.Add(time.Duration(h)*time.Hour + time.Duration(m)*time.Minute + time.Duration(sec)*time.Second)
	}
	apply := func(op caos.Op) caos.Result {
		t.Helper()
		res, err := s.Apply(op)
		must(t, err)
		return res
	}
	cardOf := func(orderID string) caos.Drip {
		t.Helper()
		for _, d := range drips(t, s) {
			if d.RebrewOf == nil && d.Lines[0].OrderID == orderID {
				return d
			}
		}
		t.Fatalf("注文 %s のカードが無い", orderID)
		return caos.Drip{}
	}

	// 9:00 に列 1 を山田にする。列 3 を鈴木にしたが、すぐ戻した
	apply(caos.Op{Name: "set_lane", Dripper: ptr(1), Person: "山田"})
	at(9, 1, 0)
	setSuzuki := apply(caos.Op{Name: "set_lane", Dripper: ptr(3), Person: "鈴木"})
	at(9, 2, 0)
	apply(caos.Op{Name: "undo", OpID: setSuzuki.OpID})

	o1 := createOrder(t, s, db, 1, dayStart.Add(10*time.Hour), cat.champ)
	o2 := createOrder(t, s, db, 2, dayStart.Add(10*time.Hour+time.Minute), cat.champ)
	o3 := createOrder(t, s, db, 3, dayStart.Add(10*time.Hour+2*time.Minute), cat.champ)
	o4 := createOrder(t, s, db, 4, dayStart.Add(10*time.Hour+3*time.Minute), cat.champ)

	// 山田が 150 秒で淹れる
	at(10, 2, 0)
	apply(caos.Op{Name: "assign", DripID: cardOf(o1.ID.String()).ID, Dripper: ptr(1)})
	at(10, 4, 30)
	apply(caos.Op{Name: "next", Dripper: ptr(1)})
	// 次は 135 秒。抽出の途中で佐藤に交代した（担当者ごとには入れない）
	at(10, 5, 0)
	apply(caos.Op{Name: "assign", DripID: cardOf(o2.ID.String()).ID, Dripper: ptr(1)})
	at(10, 6, 0)
	apply(caos.Op{Name: "set_lane", Dripper: ptr(1), Person: "佐藤"})
	at(10, 7, 15)
	apply(caos.Op{Name: "next", Dripper: ptr(1)})
	// 列 2（担当者なし）：途中でやめて 1 杯入れ直した
	at(10, 10, 0)
	src := cardOf(o3.ID.String())
	apply(caos.Op{Name: "assign", DripID: src.ID, Dripper: ptr(2)})
	at(10, 11, 0)
	apply(caos.Op{Name: "rebrew", SourceID: src.ID, Cups: 1, Interrupt: true, Dripper: ptr(2)})
	at(10, 13, 20)
	apply(caos.Op{Name: "next", Dripper: ptr(2)})
	// 列 3（鈴木は戻したので担当者なし）：200 秒
	at(10, 20, 0)
	apply(caos.Op{Name: "assign", DripID: cardOf(o4.ID.String()).ID, Dripper: ptr(3)})
	at(10, 23, 20)
	apply(caos.Op{Name: "next", Dripper: ptr(3)})

	// 次の日にも 1 杯（day を付けると、その日だけ）
	s.today = func() string { return "2026-11-02" }
	createOrder(t, s, db, 1, dayStart.AddDate(0, 0, 1).Add(10*time.Hour), cat.champ)
	at(34, 0, 0)
	d5, err := s.Drips("2026-11-02")
	must(t, err)
	apply(caos.Op{Name: "assign", DripID: d5[0].ID, Dripper: ptr(1)})
	at(34, 2, 0)
	apply(caos.Op{Name: "next", Dripper: ptr(1)})

	stats, err := s.BrewStats(testDay)
	must(t, err)
	got, err := json.Marshal(stats)
	must(t, err)
	want := `{"standard":{"one_cup_sec":135,"two_cup_sec":195},"brews":3,` +
		`"by_dripper":[{"day":"2026-11-01","dripper":1,"cups":1,"brews":2,"avg_sec":142.5,"median_sec":142.5,"stddev_sec":10.6,"coefficient":1.06},` +
		`{"day":"2026-11-01","dripper":3,"cups":1,"brews":1,"avg_sec":200,"median_sec":200,"stddev_sec":0,"coefficient":1.48}],` +
		`"by_slot":[{"day":"2026-11-01","slot":"10:00","cups":1,"brews":3,"avg_sec":161.7,"median_sec":150,"stddev_sec":34,"coefficient":1.2}],` +
		`"by_person":[{"name":"山田","cups":1,"brews":1,"avg_sec":150,"median_sec":150,"stddev_sec":0,"coefficient":1.11}],` +
		`"person_skipped":{"no_person":1,"handover":1},` +
		`"rebrews":[{"day":"2026-11-01","dripper":2,"rebrews":1,"interrupted":1,"extra_cups":1}]}`
	if string(got) != want {
		t.Fatalf("その日の集計：\n%s\n%s", got, want)
	}

	all, err := s.BrewStats("")
	must(t, err)
	if all.Brews != 4 || len(all.ByDripper) != 3 || all.ByDripper[2].Day != "2026-11-02" || all.PersonSkipped.NoPerson != 2 {
		t.Fatalf("day を省くと全部の日：%+v", all)
	}
}

func TestCaosBrewStatsThroughHTTP(t *testing.T) {
	e := newCaosEnv(t)
	var stats caos.BrewStats
	if code := e.call(t, http.MethodGet, "/api/caos/brew-stats", nil, &stats); code != http.StatusOK || stats.Brews != 0 || stats.ByDripper == nil {
		t.Fatalf("カードが無くても 200 で空の集計：%d %+v", code, stats)
	}
	if code := e.call(t, http.MethodGet, "/api/caos/brew-stats?day=2026-11-01", nil, &stats); code != http.StatusOK {
		t.Fatalf("日を指定：%d", code)
	}
	for _, bad := range []string{"2026-13-01", "20261101", "x"} {
		if code := e.call(t, http.MethodGet, "/api/caos/brew-stats?day="+bad, nil, nil); code != http.StatusBadRequest {
			t.Fatalf("日付が正しくないと 400（%s）：%d", bad, code)
		}
	}
}
