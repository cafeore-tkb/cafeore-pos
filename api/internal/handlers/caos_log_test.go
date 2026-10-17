package handlers

import (
	"bytes"
	"cafeore-pos/api/internal/models"
	"encoding/json"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func readOperationCups(t *testing.T, db *gorm.DB, operationID uuid.UUID) map[uuid.UUID]models.CaosOperationCup {
	t.Helper()
	var rows []models.CaosOperationCup
	if err := db.Where("operation_id = ?", operationID).Find(&rows).Error; err != nil {
		t.Fatal(err)
	}
	result := map[uuid.UUID]models.CaosOperationCup{}
	for _, row := range rows {
		result[row.UnitID] = row
	}
	return result
}
func latestOperation(t *testing.T, db *gorm.DB) models.CaosOperation {
	t.Helper()
	var operation models.CaosOperation
	if err := db.Order("recorded_at DESC").First(&operation).Error; err != nil {
		t.Fatal(err)
	}
	return operation
}
func TestCaosOperationLogOnDB(t *testing.T) {
	db := openCaosTestDB(t)
	f := newCaosFixture(t, db)
	start, _ := caosToday(time.Now())
	now := start.Add(12 * time.Hour)
	f.caos.now = func() time.Time { return now }
	source := f.createOrderAt(t, 1, start.Add(time.Hour), line(f.blend))
	target := f.createOrderAt(t, 2, start.Add(time.Hour), line(f.blend))
	waiting := f.createOrderAt(t, 3, start.Add(time.Hour), line(f.blend))
	ready := f.createOrderAt(t, 4, start.Add(time.Hour), line(f.blend))
	milk := f.createOrderAt(t, 5, start.Add(time.Hour), line(f.milk))
	yesterday := f.createOrderAt(t, 6, start.Add(-time.Hour), line(f.blend))
	readyAt := now.Add(-time.Minute)
	if err := db.Model(&models.OrderCup{}).Where("id = ?", ready.OrderCups[0].ID).Update("ready_at", readyAt).Error; err != nil {
		t.Fatal(err)
	}
	a, b := source.OrderCups[0].ID, target.OrderCups[0].ID
	drip := uuid.New()
	pressed := now.Add(-30 * time.Second)
	f.putPressed(t, press(pressed, now), write([]uuid.UUID{b}, unassigned, placed(1, drip, true)))
	assignment := latestOperation(t, db)
	rows := readOperationCups(t, db, assignment.ID)
	row := rows[b]
	if row.AssignedAt == nil || !row.AssignedAt.Equal(pressed) || row.MergedAt != nil || row.OrderID != target.ID || !row.Changed {
		t.Fatalf("assignment = %+v", row)
	}
	if !assignment.OccurredAt.Equal(pressed) || !assignment.RecordedAt.Equal(now) {
		t.Fatalf("times = %+v", assignment)
	}
	if !rows[waiting.OrderCups[0].ID].InWindow || !rows[a].InWindow {
		t.Fatal("not-ready cups missing from window")
	}
	for _, order := range []models.Order{ready, milk, yesterday} {
		if _, exists := rows[order.OrderCups[0].ID]; exists {
			t.Fatalf("unexpected context: %v", order.OrderId)
		}
	}
	// 抽出開始は引き継ぎ、統合時刻は別に残す。
	now = now.Add(time.Minute)
	mergedAt := now.Add(-10 * time.Second)
	merge := write([]uuid.UUID{a}, unassigned, placed(1, drip, false))
	merge["merge_into"] = b
	f.putPressed(t, press(mergedAt, now), merge)
	merged := latestOperation(t, db)
	rows = readOperationCups(t, db, merged.ID)
	row = rows[a]
	if row.MergedAt == nil || !row.MergedAt.Equal(mergedAt) || row.AssignedAt == nil || !row.AssignedAt.Equal(mergedAt) ||
		row.MergeTargetOrderID == nil || *row.MergeTargetOrderID != target.ID || row.MergeTargetCupID == nil || *row.MergeTargetCupID != b ||
		row.OrderID != source.ID || row.AfterBrewStartedAt == nil || !row.AfterBrewStartedAt.Equal(pressed) {
		t.Fatalf("merge = %+v", row)
	}
	if rows[b].MergedAt == nil || rows[b].AssignedAt != nil {
		t.Fatalf("target = %+v", rows[b])
	}
	if old := readOperationCups(t, db, assignment.ID)[b]; old.AssignedAt == nil || !old.AssignedAt.Equal(pressed) {
		t.Fatal("old assignment changed")
	}
	if code, _ := f.put(t, merge); code != http.StatusConflict {
		t.Fatalf("retry = %d", code)
	}
	var count int64
	db.Model(&models.CaosOperation{}).Count(&count)
	if count != 2 {
		t.Fatalf("operations = %d", count)
	}
	now = now.Add(time.Minute)
	if code := f.nextPressed(t, 1, &drip, press(now, now)); code != http.StatusNoContent {
		t.Fatalf("next = %d", code)
	}
	finished := latestOperation(t, db)
	if finished.Kind != "next" {
		t.Fatalf("next kind = %s", finished.Kind)
	}
	for _, id := range []uuid.UUID{a, b} {
		r := readOperationCups(t, db, finished.ID)[id]
		if !r.Changed || r.AfterBrewFinishedAt == nil || r.MergedAt != nil || r.AssignedAt != nil {
			t.Fatalf("next row = %+v", r)
		}
	}
}
func TestCaosMergeUnassignedLogOnDB(t *testing.T) {
	db := openCaosTestDB(t)
	f := newCaosFixture(t, db)
	a := f.createOrder(t, 1, line(f.blend)).OrderCups[0].ID
	b := f.createOrder(t, 2, line(f.blend)).OrderCups[0].ID
	drip := uuid.New()
	after := map[string]any{"dripper": nil, "drip_id": drip, "insert_before": nil, "start_brew": false}
	w := write([]uuid.UUID{a}, unassigned, after)
	w["merge_into"] = b
	f.mustPut(t, w, write([]uuid.UUID{b}, unassigned, after))
	op := latestOperation(t, db)
	rows := readOperationCups(t, db, op.ID)
	if rows[a].MergeTargetCupID == nil || *rows[a].MergeTargetCupID != b || rows[a].AssignedAt != nil || rows[b].MergedAt == nil {
		t.Fatalf("rows = %+v", rows)
	}
	f.mustPut(t, write([]uuid.UUID{a, b}, f.state(t, a), placed(2, drip, false)))
	var records []models.CaosOperationCup
	db.Where("assigned_at IS NOT NULL").Find(&records)
	if len(records) != 2 {
		t.Fatalf("assignments = %d", len(records))
	}
	for _, r := range records {
		if r.MergedAt != nil {
			t.Fatalf("assignment mistaken for merge: %+v", r)
		}
	}
}
func TestCaosLogFailureRollsBackOnDB(t *testing.T) {
	db := openCaosTestDB(t)
	f := newCaosFixture(t, db)
	cup := f.createOrder(t, 1, line(f.blend)).OrderCups[0].ID
	// テスト専用schemaで保存を失敗させ、盤面もrollbackされることを確認。
	if err := db.Exec("ALTER TABLE caos_operation_cups ADD CONSTRAINT test_reject_log CHECK (false) NOT VALID").Error; err != nil {
		t.Fatal(err)
	}
	code, _ := f.put(t, write([]uuid.UUID{cup}, unassigned, placed(1, uuid.New(), false)))
	if code != 500 {
		t.Fatalf("write = %d", code)
	}
	if f.cup(t, cup).Dripper != nil {
		t.Fatal("cup changed without audit record")
	}
	var count int64
	db.Model(&models.CaosOperation{}).Count(&count)
	if count != 0 {
		t.Fatal("partial operation record persisted")
	}
}
func TestCaosClientLogsOnDB(t *testing.T) {
	db := openCaosTestDB(t)
	h := NewCaosHandler(db, nil, nil)
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.POST("/api/caos/logs", h.CreateCaosLogs)
	r.GET("/api/caos/logs", h.GetCaosLogs)
	r.GET("/api/caos/logs/export", h.ExportCaosLogs)
	post := func(body any) int {
		t.Helper()
		data, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		w := httptest.NewRecorder()
		req := httptest.NewRequest("POST", "/api/caos/logs", bytes.NewReader(data))
		req.Header.Set("Content-Type", "application/json")
		r.ServeHTTP(w, req)
		return w.Code
	}
	entry := map[string]any{"at": time.Now().UTC().Format(time.RFC3339Nano), "tabId": uuid.New(), "sequence": 1, "event": "ui.click", "details": map[string]any{"label": "test"}}
	body := map[string]any{"entries": []any{entry}}
	for i := 0; i < 2; i++ {
		if code := post(body); code != 204 {
			t.Fatalf("POST = %d", code)
		}
	}
	var count int64
	db.Model(&models.CaosClientLog{}).Count(&count)
	if count != 1 {
		t.Fatalf("duplicate rows = %d", count)
	}
	entry["sequence"] = 0
	if code := post(body); code != 400 {
		t.Fatalf("invalid POST = %d", code)
	}
	db.Model(&models.CaosClientLog{}).Count(&count)
	if count != 1 {
		t.Fatal("invalid row stored")
	}
	// POSTで保存したJSONをGETで取り出せる。DB用の列名ではなく元のJSONの形で返す。
	get := func(path string, want int) models.CaosLogPage {
		t.Helper()
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest("GET", path, nil))
		if w.Code != want {
			t.Fatalf("GET %s = %d: %s", path, w.Code, w.Body.String())
		}
		var page models.CaosLogPage
		if want == http.StatusOK {
			if err := json.Unmarshal(w.Body.Bytes(), &page); err != nil {
				t.Fatal(err)
			}
		}
		return page
	}
	page := get("/api/caos/logs?limit=1", http.StatusOK)
	if len(page.Entries) != 1 || page.HasMore || page.Entries[0].Event != "ui.click" ||
		page.Entries[0].Sequence != 1 || page.Entries[0].Details["label"] != "test" || page.Entries[0].ReceivedAt.IsZero() {
		t.Fatalf("GET page = %+v", page)
	}
	entry["sequence"] = 2
	entry["event"] = "page.open"
	if code := post(body); code != http.StatusNoContent {
		t.Fatalf("second POST = %d", code)
	}
	page = get("/api/caos/logs?limit=1", http.StatusOK)
	if !page.HasMore || len(page.Entries) != 1 || page.Entries[0].Sequence != 2 {
		t.Fatalf("first page = %+v", page)
	}
	page = get("/api/caos/logs?limit=1&offset=1", http.StatusOK)
	if page.HasMore || len(page.Entries) != 1 || page.Entries[0].Sequence != 1 {
		t.Fatalf("second page = %+v", page)
	}
	page = get("/api/caos/logs?event=ui.click&tab_id="+entry["tabId"].(uuid.UUID).String(), http.StatusOK)
	if len(page.Entries) != 1 || page.Entries[0].Event != "ui.click" {
		t.Fatalf("filtered = %+v", page)
	}
	page = get("/api/caos/logs?tab_id="+uuid.NewString(), http.StatusOK)
	if page.Entries == nil || len(page.Entries) != 0 {
		t.Fatalf("empty = %+v", page)
	}
	for _, query := range []string{"limit=0", "limit=1001", "limit=x", "offset=-1", "tab_id=invalid"} {
		get("/api/caos/logs?"+query, http.StatusBadRequest)
	}
	// 全件の書き出しには、クライアントログだけでなくcup単位の操作履歴も入る。
	f := newCaosFixture(t, db)
	order := f.createOrder(t, 1, line(f.blend))
	cupID := order.OrderCups[0].ID
	f.mustPut(t, write([]uuid.UUID{cupID}, unassigned, placed(1, uuid.New(), false)))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest("GET", "/api/caos/logs/export", nil))
	if w.Code != http.StatusOK || w.Header().Get("Content-Disposition") == "" {
		t.Fatalf("export = %d: %s", w.Code, w.Body.String())
	}
	var exported struct {
		ExportedAt time.Time                 `json:"exportedAt"`
		Entries    []models.CaosClientLog    `json:"entries"`
		Operations []models.CaosOperation    `json:"operations"`
		Cups       []models.CaosOperationCup `json:"cups"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &exported); err != nil {
		t.Fatal(err)
	}
	if exported.ExportedAt.IsZero() || len(exported.Entries) != 2 || len(exported.Operations) != 1 || len(exported.Cups) != 1 {
		t.Fatalf("export contents = %+v", exported)
	}
	if row := exported.Cups[0]; row.CupID != cupID || row.OrderID != order.ID || row.AssignedAt == nil || row.OperationID != exported.Operations[0].ID {
		t.Fatalf("exported cup = %+v", row)
	}
}

func TestCaosEmergencyOperationLogOnDB(t *testing.T) {
	db := openCaosTestDB(t)
	f := newCaosFixture(t, db)
	order := f.createOrder(t, 1, line(f.blend))
	other := f.createOrder(t, 2, line(f.blend))
	cupID := order.OrderCups[0].ID
	added, _, _, err := f.caos.addEmergencies([]uuid.UUID{cupID}, "こぼした")
	if err != nil {
		t.Fatal(err)
	}
	operation := latestOperation(t, db)
	rows := readOperationCups(t, db, operation.ID)
	row := rows[added[0].ID]
	if operation.Kind != "emergency.add" || !row.Added || !row.Changed || row.Removed || row.CupID != cupID || row.OrderID != order.ID || row.EmergencyReason != "こぼした" || !rows[other.OrderCups[0].ID].InWindow {
		t.Fatalf("added log = %+v, %+v", operation, row)
	}
	var payload struct {
		Reason  string      `json:"reason"`
		UnitIDs []uuid.UUID `json:"unit_ids"`
	}
	if err := json.Unmarshal(operation.Details, &payload); err != nil {
		t.Fatal(err)
	}
	if payload.Reason != "こぼした" || len(payload.UnitIDs) != 1 || payload.UnitIDs[0] != added[0].ID {
		t.Fatalf("details = %s", operation.Details)
	}
	if _, _, err := f.caos.cancelEmergency(added[0].ID); err != nil {
		t.Fatal(err)
	}
	operation = latestOperation(t, db)
	row = readOperationCups(t, db, operation.ID)[added[0].ID]
	if operation.Kind != "emergency.cancel" || !row.Removed || !row.Changed || row.Added || row.EmergencyReason != "こぼした" || row.CupID != cupID {
		t.Fatalf("cancel log = %+v, %+v", operation, row)
	}
	// 実データを消しても、追加・取消の履歴が残る。
	var count int64
	db.Model(&models.CupEmergency{}).Where("id = ?", added[0].ID).Count(&count)
	if count != 0 {
		t.Fatal("emergency not deleted")
	}
	db.Model(&models.CaosOperationCup{}).Where("unit_id = ?", added[0].ID).Count(&count)
	if count != 2 {
		t.Fatalf("history = %d", count)
	}
	// ログの保存に失敗した追加は、入れ直しも履歴もrollbackする。
	if err := db.Exec("ALTER TABLE caos_operation_cups ADD CONSTRAINT test_reject_log CHECK (false) NOT VALID").Error; err != nil {
		t.Fatal(err)
	}
	if _, _, _, err := f.caos.addEmergencies([]uuid.UUID{cupID}, "rollback"); err == nil {
		t.Fatal("missing error")
	}
	db.Model(&models.CupEmergency{}).Count(&count)
	if count != 0 {
		t.Fatal("emergency persisted without audit")
	}
	db.Model(&models.CaosOperation{}).Count(&count)
	if count != 2 {
		t.Fatalf("partial operation persisted: %d", count)
	}
}

func TestCaosLaneOperationLogOnDB(t *testing.T) {
	db := openCaosTestDB(t)
	f := newCaosFixture(t, db)
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.PUT("/api/caos/lanes/:dripper", f.caos.PutCaosLane)
	r.POST("/api/caos/lanes/swap", f.caos.SwapCaosLanes)
	r.POST("/api/caos/lanes/seniors", f.caos.UpdateCaosLaneSeniors)
	for _, request := range []struct{ method, path, body string }{
		{"PUT", "/api/caos/lanes/1", `{"name":"A","senior":false}`},
		{"PUT", "/api/caos/lanes/2", `{"name":"B","senior":false}`},
		{"POST", "/api/caos/lanes/swap", `{"first":1,"second":2}`},
		{"POST", "/api/caos/lanes/seniors", `{"lanes":[{"dripper":1,"name":"B","senior":true}]}`},
	} {
		w := httptest.NewRecorder()
		req := httptest.NewRequest(request.method, request.path, bytes.NewBufferString(request.body))
		req.Header.Set("Content-Type", "application/json")
		r.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("%s = %d: %s", request.path, w.Code, w.Body.String())
		}
	}
	var operations []models.CaosOperation
	db.Order("recorded_at").Find(&operations)
	if len(operations) != 4 {
		t.Fatalf("operations = %d", len(operations))
	}
	if operations[2].Kind != "lanes.swap" || operations[3].Kind != "lanes.seniors" {
		t.Fatalf("kinds = %+v", operations)
	}
	var details struct {
		Before models.CaosLanes `json:"before"`
		After  models.CaosLanes `json:"after"`
	}
	if err := json.Unmarshal(operations[2].Details, &details); err != nil {
		t.Fatal(err)
	}
	if details.Before.Lanes[0].Name != "A" || details.After.Lanes[0].Name != "B" {
		t.Fatalf("swap = %s", operations[2].Details)
	}
	if err := json.Unmarshal(operations[3].Details, &details); err != nil {
		t.Fatal(err)
	}
	if details.Before.Lanes[0].Senior || !details.After.Lanes[0].Senior {
		t.Fatalf("seniors = %s", operations[3].Details)
	}
}
