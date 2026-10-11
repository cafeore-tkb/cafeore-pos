package handlers

import (
	"net/http"
	"testing"
	"time"

	"cafeore-pos/api/internal/models"
)

// 注文の時刻：レジが確定した時刻（created_at）があればそれ、無ければサーバーの今。
// 未来は今に丸め、古い時刻もそのまま受け付ける（レジに残った注文がいつまでも送れなくならないように）
func TestOrderCreatedAt(t *testing.T) {
	now := time.Date(2026, 11, 1, 14, 0, 0, 0, time.UTC)
	at := func(d time.Duration) *time.Time { v := now.Add(d); return &v }
	for _, tc := range []struct {
		name      string
		requested *time.Time
		want      time.Time
	}{
		{name: "省略はサーバーの今", requested: nil, want: now},
		{name: "オフラインで溜めた注文はその時刻", requested: at(-40 * time.Minute), want: now.Add(-40 * time.Minute)},
		{name: "前の日に溜めた注文もその時刻", requested: at(-20 * time.Hour), want: now.Add(-20 * time.Hour)},
		{name: "端末の時計が進んでいたら今", requested: at(3 * time.Second), want: now},
	} {
		if got := orderCreatedAt(tc.requested, now); !got.Equal(tc.want) {
			t.Errorf("%s: got %v, want %v", tc.name, got, tc.want)
		}
	}
}

func TestCreateOrderKeepsCashierCreatedAt(t *testing.T) {
	e := newOrderDBEnv(t)
	r := e.orderAPI()
	blend := e.item("ブレンド", e.itemType("hot"))
	coffee := e.menu("coffee", models.MenuItem{ItemID: blend.ID, Quantity: 1})

	// オフラインで 30 分前に確定した注文を、つながってから送る。コメントも同じ時刻から（2 件目以降は主キーが重ならないよう 1 マイクロ秒ずつ後）
	confirmed := time.Now().Add(-30 * time.Minute).Truncate(time.Millisecond)
	comments := []models.CommentCreateRequest{{Author: "cashier", Text: "氷少なめ"}, {Author: "cashier", Text: "持ち帰り"}}
	resp := e.sendOrder(r, http.MethodPost, "/api/orders", models.OrderCreateRequest{
		OrderId: 7, BillingAmount: 500, Received: 500, MenuIds: menuLines(coffee), Comments: &comments, CreatedAt: &confirmed,
	}, http.StatusCreated)
	if !resp.CreatedAt.Equal(confirmed) {
		t.Fatalf("created_at = %v, want the cashier's %v", resp.CreatedAt, confirmed)
	}
	if resp.Comments == nil || len(*resp.Comments) != 2 {
		t.Fatalf("comments = %+v, want 2", resp.Comments)
	}
	got := map[string]time.Time{}
	for _, c := range *resp.Comments {
		got[c.Text] = c.CreatedAt
	}
	if !got["氷少なめ"].Equal(confirmed) || !got["持ち帰り"].Equal(confirmed.Add(time.Microsecond)) {
		t.Fatalf("comment times = %v, want %v and 1µs later", got, confirmed)
	}

	// 前の日に溜めた注文も、確定した時刻のまま作る
	yesterday := time.Now().Add(-20 * time.Hour).Truncate(time.Millisecond)
	resp = e.sendOrder(r, http.MethodPost, "/api/orders", models.OrderCreateRequest{
		OrderId: 8, BillingAmount: 500, Received: 500, MenuIds: menuLines(coffee), CreatedAt: &yesterday,
	}, http.StatusCreated)
	if !resp.CreatedAt.Equal(yesterday) {
		t.Fatalf("created_at = %v, want %v", resp.CreatedAt, yesterday)
	}
}
