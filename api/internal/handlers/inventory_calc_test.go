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
		Resource:        models.StockResource{Kind: "item", PerServing: 15, NotifyFrom: 100, NotifyStep: 20, Buffer: 30},
		Tracked:         true,
		CountedQuantity: &counted,
		Received:        0,
		Consumed:        1650, // 残り 1350g = 90 回
	}
	if got := *s.RemainingServings(); got != 90 {
		t.Fatalf("remaining servings = %v", got)
	}
	if s.Level() != models.InventoryLevelWarning {
		t.Errorf("level = %v", s.Level())
	}
	s.Consumed = 2600 // 400g = 26.7 回
	if s.Level() != models.InventoryLevelCritical {
		t.Errorf("level = %v", s.Level())
	}
	if (stockSnapshot{}).Level() != models.InventoryLevelUntracked {
		t.Error("untracked")
	}
}

func TestValidateStockEvent(t *testing.T) {
	cases := []struct {
		kind     models.StockEventKind
		quantity float64
		ok       bool
	}{
		{models.StockEventKindCount, 0, true},
		{models.StockEventKindCount, 120, true},
		{models.StockEventKindCount, -1, false},
		{models.StockEventKindReceipt, 100, true},
		{models.StockEventKindReceipt, 0.5, true},
		{models.StockEventKindReceipt, 0, false},
		{models.StockEventKindReceipt, -100, false},
		{models.StockEventKindAdjust, -30, true},
		{models.StockEventKindAdjust, 30, true},
		{models.StockEventKindAdjust, 0, false},
		{models.StockEventKind("other"), 10, false},
	}
	for _, c := range cases {
		msg := validateStockEvent(c.kind, c.quantity)
		if (msg == "") != c.ok {
			t.Errorf("validateStockEvent(%q, %v) = %q, want ok=%v", c.kind, c.quantity, msg, c.ok)
		}
	}
}

func TestFormatQuantity(t *testing.T) {
	cases := map[float64]string{0: "0", 1500: "1500", 12.34: "12.3", -3: "-3", 0.05: "0.1"}
	for v, want := range cases {
		if got := formatQuantity(v); got != want {
			t.Errorf("formatQuantity(%v) = %q, want %q", v, got, want)
		}
	}
}

func TestFormatDuration(t *testing.T) {
	cases := []struct {
		d    time.Duration
		want string
	}{
		{0, "0分"},
		{59 * time.Minute, "59分"},
		{59*time.Minute + 31*time.Second, "1時間"}, // 分に丸めてから時間にする
		{90 * time.Minute, "1時間30分"},
		{9*time.Hour + 59*time.Minute, "9時間59分"},
		{10 * time.Hour, "10時間"},
		{10*time.Hour + 30*time.Minute, "10時間"}, // 10 時間を超えたら分は出さない
	}
	for _, c := range cases {
		if got := formatDuration(c.d); got != c.want {
			t.Errorf("formatDuration(%v) = %q, want %q", c.d, got, c.want)
		}
	}
}

// 豆 1000g・1 回 15g を数えた直後の在庫。consumed だけ消費した状態にする
func beanSnapshot(consumed float64, lastHour int) stockSnapshot {
	counted := 1000.0
	return stockSnapshot{
		Resource:         models.StockResource{Kind: "item", Name: "ブレンド豆", Unit: "g", PerServing: 15, NotifyFrom: 60, NotifyStep: 20, Buffer: 10},
		Tracked:          true,
		CountedQuantity:  &counted,
		Consumed:         consumed,
		ServingsLastHour: lastHour,
	}
}

func TestDescribeRemaining(t *testing.T) {
	cups := stockSnapshot{
		Resource: models.StockResource{Kind: "cup", Name: "カップ", Unit: "個", PerServing: 1},
		Tracked:  true,
		Received: 120.6,
	}
	cases := []struct {
		name string
		s    stockSnapshot
		want string
	}{
		{"untracked", stockSnapshot{Resource: models.StockResource{Kind: "item", PerServing: 15}}, "未計測"},
		// 回数は切り捨てる（66.6 回 → 66 回）
		{"bean", beanSnapshot(0, 0), "残り約66回分（1000g）"},
		{"bean fraction", beanSnapshot(0.5, 0), "残り約66回分（999.5g）"},
		{"cup", cups, "残り約120回分（120.6個）"},
	}
	for _, c := range cases {
		if got := describeRemaining(c.s); got != c.want {
			t.Errorf("%s: describeRemaining = %q, want %q", c.name, got, c.want)
		}
	}
}

func TestDescribePace(t *testing.T) {
	cases := []struct {
		name string
		s    stockSnapshot
		want string
	}{
		{"untracked", stockSnapshot{ServingsLastHour: 10}, ""},
		{"no orders in last hour", beanSnapshot(0, 0), ""},
		// 残り 30 回を 1 時間 20 回で使うと 1.5 時間
		{"pace", beanSnapshot(550, 20), "直近1時間 20回 → 約1時間30分で切れる見込み"},
		// 使い切ったあとは見込みを出さない
		{"empty", beanSnapshot(1000, 20), "直近1時間 20回"},
		{"over", beanSnapshot(1200, 20), "直近1時間 20回"},
	}
	for _, c := range cases {
		if got := describePace(c.s); got != c.want {
			t.Errorf("%s: describePace = %q, want %q", c.name, got, c.want)
		}
	}
}

func TestAlertMessage(t *testing.T) {
	counted := 3000.0
	kenya := stockSnapshot{
		Resource:         models.StockResource{Kind: "item", Item: &models.Item{Name: "ケニア"}, Unit: "g", PerServing: 15, NotifyFrom: 100, NotifyStep: 20, Buffer: 30},
		Tracked:          true,
		CountedQuantity:  &counted,
		Consumed:         1800, // 残り 1200g = 80 回
		ServingsLastHour: 12,
	}
	if got, want := alertMessage(kenya), "⚠️ *ケニア* 残り約80回分（1200g）\n　直近1時間 12回 → 約6時間40分で切れる見込み"; got != want {
		t.Errorf("got  %q\nwant %q", got, want)
	}

	cups := 90.0
	cup := stockSnapshot{
		Resource:        models.StockResource{Kind: "cup", Name: "アイスカップ", Unit: "個", PerServing: 1, NotifyFrom: 500, NotifyStep: 100, Buffer: 100},
		Tracked:         true,
		CountedQuantity: &cups,
	}
	if got, want := alertMessage(cup), "🚨 *アイスカップ* 残り約90回分（90個）（バッファ100回を切りました）"; got != want {
		t.Errorf("got  %q\nwant %q", got, want)
	}
}

func TestRemindMessage(t *testing.T) {
	now := time.Date(2026, 11, 3, 13, 0, 0, 0, time.UTC)
	countedAt := now.Add(-80 * time.Minute)
	counted := 1200.0
	receivedAt := now.Add(-time.Hour)
	snapshots := []stockSnapshot{
		{
			Resource:        models.StockResource{Kind: "item", Item: &models.Item{Name: "ケニア"}, Unit: "g", PerServing: 15},
			Tracked:         true,
			BaseAt:          &countedAt,
			CountedQuantity: &counted,
		},
		// 入荷だけで棚卸しをしていないもの
		{Resource: models.StockResource{Kind: "cup", Name: "アイスカップ", Unit: "個", PerServing: 1}, Tracked: true, BaseAt: &receivedAt, Received: 300},
		{Resource: models.StockResource{Kind: "cup", Name: "ホットカップ", Unit: "個", PerServing: 1}},
	}
	want := "⏰ 在庫の残量確認の時間です。数えて POS の在庫ページに入力してください。\n" +
		"• ケニア: 残り約80回分（1200g）（最終確認 1時間20分前）\n" +
		"• アイスカップ: 残り約300回分（300個）（最終確認 未実施）\n" +
		"• ホットカップ: 未計測（最終確認 未実施）\n" +
		"<https://pos.example.com/inventory|在庫ページを開く>"
	if got := remindMessage(snapshots, now, "https://pos.example.com/"); got != want {
		t.Errorf("got  %q\nwant %q", got, want)
	}

	// POS の URL が無ければリンクを付けない
	if got := remindMessage(nil, now, ""); got != "⏰ 在庫の残量確認の時間です。数えて POS の在庫ページに入力してください。" {
		t.Errorf("without url: %q", got)
	}
}
