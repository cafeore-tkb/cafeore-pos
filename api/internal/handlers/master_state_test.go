package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func serveMasterStatus(handle gin.HandlerFunc, method, body string) *httptest.ResponseRecorder {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(method, "/api/master-status", strings.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	handle(c)
	return w
}

func newDryRunDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(postgres.New(postgres.Config{DSN: "host=localhost dbname=unused", PreferSimpleProtocol: true}), &gorm.Config{DryRun: true, DisableAutomaticPing: true, SkipDefaultTransaction: true})
	if err != nil {
		t.Fatal(err)
	}
	return db
}

// 画面は古い順に並んでいる前提で反転して表示するので、並び順を DB 任せにしない
func TestGetMasterStatusOrdersByCreatedAtAsc(t *testing.T) {
	db := newDryRunDB(t)
	var sql string
	if err := db.Callback().Query().After("gorm:query").Register("test:sql", func(tx *gorm.DB) {
		sql = tx.Statement.SQL.String()
	}); err != nil {
		t.Fatal(err)
	}

	if w := serveMasterStatus(NewMasterStateHandler(db, nil).GetMasterStatus, http.MethodGet, ""); w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}
	if !strings.Contains(sql, "ORDER BY created_at ASC") {
		t.Fatalf("must order by created_at ASC: %s", sql)
	}
}

func TestUpdateMasterStatusRejectsUnknownType(t *testing.T) {
	// 検証で弾くので DB には触らない
	h := NewMasterStateHandler(nil, nil)
	for _, body := range []string{`{"type":"paused"}`, `{"type":""}`, `{}`} {
		if w := serveMasterStatus(h.UpdateMasterStatus, http.MethodPost, body); w.Code != http.StatusBadRequest {
			t.Errorf("%s: status = %d, want 400", body, w.Code)
		}
	}
}

// POST の応答も GET・WebSocket と同じ snake_case のキーで返し、master_state を配信する
func TestUpdateMasterStatusRespondsAndBroadcasts(t *testing.T) {
	hub := NewHub()
	h := NewMasterStateHandler(newDryRunDB(t), hub)
	w := serveMasterStatus(h.UpdateMasterStatus, http.MethodPost, `{"type":"stop"}`)

	if w.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201", w.Code)
	}
	var got map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got["type"] != "stop" || got["created_at"] == nil {
		t.Fatalf("unexpected response: %s", w.Body)
	}
	if msg := <-hub.broadcast; msg.Type != WSMessageTypeMasterState {
		t.Fatalf("must broadcast master_state: %+v", msg)
	}
}
