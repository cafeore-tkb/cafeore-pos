package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"

	"cafeore-pos/api/internal/models"
)

// 画面は古い順に並んでいる前提で反転して表示するので、並び順を DB 任せにしない
func TestFindMasterStatesOrdersByCreatedAtAsc(t *testing.T) {
	db, err := gorm.Open(postgres.New(postgres.Config{DSN: "host=localhost dbname=unused", PreferSimpleProtocol: true}), &gorm.Config{DryRun: true, DisableAutomaticPing: true, SkipDefaultTransaction: true})
	if err != nil {
		t.Fatal(err)
	}
	var sql string
	if err := db.Callback().Query().After("gorm:query").Register("test:sql", func(tx *gorm.DB) {
		sql = tx.Statement.SQL.String()
	}); err != nil {
		t.Fatal(err)
	}

	if _, err := findMasterStates(db); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(sql, "ORDER BY created_at ASC") {
		t.Fatalf("must order by created_at ASC: %s", sql)
	}
}

func TestUpdateMasterStatusRejectsUnknownType(t *testing.T) {
	gin.SetMode(gin.TestMode)
	// 検証で弾くので DB には触らない
	h := NewMasterStateHandler(nil, nil)

	for _, body := range []string{`{"type":"paused"}`, `{"type":""}`, `{}`} {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Request = httptest.NewRequest(http.MethodPost, "/api/master-status", strings.NewReader(body))
		c.Request.Header.Set("Content-Type", "application/json")

		h.UpdateMasterStatus(c)

		if w.Code != http.StatusBadRequest {
			t.Errorf("%s: status = %d, want 400", body, w.Code)
		}
	}
}

// POST の応答も GET・WebSocket と同じ snake_case のキーで返す
func TestMasterStateResponseJSON(t *testing.T) {
	state := models.MasterState{Type: "stop", CreatedAt: time.Date(2026, 10, 8, 12, 0, 0, 0, time.UTC)}
	data, err := json.Marshal(toMasterStateResponse(&state))
	if err != nil {
		t.Fatal(err)
	}
	var got map[string]any
	if err := json.Unmarshal(data, &got); err != nil {
		t.Fatal(err)
	}
	if got["type"] != "stop" || got["created_at"] != "2026-10-08T12:00:00Z" {
		t.Fatalf("unexpected response: %s", data)
	}
}
