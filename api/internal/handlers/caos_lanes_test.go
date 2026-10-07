package handlers

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"cafeore-pos/api/internal/caos"
)

// 列の担当者は、カードと同じ {"type":"drips"} のメッセージで配る（つないだ直後と、変わるたび）。
// 交代・入れ替え・1つ戻すは POST /api/caos/ops で、ほかの画面にもそのまま届く。
func TestCaosLanesThroughHTTPAndWS(t *testing.T) {
	e := newCaosEnv(t)
	srv := httptest.NewServer(e.router)
	defer srv.Close()
	conn, resp, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(srv.URL, "http")+"/api/ws/orders", nil)
	mustDo(t, err)
	defer func() { _ = conn.Close() }()
	if resp.Body != nil {
		_ = resp.Body.Close()
	}
	nextLanes := func() []caos.Lane {
		t.Helper()
		mustDo(t, conn.SetReadDeadline(time.Now().Add(5*time.Second)))
		for {
			var msg WSMessage
			mustDo(t, conn.ReadJSON(&msg))
			if msg.Type == WSMessageTypeDrips {
				return msg.Lanes
			}
		}
	}
	// カードが 0 枚でも、つないだ直後に 6 列の担当者が届く
	if l := nextLanes(); len(l) != 6 || l[0].Name != "" || l[0].UpdatedAt != nil {
		t.Fatalf("つないだ直後に 6 列が届く：%+v", l)
	}

	var set caos.Result
	if code := e.op(t, map[string]any{"name": "set_lane", "dripper": 2, "person": "山田", "senior": true}, &set); code != http.StatusOK {
		t.Fatalf("交代：%d", code)
	}
	if len(set.Lanes) != 1 || set.Lanes[0].Name != "山田" || !set.Lanes[0].Senior || set.OpID == "" {
		t.Fatalf("交代の結果：%+v", set)
	}
	if l := nextLanes(); l[1].Name != "山田" || !l[1].Senior {
		t.Fatalf("交代がほかの画面に届く：%+v", l)
	}

	if code := e.op(t, map[string]any{"name": "swap_lanes", "dripper": 2, "other_dripper": 5}, nil); code != http.StatusOK {
		t.Fatalf("入れ替え：%d", code)
	}
	if l := nextLanes(); l[1].Name != "" || l[4].Name != "山田" || !l[4].Senior {
		t.Fatalf("入れ替えが届く：%+v", l)
	}
	if code := e.op(t, map[string]any{"name": "swap_lanes", "dripper": 2, "other_dripper": 2}, nil); code != http.StatusUnprocessableEntity {
		t.Fatalf("同じ列どうしは 422：%d", code)
	}

	if code := e.op(t, map[string]any{"name": "undo", "op_id": set.OpID}, nil); code != http.StatusUnprocessableEntity {
		t.Fatalf("あとで入れ替えた列の交代は戻せない（422）：%d", code)
	}
}
