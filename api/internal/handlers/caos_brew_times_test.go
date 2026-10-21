package handlers

import (
	"encoding/json"
	"net/http"
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"

	"cafeore-pos/api/internal/models"
)

func TestCaosBrewTimesOnDB(t *testing.T) {
	db := openCaosTestDB(t)
	f := newCaosFixture(t, db)
	brewTimes := func() []models.CaosBrewTime {
		t.Helper()
		w := callWithParams(t, f.caos.GetCaosBrewTimes, http.MethodGet, "", nil)
		if w.Code != http.StatusOK {
			t.Fatalf("GET /api/caos/brew-times = %d: %s", w.Code, w.Body.String())
		}
		var got []models.CaosBrewTime
		if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
			t.Fatal(err)
		}
		return got
	}

	// カード（同じ drip_id のカップ）を、finishedAt に終えた sec 秒の抽出にする。finished が false なら抽出中のまま
	base := time.Now().Add(-time.Hour)
	no := 0
	card := func(cups int, sec int, finishedAt time.Time, finished bool) {
		t.Helper()
		no++
		items := make([]models.Item, cups)
		for i := range items {
			items[i] = f.blend
		}
		order := f.createOrder(t, no, line(items...))
		dripper, pos, id := 1, no, uuid.New()
		started := finishedAt.Add(-time.Duration(sec) * time.Second)
		updates := caosUpdates(models.CaosCupAfter{Dripper: &dripper, DripId: &id}, &pos, &started)
		if finished {
			updates["brew_finished_at"] = finishedAt
		}
		if err := db.Model(&models.OrderCup{}).Where("id IN ?", ids(order.OrderCups...)).Updates(updates).Error; err != nil {
			t.Fatal(err)
		}
	}

	// 終えたカードが caosBrewTimeMinCards 枚に足りない杯数は返さない（抽出中のカードは数えない）
	for i, sec := range []int{120, 200, 2, 150} {
		card(1, sec, base.Add(time.Duration(i)*time.Minute), true)
	}
	card(1, 999, base.Add(5*time.Minute), false)
	if got := brewTimes(); len(got) != 0 {
		t.Fatalf("brew times with 4 cards = %+v, want []", got)
	}
	// 1 杯：中央値（2・120・150・200・210 → 150。押し間違えてすぐ終えたカードがあっても狂わない）
	card(1, 210, base.Add(4*time.Minute), true)
	// 2 杯：偶数なら真ん中の 2 つの平均（180・200・220・240・250・260 → 230）
	for i, sec := range []int{180, 240, 200, 260, 220, 250} {
		card(2, sec, base.Add(time.Duration(i)*time.Minute), true)
	}
	want := []models.CaosBrewTime{{Cups: 1, Sec: 150, Samples: 5}, {Cups: 2, Sec: 230, Samples: 6}}
	if got := brewTimes(); !slices.Equal(got, want) {
		t.Fatalf("brew times = %+v, want %+v", got, want)
	}

	// 終えたのが新しいカードから caosBrewTimeCards 枚だけを使う（古い遅いカードは数えない）
	for i := range caosBrewTimeCards {
		card(1, 100, base.Add(time.Duration(10+i)*time.Minute), true)
	}
	want[0] = models.CaosBrewTime{Cups: 1, Sec: 100, Samples: caosBrewTimeCards}
	if got := brewTimes(); !slices.Equal(got, want) {
		t.Fatalf("brew times = %+v, want %+v", got, want)
	}

	// 淹れ直しのカードも数える（淹れ直しの行の時刻）
	order := f.createOrder(t, 99, line(f.blend))
	for i := range caosBrewTimeCards {
		if code, body := f.addEmergencies(t, order.OrderCups[0].ID); code != http.StatusCreated {
			t.Fatalf("add emergency = %d: %s", code, body)
		}
		e := f.emergencies(t, order.OrderCups[0].ID)[i]
		finished := base.Add(time.Duration(100+i) * time.Minute)
		started := finished.Add(-90 * time.Second)
		dripper, pos, id := 2, i+1, uuid.New()
		updates := caosUpdates(models.CaosCupAfter{Dripper: &dripper, DripId: &id}, &pos, &started)
		updates["brew_finished_at"] = finished
		if err := db.Model(&models.CupEmergency{}).Where("id = ?", e.ID).Updates(updates).Error; err != nil {
			t.Fatal(err)
		}
	}
	want[0] = models.CaosBrewTime{Cups: 1, Sec: 90, Samples: caosBrewTimeCards}
	if got := brewTimes(); !slices.Equal(got, want) {
		t.Fatalf("brew times with emergencies = %+v, want %+v", got, want)
	}
}
