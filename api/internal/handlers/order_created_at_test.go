package handlers

import (
	"net/http"
	"testing"
	"time"

	"cafeore-pos/api/internal/models"
)

// 注文の時刻：レジが確定した時刻（created_at）があればそれ、無ければサーバーの今。
// 未来は今に丸め、12 時間より前は断る
func TestOrderCreatedAt(t *testing.T) {
	now := time.Date(2026, 11, 1, 14, 0, 0, 0, time.UTC)
	at := func(d time.Duration) *time.Time { v := now.Add(d); return &v }
	for _, tc := range []struct {
		name      string
		requested *time.Time
		want      time.Time
		wantErr   bool
	}{
		{name: "省略はサーバーの今", requested: nil, want: now},
		{name: "オフラインで溜めた注文はその時刻", requested: at(-40 * time.Minute), want: now.Add(-40 * time.Minute)},
		{name: "ちょうど 12 時間前は受け付ける", requested: at(-12 * time.Hour), want: now.Add(-12 * time.Hour)},
		{name: "端末の時計が進んでいたら今", requested: at(3 * time.Second), want: now},
		{name: "12 時間より前は断る", requested: at(-12*time.Hour - time.Second), wantErr: true},
	} {
		got, err := orderCreatedAt(tc.requested, now)
		if (err != nil) != tc.wantErr {
			t.Fatalf("%s: err = %v, wantErr %v", tc.name, err, tc.wantErr)
		}
		if err == nil && !got.Equal(tc.want) {
			t.Errorf("%s: got %v, want %v", tc.name, got, tc.want)
		}
	}
}

func TestCreateOrderKeepsCashierCreatedAt(t *testing.T) {
	e := newOrderDBEnv(t)
	r := e.orderAPI()
	blend := e.item("ブレンド", e.itemType("hot"))
	coffee := e.menu("coffee", models.MenuItem{ItemID: blend.ID, Quantity: 1})

	// オフラインで 30 分前に確定した注文を、つながってから送る。コメントも同じ時刻
	confirmed := time.Now().Add(-30 * time.Minute).Truncate(time.Millisecond)
	comments := []models.CommentCreateRequest{{Author: "cashier", Text: "氷少なめ"}}
	resp := e.sendOrder(r, http.MethodPost, "/api/orders", models.OrderCreateRequest{
		OrderId: 7, BillingAmount: 500, Received: 500, MenuIds: menuLines(coffee), Comments: &comments, CreatedAt: &confirmed,
	}, http.StatusCreated)
	if !resp.CreatedAt.Equal(confirmed) {
		t.Fatalf("created_at = %v, want the cashier's %v", resp.CreatedAt, confirmed)
	}
	if resp.Comments == nil || len(*resp.Comments) != 1 || !(*resp.Comments)[0].CreatedAt.Equal(confirmed) {
		t.Fatalf("comments = %+v, want created at %v", resp.Comments, confirmed)
	}

	// 古すぎる時刻は 400（作らない）
	old := time.Now().Add(-13 * time.Hour)
	e.sendOrder(r, http.MethodPost, "/api/orders", models.OrderCreateRequest{
		OrderId: 8, BillingAmount: 500, Received: 500, MenuIds: menuLines(coffee), CreatedAt: &old,
	}, http.StatusBadRequest)
}
