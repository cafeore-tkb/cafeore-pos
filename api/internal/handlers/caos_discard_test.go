package handlers

import (
	"cafeore-pos/api/internal/models"
	"encoding/json"
	"github.com/google/uuid"
	"net/http"
	"testing"
)

func (f *caosFixture) discard(t *testing.T, body map[string]any) (int, string) {
	t.Helper()
	b, _ := json.Marshal(body)
	w := callWithParams(t, f.caos.DiscardCaosCups, http.MethodPost, string(b), nil)
	return w.Code, w.Body.String()
}

func TestCaosDiscardOnDB(t *testing.T) {
	for _, mode := range []string{"queued", "brewing", "rebrew"} {
		t.Run(mode, func(t *testing.T) {
			f := newCaosFixture(t, openCaosTestDB(t))
			o := f.createOrder(t, 1, line(f.blend, f.blend))
			target, peer := o.OrderCups[0].ID, o.OrderCups[1].ID
			if mode == "rebrew" {
				if code, body := f.addEmergencies(t, target); code != http.StatusCreated {
					t.Fatalf("add=%d %s", code, body)
				}
				target = f.emergencies(t, target)[0].ID
			}
			card, finished := uuid.New(), uuid.New()
			placedIDs := []uuid.UUID{target, peer}
			if mode == "rebrew" {
				placedIDs = []uuid.UUID{target}
			}
			f.mustPut(t, write(placedIDs, unassigned, placed(2, card, mode != "queued")))
			f.wait()
			if code, body := f.addEmergencies(t, o.OrderCups[0].ID); code != http.StatusCreated {
				t.Fatalf("add=%d %s", code, body)
			}
			beforePeer := f.cup(t, peer)
			state := f.state(t, o.OrderCups[0].ID)
			if mode == "rebrew" {
				state = f.emergencyState(t, target)
			}
			req := map[string]any{"cup_ids": []uuid.UUID{target}, "before": state, "drip_id": finished}
			// 送信の返事が失われても同じIDで再送し、履歴は1件だけ。
			for range 2 {
				if code, body := f.discard(t, req); code != http.StatusNoContent {
					t.Fatalf("discard=%d %s", code, body)
				}
			}
			units, err := readCaosUnits(f.db, "c.id = ?", target)
			if err != nil || len(units) != 1 {
				t.Fatal(err)
			}
			if units[0].DripID == nil || *units[0].DripID != finished || units[0].BrewFinishedAt == nil {
				t.Fatalf("discarded=%+v", units[0])
			}
			afterPeer := f.cup(t, peer)
			if !sameCaosState(&afterPeer, caosCupState(&beforePeer)) {
				t.Fatal("unaffected cup changed")
			}
			original := f.cup(t, o.OrderCups[0].ID)
			if original.ReadyAt != nil || original.ServedAt != nil {
				t.Fatal("discard must not serve the cup")
			}
			var logs []models.CaosOperation
			if err := f.db.Where("kind = ?", "brew.discard").Find(&logs).Error; err != nil || len(logs) != 1 {
				t.Fatalf("logs=%v %v", logs, err)
			}
			var rows []models.CaosOperationCup
			f.db.Where("operation_id = ? AND changed = true", logs[0].ID).Find(&rows)
			if len(rows) != 1 || rows[0].UnitID != target || rows[0].AfterBrewFinishedAt == nil {
				t.Fatalf("audit=%+v", rows)
			}
			redos := f.emergencies(t, o.OrderCups[0].ID)
			if redos[len(redos)-1].DripID != nil || redos[len(redos)-1].BrewFinishedAt != nil {
				t.Fatal("replacement changed")
			}
		})
	}
}

func TestCaosDiscardRejectsInvalidOnDB(t *testing.T) {
	f := newCaosFixture(t, openCaosTestDB(t))
	o := f.createOrder(t, 1, line(f.blend))
	target := o.OrderCups[0].ID
	card := uuid.New()
	f.mustPut(t, write([]uuid.UUID{target}, unassigned, placed(2, card, true)))
	req := map[string]any{"cup_ids": []uuid.UUID{target}, "before": f.state(t, target), "drip_id": uuid.New()}
	if code, _ := f.discard(t, req); code != http.StatusBadRequest {
		t.Fatalf("without replacement=%d", code)
	}
	f.wait()
	b, _ := json.Marshal(map[string]any{"order_cup_ids": []uuid.UUID{target}, "reason": "ラベル再発行"})
	w := callWithParams(t, f.caos.CreateCupEmergencies, http.MethodPost, string(b), nil)
	if w.Code != http.StatusCreated {
		t.Fatal(w.Body.String())
	}
	if code, _ := f.discard(t, req); code != http.StatusBadRequest {
		t.Fatalf("label only=%d", code)
	}
	if f.cup(t, target).BrewFinishedAt != nil {
		t.Fatal("rejected operation changed cup")
	}
	// 入れ直しの登録後でも、別の端末で状態が変わっていれば断る。
	if code, body := f.addEmergencies(t, target); code != http.StatusCreated {
		t.Fatalf("add=%d %s", code, body)
	}
	state := f.state(t, target)
	state["drip_id"] = uuid.New()
	req["before"] = state
	if code, _ := f.discard(t, req); code != http.StatusConflict {
		t.Fatalf("stale=%d", code)
	}
	var count int64
	f.db.Model(&models.CaosOperation{}).Where("kind = ?", "brew.discard").Count(&count)
	if count != 0 {
		t.Fatal("rejected operation was audited as success")
	}
}

func TestCaosDiscardAuditRollbackOnDB(t *testing.T) {
	f := newCaosFixture(t, openCaosTestDB(t))
	o := f.createOrder(t, 1, line(f.blend))
	id := o.OrderCups[0].ID
	f.mustPut(t, write([]uuid.UUID{id}, unassigned, placed(1, uuid.New(), true)))
	f.wait()
	if code, body := f.addEmergencies(t, id); code != http.StatusCreated {
		t.Fatalf("add=%d %s", code, body)
	}
	before := f.cup(t, id)
	if err := f.db.Exec("DROP TABLE caos_operation_cups").Error; err != nil {
		t.Fatal(err)
	}
	req := map[string]any{"cup_ids": []uuid.UUID{id}, "before": f.state(t, id), "drip_id": uuid.New()}
	if code, _ := f.discard(t, req); code != http.StatusInternalServerError {
		t.Fatalf("without audit table=%d", code)
	}
	after := f.cup(t, id)
	if !sameCaosState(&after, caosCupState(&before)) {
		t.Fatal("discard survived failed audit")
	}
}
