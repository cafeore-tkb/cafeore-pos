package handlers

import (
	"cafeore-pos/api/internal/models"
	"encoding/json"
	"github.com/google/uuid"
	"net/http"
	"testing"
	"time"
)

func TestChangedCupStatusesRecordsPartialServeAndUndo(t *testing.T) {
	id := uuid.New()
	ready := time.Date(2026, 11, 1, 0, 1, 0, 0, time.UTC)
	served := ready.Add(time.Minute)
	before := &models.Order{OrderCups: []models.OrderCup{{ID: id, ReadyAt: &ready}, {ID: uuid.New()}}}
	after := &models.Order{OrderCups: append([]models.OrderCup(nil), before.OrderCups...)}
	after.OrderCups[0].ServedAt = &served
	changes := changedCupStatuses(before, after)
	if len(changes) != 1 || changes[0].CupID != id || changes[0].BeforeServed != nil || !timeEqual(changes[0].AfterServed, &served) {
		t.Fatalf("partial serving evidence missing: %+v", changes)
	}
	changes = changedCupStatuses(after, before)
	if len(changes) != 1 || changes[0].AfterServed != nil || !timeEqual(changes[0].BeforeServed, &served) {
		t.Fatalf("undo must retain previous timestamp: %+v", changes)
	}
	if len(changedCupStatuses(before, before)) != 0 {
		t.Fatal("unchanged state must not emit a success event")
	}
}

func TestServiceOperationAuditOnDB(t *testing.T) {
	api := newTestAPI(t)
	master := api.seedMaster()
	created := api.createOrder(1, master.pairMenu)
	var count int64
	if err := api.db.Model(&models.CaosOperation{}).Where("kind = ?", "order.created").Count(&count).Error; err != nil || count != 1 {
		t.Fatalf("created audit count %d: %v", count, err)
	}
	path := "/api/orders/" + created.Id.String() + "/cups/" + created.Cups[0].Id.String() + "/served"
	api.patchStatus(path)
	api.patchStatus(path)
	var logs []models.CaosOperation
	if err := api.db.Where("kind = ?", "order.status.changed").Order("recorded_at").Find(&logs).Error; err != nil || len(logs) != 2 {
		t.Fatalf("status audit count %d: %v", len(logs), err)
	}
	var firstPayload struct {
		Cups []cupStatusEvidence `json:"cups"`
	}
	if err := json.Unmarshal(logs[0].Details, &firstPayload); err != nil {
		t.Fatal(err)
	}
	if len(firstPayload.Cups) != 1 ||
		!timeEqual(firstPayload.Cups[0].AfterReady, &logs[0].OccurredAt) ||
		!timeEqual(firstPayload.Cups[0].AfterServed, &logs[0].OccurredAt) {
		t.Fatalf("audit occurrence must equal ready/served timestamps: %s / %s", logs[0].OccurredAt, logs[0].Details)
	}
	var payload struct {
		Cups []cupStatusEvidence `json:"cups"`
	}
	if err := json.Unmarshal(logs[1].Details, &payload); err != nil {
		t.Fatal(err)
	}
	if len(payload.Cups) != 1 || payload.Cups[0].BeforeServed == nil || payload.Cups[0].AfterServed != nil {
		t.Fatalf("missing undo evidence: %s", logs[1].Details)
	}
	// 失敗した変更は成功履歴を増やさない。
	api.do(http.MethodPatch, "/api/orders/"+created.Id.String()+"/cups/"+uuid.NewString()+"/served", nil).expect(http.StatusNotFound)
	api.db.Model(&models.CaosOperation{}).Where("kind = ?", "order.status.changed").Count(&count)
	if count != 2 {
		t.Fatalf("failed operation produced a success record: %d", count)
	}
}
