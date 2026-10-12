package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"cafeore-pos/api/internal/models"
)

// press は押した時刻 at と送った時刻 sent（どちらも端末の時計）。
func press(at, sent time.Time) *models.CaosPress {
	return &models.CaosPress{At: at.UnixMilli(), SentAt: sent.UnixMilli()}
}

// putPressed は押した時刻つきで PUT /api/caos/cups を呼ぶ。
func (f *caosFixture) putPressed(t *testing.T, p *models.CaosPress, writes ...map[string]any) {
	t.Helper()
	body, _ := json.Marshal(map[string]any{"writes": writes, "press": p})
	if w := callWithParams(t, f.caos.WriteCaosCups, http.MethodPut, string(body), nil); w.Code != http.StatusNoContent {
		t.Fatalf("PUT /api/caos/cups = %d: %s", w.Code, w.Body.String())
	}
}

// nextPressed は押した時刻つきで「次へ」を呼ぶ。
func (f *caosFixture) nextPressed(t *testing.T, dripper int, seen *uuid.UUID, p *models.CaosPress) int {
	t.Helper()
	body, _ := json.Marshal(map[string]any{"drip_id": seen, "press": p})
	w := callWithParams(t, f.caos.AdvanceCaosDripper, http.MethodPost, string(body), gin.Params{{Key: "dripper", Value: fmt.Sprint(dripper)}})
	return w.Code
}

func TestCaosPressedAt(t *testing.T) {
	now := time.Date(2026, 10, 12, 12, 0, 0, 0, jst)
	today, _ := caosToday(now)
	for _, tc := range []struct {
		label string
		press *models.CaosPress
		want  time.Time
	}{
		{"押した時刻が無い（古い画面）", nil, now},
		{"押してすぐ送った", press(now.Add(-200*time.Millisecond), now.Add(-100*time.Millisecond)), now.Add(-200 * time.Millisecond)},
		{"電波が切れていて 3 分後に送れた", press(now.Add(-3*time.Minute), now), now.Add(-3 * time.Minute)},
		{"端末の時計が 4 秒進んでいる（ずれとはみない。未来は今）", press(now.Add(4*time.Second), now.Add(4*time.Second)), now},
		{"端末の時計が 4 秒遅れている（ずれとはみない）", press(now.Add(-5*time.Second), now.Add(-4*time.Second)), now.Add(-5 * time.Second)},
		{"端末の時計が 2 分遅れている", press(now.Add(-2*time.Minute-30*time.Second), now.Add(-2*time.Minute)), now.Add(-30 * time.Second)},
		{"端末の時計が 1 時間進んでいる", press(now.Add(time.Hour-time.Minute), now.Add(time.Hour)), now.Add(-time.Minute)},
		{"送ったのが押す前（端末の時計が戻った）", press(now.Add(time.Minute), now), now},
		{"前の日に押した", press(today.Add(-time.Minute), now), now},
	} {
		if got := caosPressedAt(tc.press, now); !got.Equal(tc.want) {
			t.Errorf("%s: %v, want %v", tc.label, got, tc.want)
		}
	}
	// 壊れた値でも、今日の今までの時刻
	for _, v := range [][2]int64{{math.MinInt64, math.MaxInt64}, {math.MaxInt64, math.MinInt64}, {0, 0}, {math.MaxInt64, math.MaxInt64}} {
		if got := caosPressedAt(&models.CaosPress{At: v[0], SentAt: v[1]}, now); got.Before(today) || got.After(now) {
			t.Errorf("press %v: %v, want today until now", v, got)
		}
	}
}

// TestCaosPressTimeOnDB は、抽出の開始・終了を押した時刻で付けることを確かめる（電波が切れていたあいだに押して、あとで届いた操作も）。
func TestCaosPressTimeOnDB(t *testing.T) {
	db := openCaosTestDB(t)
	f := newCaosFixture(t, db)
	now := time.Now().Truncate(time.Millisecond)
	f.caos.now = func() time.Time { return now }
	var o []models.Order
	for no := 1; no <= 9; no++ {
		o = append(o, f.createOrder(t, no, line(f.blend)))
	}
	cupOf := func(i int) uuid.UUID { return o[i].OrderCups[0].ID }
	unit := func(i int) models.OrderCup { return f.cup(t, cupOf(i)) }
	expectTimes := func(label string, i int, started, finished *time.Time) {
		t.Helper()
		c := unit(i)
		if !timeEqual(msTime(c.BrewStartedAt), started) || !timeEqual(msTime(c.BrewFinishedAt), finished) {
			t.Fatalf("%s: started %v finished %v, want %v %v", label, c.BrewStartedAt, c.BrewFinishedAt, started, finished)
		}
	}
	a, b, c := uuid.New(), uuid.New(), uuid.New()

	// 1 分前に押して、いま届いた割当（空いている 1 番で始める）は、押した時刻に始めたことにする
	f.putPressed(t, press(now.Add(-60*time.Second), now), write(ids(o[0].OrderCups[0]), unassigned, placed(1, a, true)))
	expectTimes("割当", 0, ptr(now.Add(-60*time.Second)), nil)
	f.mustPut(t, write(ids(o[1].OrderCups[0]), unassigned, placed(1, b, false)))

	// 「次へ」の 10 秒は押した時刻どうしで比べる（届いたのは始めてから 1 分後でも、押したのが 5 秒後なら断る）
	if code := f.nextPressed(t, 1, &a, press(now.Add(-55*time.Second), now)); code != http.StatusBadRequest {
		t.Fatalf("next pressed 5 seconds after the start = %d, want 400", code)
	}
	// 押した時刻に終えて、待機の先頭を始める
	if code := f.nextPressed(t, 1, &a, press(now.Add(-45*time.Second), now)); code != http.StatusNoContent {
		t.Fatalf("next = %d", code)
	}
	expectTimes("終えたカード", 0, ptr(now.Add(-60*time.Second)), ptr(now.Add(-45*time.Second)))
	expectTimes("始めたカード", 1, ptr(now.Add(-45*time.Second)), nil)
	if code := f.nextPressed(t, 1, &b, press(now.Add(-30*time.Second), now)); code != http.StatusNoContent {
		t.Fatalf("next = %d", code)
	}

	// 前の抽出を終えた時刻より前に押した（ほかの端末が先に終えた）割当は、その終えた時刻に始めたことにする
	f.putPressed(t, press(now.Add(-40*time.Second), now), write(ids(o[2].OrderCups[0]), unassigned, placed(1, c, true)))
	expectTimes("前の抽出のあと", 2, ptr(now.Add(-30*time.Second)), nil)

	// 押した時刻を送らない古い画面はサーバーの今。未来・前の日はサーバーの今。端末の時計がずれていれば、押してから送るまでの長さで決める
	today, _ := caosToday(now)
	for i, tc := range []struct {
		label string
		press *models.CaosPress
		want  time.Time
	}{
		{"古い画面", nil, now},
		{"未来", press(now.Add(3*time.Second), now.Add(3*time.Second)), now},
		{"前の日", press(today.Add(-time.Hour), now), now},
		{"時計が 2 分遅れている", press(now.Add(-2*time.Minute-30*time.Second), now.Add(-2*time.Minute)), now.Add(-30 * time.Second)},
		{"時計が 1 分進んでいる", press(now.Add(40*time.Second), now.Add(time.Minute)), now.Add(-20 * time.Second)},
	} {
		dripper := i + 2
		w := write(ids(o[3+i].OrderCups[0]), unassigned, placed(dripper, uuid.New(), true))
		if tc.press == nil {
			f.mustPut(t, w)
		} else {
			f.putPressed(t, tc.press, w)
		}
		expectTimes(tc.label, 3+i, &tc.want, nil)
	}

	// どの列も、始めた時刻は終えた時刻より前で、前のカードを終えるより前に次のカードを始めていない（抽出時間の集計が負や重なりにならない）
	var cups []models.OrderCup
	if err := db.Where("dripper IS NOT NULL").Order("dripper, brew_started_at").Find(&cups).Error; err != nil {
		t.Fatal(err)
	}
	last := map[int]time.Time{}
	for _, cup := range cups {
		if cup.BrewStartedAt == nil || cup.BrewStartedAt.After(now) || cup.BrewStartedAt.Before(today) {
			t.Fatalf("cup %+v: started at %v, want today until now", cup, cup.BrewStartedAt)
		}
		if cup.BrewFinishedAt != nil && cup.BrewFinishedAt.Before(*cup.BrewStartedAt) {
			t.Fatalf("cup %+v finished before it started", cup)
		}
		if cup.BrewStartedAt.Before(last[*cup.Dripper]) {
			t.Fatalf("cup %+v started before the previous card on dripper %d finished at %v", cup, *cup.Dripper, last[*cup.Dripper])
		}
		if cup.BrewFinishedAt != nil {
			last[*cup.Dripper] = *cup.BrewFinishedAt
		}
	}
}

// 入れ直しの在庫は抽出を始めた時刻で使ったことにする（#908）ので、棚卸しの前に押して棚卸しの後に届いた割当は、棚卸しの後に使った分に数えない。
// 押した時刻を送らない古い画面・未来の時刻はサーバーの今で数える
func TestCupEmergencyPressStockOnDB(t *testing.T) {
	db := openCaosTestDB(t)
	f := newCaosFixture(t, db)
	now := time.Now().Truncate(time.Millisecond)
	f.caos.now = func() time.Time { return now.Add(f.skew) }
	inv := &Inventory{db: db}
	stock := models.StockResource{Kind: string(models.StockResourceKindItem), ItemID: &f.blend.ID, Unit: "g", PerServing: 15}
	if err := db.Create(&stock).Error; err != nil {
		t.Fatal(err)
	}
	o := f.createOrder(t, 1, line(f.blend))
	// 入れ直しは 2 分前に足し、1 分前に棚卸しをした
	f.skew = -2 * time.Minute
	if code, body := f.addEmergencies(t, o.OrderCups[0].ID); code != http.StatusCreated {
		t.Fatalf("POST = %d: %s", code, body)
	}
	f.skew = 0
	e := f.emergencies(t, o.OrderCups[0].ID)[0].ID
	counted := now.Add(-time.Minute)
	if err := db.Create(&models.StockEvent{ResourceID: stock.ID, Kind: string(models.StockEventKindCount), Quantity: 1000, CreatedAt: counted}).Error; err != nil {
		t.Fatal(err)
	}
	expect := func(label string, consumed float64) {
		t.Helper()
		snapshots, err := inv.snapshots(context.Background(), []uuid.UUID{stock.ID})
		if err != nil {
			t.Fatal(err)
		}
		if got := snapshots[0].Consumed; got != consumed {
			t.Errorf("%s: consumed after the count = %v, want %v", label, got, consumed)
		}
	}
	expect("まだ始めていない", 15)
	// 未割当に戻しては、空いているドリッパーで始め直す
	for i, tc := range []struct {
		label    string
		press    *models.CaosPress
		consumed float64
	}{
		{"棚卸しの前に押して、後に届いた", press(counted.Add(-10*time.Second), now), 0},
		{"棚卸しの後に押した", press(counted.Add(10*time.Second), now), 15},
		{"未来", press(now.Add(3*time.Second), now.Add(3*time.Second)), 15},
		{"古い画面", nil, 15},
	} {
		if i > 0 {
			f.mustPut(t, write([]uuid.UUID{e}, f.emergencyState(t, e), toUnassigned))
		}
		w := write([]uuid.UUID{e}, unassigned, placed(i+1, uuid.New(), true))
		if tc.press == nil {
			f.mustPut(t, w)
		} else {
			f.putPressed(t, tc.press, w)
		}
		expect(tc.label, tc.consumed)
	}
}
