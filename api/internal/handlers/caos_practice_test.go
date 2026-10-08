package handlers

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"cafeore-pos/api/internal/caos"
)

// 練習用の盤面を HTTP で通す。本番の盤面（caos_drips・caos_ops・caos_lanes）と注文には何も入らず、
// 本番の WebSocket にも配らないことを確かめる。
func TestCaosPracticeThroughHTTP(t *testing.T) {
	e := newCaosEnv(t)
	srv := httptest.NewServer(e.router)
	defer srv.Close()
	conn, resp, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(srv.URL, "http")+"/api/ws/orders", nil)
	mustDo(t, err)
	defer func() { _ = conn.Close() }()
	if resp.Body != nil {
		_ = resp.Body.Close()
	}
	// 届いたメッセージを数える（つないだ直後の初期データが落ち着いてから練習を始める）
	var mu sync.Mutex
	received := 0
	go func() {
		for {
			var msg WSMessage
			if err := conn.ReadJSON(&msg); err != nil {
				return
			}
			mu.Lock()
			received++
			mu.Unlock()
		}
	}()
	count := func() int {
		mu.Lock()
		defer mu.Unlock()
		return received
	}
	time.Sleep(300 * time.Millisecond)
	initial := count()

	start := time.Date(2025, 11, 2, 1, 0, 0, 0, time.UTC)
	in := map[string]any{
		"starts_at": start, "ends_at": start.Add(30 * time.Minute),
		"orders": []map[string]any{
			{"order_no": 7, "created_at": start.Add(time.Minute), "billing_amount": 800, "lines": []map[string]any{
				{"item_key": "01_yukari_brend", "name": "縁ブレンド", "type": "hot", "price": 400, "quantity": 2},
			}},
		},
		"lanes": []map[string]any{{"dripper": 1, "name": "山田", "senior": true}},
	}
	var state caos.PracticeState
	if code := e.call(t, http.MethodPost, "/api/caos/practice", in, &state); code != http.StatusCreated {
		t.Fatalf("練習を始める：%d", code)
	}
	if state.ID == "" || state.TotalOrders != 1 || len(state.Orders) != 0 || state.NextArrivalAt == nil || state.Lanes[0].Name != "山田" {
		t.Fatalf("始めの盤面：%+v", state)
	}
	base := "/api/caos/practice/" + state.ID
	if code := e.call(t, http.MethodPost, base+"/advance", map[string]any{"at": start.Add(2 * time.Minute)}, &state); code != http.StatusOK {
		t.Fatalf("進める：%d", code)
	}
	if len(state.Orders) != 1 || len(state.Drips) != 1 || state.Drips[0].Cups != 2 || len(state.Items) != 1 || state.Drips[0].Lines[0].ItemID != state.Items[0].ID {
		t.Fatalf("注文が届いてカードができる：%+v", state)
	}
	var res struct {
		OpID  string             `json:"op_id"`
		State caos.PracticeState `json:"state"`
	}
	if code := e.call(t, http.MethodPost, base+"/ops", map[string]any{"at": start.Add(3 * time.Minute), "op": map[string]any{"name": "assign", "drip_id": state.Drips[0].ID, "dripper": 1}}, &res); code != http.StatusOK {
		t.Fatalf("割当：%d", code)
	}
	if res.OpID == "" || res.State.Drips[0].Status != caos.StatusBrewing {
		t.Fatalf("割当でそのまま抽出中：%+v", res)
	}
	if code := e.call(t, http.MethodPost, base+"/ops", map[string]any{"at": start.Add(6 * time.Minute), "op": map[string]any{"name": "next", "dripper": 1}}, &res); code != http.StatusOK {
		t.Fatalf("次へ：%d", code)
	}
	if res.State.Orders[0].ReadyAt == nil || !res.State.Orders[0].ReadyAt.Equal(start.Add(6*time.Minute)) {
		t.Fatalf("練習の注文が練習の時刻で準備完了：%+v", res.State.Orders)
	}
	if code := e.call(t, http.MethodPost, base+"/ops", map[string]any{"at": start.Add(6 * time.Minute), "op": map[string]any{"name": "next", "dripper": 1}}, nil); code != http.StatusUnprocessableEntity {
		t.Fatalf("ルールに合わない操作は 422：%d", code)
	}
	// 練習の緊急の入れ直しは、印刷キューに積まない
	if code := e.call(t, http.MethodPost, base+"/ops", map[string]any{"at": start.Add(7 * time.Minute), "op": map[string]any{"name": "rebrew", "source_id": state.Drips[0].ID, "cups": 1, "dripper": 1}}, &res); code != http.StatusOK {
		t.Fatalf("入れ直し：%d", code)
	}

	// 本番の盤面と注文と印刷キューには何も入らない
	for _, table := range []string{"caos_drips", "caos_ops", "caos_lanes", "orders", "print_jobs"} {
		var n int64
		mustDo(t, e.db.Table(table).Count(&n).Error)
		if n != 0 {
			t.Fatalf("練習で本番の %s に行ができた：%d", table, n)
		}
	}
	// 本番の WebSocket には何も届かない
	time.Sleep(300 * time.Millisecond)
	if n := count(); n != initial {
		t.Fatalf("練習の盤面を本番の WebSocket に配った：%d 件（初期データ %d 件のあと）", n-initial, initial)
	}

	var got caos.PracticeState
	if code := e.call(t, http.MethodGet, base, nil, &got); code != http.StatusOK || got.Version != res.State.Version {
		t.Fatalf("読む：%d %+v", code, got)
	}
	if code := e.call(t, http.MethodDelete, base, nil, nil); code != http.StatusNoContent {
		t.Fatalf("消す：%d", code)
	}
	if code := e.call(t, http.MethodGet, base, nil, nil); code != http.StatusNotFound {
		t.Fatalf("消したあとは 404：%d", code)
	}
	if code := e.call(t, http.MethodGet, "/api/caos/practice/not-a-uuid", nil, nil); code != http.StatusNotFound {
		t.Fatalf("ID が違えば 404：%d", code)
	}
	if code := e.call(t, http.MethodPost, "/api/caos/practice", map[string]any{"starts_at": start, "ends_at": start}, nil); code != http.StatusUnprocessableEntity {
		t.Fatalf("時間帯が正しくなければ 422：%d", code)
	}
}
