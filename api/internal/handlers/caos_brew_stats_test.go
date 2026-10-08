package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"cafeore-pos/api/internal/caosstats"
)

// 抽出時間の集計（GET /api/caos/brew-stats）の DB のテスト。LISTEN_TEST_DATABASE_URL を渡したときだけ走る。
// 集計の決まりそのものは caosstats の単体テスト。ここは、本物の割当・次へ・交代・入れ替え・緊急・中断で書いた列と交代の記録を読んで渡せているかを見る。

func (f *caosFixture) brewStats(t *testing.T, query string) (int, string) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/caos/brew-stats"+query, nil)
	f.caos.GetCaosBrewStats(c)
	return w.Code, w.Body.String()
}

func (f *caosFixture) brewStatsJSON(t *testing.T, body string) caosstats.BrewStats {
	t.Helper()
	var stats caosstats.BrewStats
	if err := json.Unmarshal([]byte(body), &stats); err != nil {
		t.Fatal(err)
	}
	return stats
}

func TestCaosBrewStatsOnDB(t *testing.T) {
	db, _ := openListenTestDB(t)
	f := newCaosFixture(t, db)
	day := time.Date(2026, 11, 1, 0, 0, 0, 0, jst)
	clock := day
	f.caos.now = func() time.Time { return clock }
	set := func(h, m, s int) {
		clock = day.Add(time.Duration(h)*time.Hour + time.Duration(m)*time.Minute + time.Duration(s)*time.Second)
	}
	next := func(dripper int, card uuid.UUID) {
		t.Helper()
		if code, _ := f.next(t, dripper, &card); code != http.StatusOK {
			t.Fatalf("next %d = %d", dripper, code)
		}
	}

	set(9, 0, 0)
	f.mustPutLane(t, 1, "山田", true)
	o1 := f.createOrderAt(t, 1, clock, line(f.blend))
	o2 := f.createOrderAt(t, 2, clock, line(f.blend, f.blend))
	o3 := f.createOrderAt(t, 3, clock, line(f.blend))
	o4 := f.createOrderAt(t, 4, clock, line(f.blend))
	o6 := f.createOrderAt(t, 6, clock, line(f.blend))
	o7 := f.createOrderAt(t, 7, clock, line(f.blend))
	card1, card2, card3, card4, card6, card7, rebrew := uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New()

	// #1：1 番で 10:00 に始め 150 秒。始めたあと（10:01）に 1 番の担当者を佐藤に替えたが、始めたときの山田に数える
	set(10, 0, 0)
	f.mustPut(t, write(ids(o1.OrderCups...), unassigned, placed(1, 1, card1, true)))
	set(10, 1, 0)
	f.mustPutLane(t, 1, "佐藤", false)
	set(10, 2, 30)
	next(1, card1)
	// #2：2 杯を 2 番（担当者なし）で 195 秒
	set(10, 3, 0)
	f.mustPut(t, write(ids(o2.OrderCups...), unassigned, placed(2, 1, card2, true)))
	set(10, 6, 15)
	next(2, card2)
	// #3：1 番で 135 秒淹れたあと緊急にし（最初の抽出の列は残る）、1 番で入れ直した
	set(10, 10, 0)
	f.mustPut(t, write(ids(o3.OrderCups...), unassigned, placed(1, 2, card3, true)))
	set(10, 12, 15)
	next(1, card3)
	set(10, 13, 0)
	f.mustEmergency(t, false, o3.OrderCups[0].ID)
	set(10, 14, 0)
	f.mustPut(t, write(ids(o3.OrderCups...), f.state(t, o3.OrderCups[0].ID), placed(1, 3, rebrew, true)))
	set(10, 16, 0)
	next(1, rebrew)
	// #4：1 番で 10:20 に始め 120 秒（担当者は佐藤）
	set(10, 20, 0)
	f.mustPut(t, write(ids(o4.OrderCups...), unassigned, placed(1, 4, card4, true)))
	set(10, 22, 0)
	next(1, card4)
	// 10:25 に 1 番と 2 番の担当者を入れ替え（佐藤は 2 番へ）。#6：2 番で 10:30 に始め 135 秒（佐藤）
	set(10, 25, 0)
	if code, body := f.swapLanes(t, 1, 2); code != http.StatusOK {
		t.Fatalf("swap = %d %s", code, body)
	}
	set(10, 30, 0)
	f.mustPut(t, write(ids(o6.OrderCups...), unassigned, placed(2, 6, card6, true)))
	set(10, 32, 15)
	next(2, card6)
	// #7：3 番で 10:40 に始め、10:41 に中断（最初の抽出は始めた時刻だけ。まとめには入れず interrupted_brews に数える）
	set(10, 40, 0)
	f.mustPut(t, write(ids(o7.OrderCups...), unassigned, placed(3, 7, card7, true)))
	set(10, 41, 0)
	f.mustEmergency(t, true, o7.OrderCups[0].ID)

	// 次の日の抽出（day で絞ると入らない）
	set(24+10, 0, 0)
	o5 := f.createOrderAt(t, 5, clock, line(f.blend))
	card5 := uuid.New()
	f.mustPut(t, write(ids(o5.OrderCups...), unassigned, placed(3, 1, card5, true)))
	set(24+10, 2, 0)
	next(3, card5)

	want := `{"standard":{"one_cup_sec":135,"two_cup_sec":195},"brews":5,` +
		`"by_dripper":[{"day":"2026-11-01","dripper":1,"cups":1,"brews":3,"avg_sec":135,"median_sec":135,"stddev_sec":15,"coefficient":1},` +
		`{"day":"2026-11-01","dripper":2,"cups":1,"brews":1,"avg_sec":135,"median_sec":135,"stddev_sec":0,"coefficient":1},` +
		`{"day":"2026-11-01","dripper":2,"cups":2,"brews":1,"avg_sec":195,"median_sec":195,"stddev_sec":0,"coefficient":1}],` +
		`"by_slot":[{"day":"2026-11-01","slot":"10:00","cups":1,"brews":3,"avg_sec":135,"median_sec":135,"stddev_sec":15,"coefficient":1},` +
		`{"day":"2026-11-01","slot":"10:00","cups":2,"brews":1,"avg_sec":195,"median_sec":195,"stddev_sec":0,"coefficient":1},` +
		`{"day":"2026-11-01","slot":"10:30","cups":1,"brews":1,"avg_sec":135,"median_sec":135,"stddev_sec":0,"coefficient":1}],` +
		`"by_person":[{"name":"佐藤","cups":1,"brews":3,"avg_sec":130,"median_sec":135,"stddev_sec":8.7,"coefficient":0.96},` +
		`{"name":"山田","cups":1,"brews":1,"avg_sec":150,"median_sec":150,"stddev_sec":0,"coefficient":1.11}],` +
		`"person_skipped":{"no_person":1},` +
		`"rebrews":[{"day":"2026-11-01","dripper":1,"rebrews":1,"extra_cups":1}],` +
		`"interrupted_brews":1}`
	if code, body := f.brewStats(t, "?day=2026-11-01"); code != http.StatusOK || body != want {
		t.Fatalf("brew-stats?day=2026-11-01 = %d\n%s\nwant\n%s", code, body, want)
	}
	// day を省くと全部の日（次の日の 1 杯が増える。その日の交代の記録が無いので担当者なし）
	code, body := f.brewStats(t, "")
	if code != http.StatusOK {
		t.Fatalf("brew-stats = %d: %s", code, body)
	}
	all := f.brewStatsJSON(t, body)
	if all.Brews != 6 || all.PersonSkipped.NoPerson != 2 || len(all.ByDripper) != 4 {
		t.Fatalf("brew-stats (all days) = %s", body)
	}
	if code, _ := f.brewStats(t, "?day=2026-1-1"); code != http.StatusBadRequest {
		t.Fatalf("brew-stats?day=2026-1-1 = %d, want 400", code)
	}
}
