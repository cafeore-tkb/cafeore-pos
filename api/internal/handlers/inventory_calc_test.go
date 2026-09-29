package handlers

import (
	"testing"
	"time"

	"cafeore-pos/api/internal/models"
)

func intPtr(v int) *int { return &v }

func TestAlertThreshold(t *testing.T) {
	cases := []struct {
		remaining float64
		want      *int
	}{
		{520, nil},
		{500.5, nil},
		{500, intPtr(500)},
		{450, intPtr(500)},
		{400, intPtr(400)},
		{399, intPtr(400)},
		{100, intPtr(100)},
		{12, intPtr(100)},
		{0, intPtr(0)},
		{-3, intPtr(0)},
	}
	for _, c := range cases {
		got := alertThreshold(c.remaining, 500, 100)
		if (got == nil) != (c.want == nil) || (got != nil && *got != *c.want) {
			t.Errorf("alertThreshold(%v) = %v, want %v", c.remaining, deref(got), deref(c.want))
		}
	}

	// step が 0 なら from と 0 だけ
	if got := alertThreshold(120, 150, 0); got == nil || *got != 150 {
		t.Errorf("step 0: got %v", deref(got))
	}
}

func deref(p *int) any {
	if p == nil {
		return nil
	}
	return *p
}

func TestNextAlertState(t *testing.T) {
	cases := []struct {
		name          string
		last, next    *int
		notify, reset bool
	}{
		{"まだ余裕がある", nil, nil, false, false},
		{"初めて切った", nil, intPtr(500), true, false},
		{"同じ閾値のまま", intPtr(500), intPtr(500), false, false},
		{"次の閾値を切った", intPtr(500), intPtr(400), true, false},
		{"入荷で戻った", intPtr(200), intPtr(500), false, true},
		{"入荷で余裕が出た", intPtr(200), nil, false, true},
	}
	for _, c := range cases {
		notify, reset := nextAlertState(c.last, c.next)
		if notify != c.notify || reset != c.reset {
			t.Errorf("%s: got (%v, %v), want (%v, %v)", c.name, notify, reset, c.notify, c.reset)
		}
	}
}

func TestStockBaseline(t *testing.T) {
	t0 := time.Date(2026, 11, 1, 10, 0, 0, 0, time.UTC)
	ev := func(kind models.StockEventKind, q float64, h int) models.StockEvent {
		return models.StockEvent{Kind: string(kind), Quantity: q, CreatedAt: t0.Add(time.Duration(h) * time.Hour)}
	}

	if at, counted, received := stockBaseline(nil); at != nil || counted != nil || received != 0 {
		t.Errorf("empty: got %v %v %v", at, counted, received)
	}

	// 棚卸しが無ければ最初の入荷から
	at, counted, received := stockBaseline([]models.StockEvent{
		ev(models.StockEventKindReceipt, 1000, 0),
		ev(models.StockEventKindReceipt, 500, 1),
	})
	if !at.Equal(t0) || counted != nil || received != 1500 {
		t.Errorf("receipts only: got %v %v %v", at, counted, received)
	}

	// 最後の棚卸しより前は捨てる
	at, counted, received = stockBaseline([]models.StockEvent{
		ev(models.StockEventKindReceipt, 1000, 0),
		ev(models.StockEventKindCount, 800, 2),
		ev(models.StockEventKindReceipt, 1000, 3),
		ev(models.StockEventKindCount, 1600, 4),
		ev(models.StockEventKindAdjust, -20, 5),
	})
	if !at.Equal(t0.Add(4*time.Hour)) || counted == nil || *counted != 1600 || received != -20 {
		t.Errorf("counts: got %v %v %v", at, deref2(counted), received)
	}
}

func deref2(p *float64) any {
	if p == nil {
		return nil
	}
	return *p
}

func TestSnapshotLevel(t *testing.T) {
	counted := 3000.0
	s := stockSnapshot{
		Resource:        models.StockResource{Kind: "bean", PerServing: 15, NotifyFrom: 100, NotifyStep: 20, Buffer: 30},
		Tracked:         true,
		CountedQuantity: &counted,
		Received:        0,
		Consumed:        1650, // 残り 1350g = 90 杯
	}
	if got := *s.RemainingServings(); got != 90 {
		t.Fatalf("remaining servings = %v", got)
	}
	if s.Level() != models.InventoryLevelWarning {
		t.Errorf("level = %v", s.Level())
	}
	s.Consumed = 2600 // 400g = 26.7 杯
	if s.Level() != models.InventoryLevelCritical {
		t.Errorf("level = %v", s.Level())
	}
	if (stockSnapshot{}).Level() != models.InventoryLevelUntracked {
		t.Error("untracked")
	}
}
