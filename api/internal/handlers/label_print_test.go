package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"cafeore-pos/api/internal/models"
)

// 緊急のシールと同じ形の印刷データ（カップのシール 1 枚）
var testLabelJob = map[string]any{
	"labels": []any{map[string]any{
		"type": "fixed",
		"area": map[string]any{"x": 0, "y": 24, "width": 560, "height": 210},
		"elements": []any{
			map[string]any{"type": "text", "x": 0, "y": 48, "line": []any{map[string]any{"text": "No.12", "size": []any{2, 2}}}},
			map[string]any{"type": "logo", "x": 230, "y": 204},
		},
	}},
}

func labelPrintPath(id uuid.UUID, action string) string {
	return "/api/label-print-requests/" + id.String() + "/" + action
}

// 頼める淹れ直し（代理印刷の頼みの id）を DB に入れる。カップ・注文は見ないので入れない
func (a *testAPI) seedEmergency() uuid.UUID {
	a.t.Helper()
	row := models.CupEmergency{ID: uuid.New(), OrderCupID: uuid.New(), CreatedAt: time.Now()}
	a.create(&row)
	return row.ID
}

// claim を呼んで、返事の status と job を返す
func (a *testAPI) claimLabelPrint(id uuid.UUID, device string) models.LabelPrintClaimResponse {
	a.t.Helper()
	var resp models.LabelPrintClaimResponse
	a.do(http.MethodPost, labelPrintPath(id, "claim"), map[string]any{"device_id": device}).expect(http.StatusOK).decode(&resp)
	return resp
}

// 配信された頼みが id のものか確かめ、その頼みを返す
func (a *testAPI) expectLabelPrintRequested(id uuid.UUID) models.LabelPrintRequestResponse {
	a.t.Helper()
	msg := a.nextBroadcast()
	if msg.Type != WSMessageTypeLabelPrintRequested || msg.LabelPrintRequest == nil || msg.LabelPrintRequest.Id != id {
		a.t.Fatalf("broadcast = %+v, want label_print_requested %s", msg, id)
	}
	return *msg.LabelPrintRequest
}

func sameJSON(t *testing.T, got, want any) {
	t.Helper()
	g, err := json.Marshal(got)
	if err != nil {
		t.Fatal(err)
	}
	w, err := json.Marshal(want)
	if err != nil {
		t.Fatal(err)
	}
	if string(g) != string(w) {
		t.Fatalf("got %s, want %s", g, w)
	}
}

func TestLabelPrintRequestFlow(t *testing.T) {
	a := newTestAPI(t)
	id := a.seedEmergency()

	// 頼むと、まだ刷れていない頼みとして配る
	a.do(http.MethodPost, "/api/label-print-requests", map[string]any{"id": id, "job": testLabelJob}).expect(http.StatusNoContent)
	sameJSON(t, a.expectLabelPrintRequested(id).Job, testLabelJob)

	// 同じ id の送り直しは中身を変えず、配り直す
	other := map[string]any{"labels": []any{map[string]any{"type": "flow", "lines": []any{}}}}
	a.do(http.MethodPost, "/api/label-print-requests", map[string]any{"id": id, "job": other}).expect(http.StatusNoContent)
	sameJSON(t, a.expectLabelPrintRequested(id).Job, testLabelJob)

	var list []models.LabelPrintRequestResponse
	a.do(http.MethodGet, "/api/label-print-requests", nil).expect(http.StatusOK).decode(&list)
	if len(list) != 1 || list[0].Id != id {
		t.Fatalf("list = %+v", list)
	}
	sameJSON(t, list[0].Job, testLabelJob)

	// 引き受けたレジだけが刷る。ほかのレジは busy、同じレジは引き受け直せる
	if got := a.claimLabelPrint(id, "register-a"); got.Status != models.Claimed || got.Job == nil {
		t.Fatalf("claim a = %+v", got)
	} else {
		sameJSON(t, got.Job, testLabelJob)
	}
	if got := a.claimLabelPrint(id, "register-b"); got.Status != models.Busy || got.Job != nil {
		t.Fatalf("claim b = %+v, want busy", got)
	}
	if got := a.claimLabelPrint(id, "register-a"); got.Status != models.Claimed {
		t.Fatalf("claim a again = %+v", got)
	}
	// 刷っている途中のものも一覧に入る
	a.do(http.MethodGet, "/api/label-print-requests", nil).expect(http.StatusOK).decode(&list)
	if len(list) != 1 {
		t.Fatalf("list while claimed = %+v", list)
	}

	// 引き受けていないレジがやめても何もしない。引き受けたレジがやめたら、ほかのレジが引き受けられるよう配り直す
	a.do(http.MethodPost, labelPrintPath(id, "release"), map[string]any{"device_id": "register-b"}).expect(http.StatusNoContent)
	a.noBroadcast()
	a.do(http.MethodPost, labelPrintPath(id, "release"), map[string]any{"device_id": "register-a"}).expect(http.StatusNoContent)
	a.expectLabelPrintRequested(id)
	if got := a.claimLabelPrint(id, "register-b"); got.Status != models.Claimed {
		t.Fatalf("claim b after release = %+v", got)
	}

	// 刷れたら知らせる（2 回目は知らせない）
	a.do(http.MethodPost, labelPrintPath(id, "printed"), map[string]any{"device_id": "register-b"}).expect(http.StatusNoContent)
	if msg := a.nextBroadcast(); msg.Type != WSMessageTypeLabelPrintDone || msg.LabelPrintRequestID == nil || *msg.LabelPrintRequestID != id {
		t.Fatalf("broadcast = %+v, want label_print_done", msg)
	}
	a.do(http.MethodPost, labelPrintPath(id, "printed"), map[string]any{"device_id": "register-a"}).expect(http.StatusNoContent)
	a.noBroadcast()
	var row models.LabelPrintRequest
	if err := a.db.First(&row, "id = ?", id).Error; err != nil {
		t.Fatal(err)
	}
	if row.PrintedAt == nil || row.PrintedBy == nil || *row.PrintedBy != "register-b" || row.ClaimedBy != nil || row.ClaimedUntil != nil {
		t.Fatalf("row = %+v", row)
	}

	// 刷れたものは引き受けられず、一覧にも出ず、送り直されても配らない
	if got := a.claimLabelPrint(id, "register-a"); got.Status != models.Printed || got.Job != nil {
		t.Fatalf("claim printed = %+v", got)
	}
	a.do(http.MethodGet, "/api/label-print-requests", nil).expect(http.StatusOK).decode(&list)
	if len(list) != 0 {
		t.Fatalf("list after printed = %+v", list)
	}
	a.do(http.MethodPost, "/api/label-print-requests", map[string]any{"id": id, "job": testLabelJob}).expect(http.StatusNoContent)
	a.noBroadcast()
	// 刷れなかったと言われても、刷れたまま
	a.do(http.MethodPost, labelPrintPath(id, "release"), map[string]any{"device_id": "register-b"}).expect(http.StatusNoContent)
	a.noBroadcast()
}

// 引き受けたレジが返事をしないまま引き受けが切れたら、ほかのレジが引き受け直せる
func TestLabelPrintClaimExpires(t *testing.T) {
	a := newTestAPI(t)
	id := a.seedEmergency()
	a.do(http.MethodPost, "/api/label-print-requests", map[string]any{"id": id, "job": testLabelJob}).expect(http.StatusNoContent)
	a.expectLabelPrintRequested(id)
	if got := a.claimLabelPrint(id, "register-a"); got.Status != models.Claimed {
		t.Fatalf("claim a = %+v", got)
	}
	var row models.LabelPrintRequest
	if err := a.db.First(&row, "id = ?", id).Error; err != nil {
		t.Fatal(err)
	}
	if row.ClaimedUntil == nil || time.Until(*row.ClaimedUntil) < labelPrintClaimTTL-10*time.Second {
		t.Fatalf("claimed_until = %v", row.ClaimedUntil)
	}
	if err := a.db.Model(&row).Update("claimed_until", time.Now().Add(-time.Second)).Error; err != nil {
		t.Fatal(err)
	}
	if got := a.claimLabelPrint(id, "register-b"); got.Status != models.Claimed {
		t.Fatalf("claim b after expiry = %+v", got)
	}
	// 切れた後でも、刷れたと言われたら刷れたことにする
	a.do(http.MethodPost, labelPrintPath(id, "printed"), map[string]any{"device_id": "register-a"}).expect(http.StatusNoContent)
	if msg := a.nextBroadcast(); msg.Type != WSMessageTypeLabelPrintDone {
		t.Fatalf("broadcast = %+v, want label_print_done", msg)
	}
}

// 一覧は今日（日本時間）の、まだ刷れていないものだけ（古い順）
func TestLabelPrintRequestsListsToday(t *testing.T) {
	a := newTestAPI(t)
	start, _ := caosToday(time.Now())
	yesterday := models.LabelPrintRequest{ID: uuid.New(), Job: models.JSONB(`{"labels":[{"type":"flow","lines":[]}]}`), CreatedAt: start.Add(-time.Minute)}
	first := models.LabelPrintRequest{ID: uuid.New(), Job: yesterday.Job, CreatedAt: start.Add(time.Minute)}
	second := models.LabelPrintRequest{ID: uuid.New(), Job: yesterday.Job, CreatedAt: time.Now()}
	a.create(&yesterday, &second, &first)
	var list []models.LabelPrintRequestResponse
	a.do(http.MethodGet, "/api/label-print-requests", nil).expect(http.StatusOK).decode(&list)
	if len(list) != 2 || list[0].Id != first.ID || list[1].Id != second.ID {
		t.Fatalf("list = %+v", list)
	}
}

func TestLabelPrintRequestValidation(t *testing.T) {
	a := newTestAPI(t)
	for name, body := range map[string]any{
		"no id":        map[string]any{"job": testLabelJob},
		"nil id":       map[string]any{"id": uuid.Nil, "job": testLabelJob},
		"no job":       map[string]any{"id": uuid.New()},
		"empty labels": map[string]any{"id": uuid.New(), "job": map[string]any{"labels": []any{}}},
		"not object":   map[string]any{"id": uuid.New(), "job": map[string]any{"labels": []any{1}}},
		"too large": map[string]any{"id": uuid.New(), "job": map[string]any{"labels": []any{
			map[string]any{"type": "flow", "lines": strings.Repeat("x", labelPrintJobMaxBytes)},
		}}},
	} {
		t.Run(name, func(t *testing.T) {
			a.t = t
			a.do(http.MethodPost, "/api/label-print-requests", body).expect(http.StatusBadRequest)
		})
	}
	a.t = t
	a.noBroadcast()

	// 淹れ直しが無い（取り消した）なら作らない。頼んだ端末がシールを捨てられるよう、ルートが無い 404 ではなく 410
	missing := uuid.New()
	a.do(http.MethodPost, "/api/label-print-requests", map[string]any{"id": missing, "job": testLabelJob}).expect(http.StatusGone)
	var count int64
	if err := a.db.Model(&models.LabelPrintRequest{}).Count(&count).Error; err != nil || count != 0 {
		t.Fatalf("label print requests = %d, %v", count, err)
	}
	a.noBroadcast()

	for _, action := range []string{"claim", "printed", "release"} {
		a.do(http.MethodPost, labelPrintPath(missing, action), map[string]any{"device_id": "register-a"}).expect(http.StatusNotFound)
		a.do(http.MethodPost, "/api/label-print-requests/x/"+action, map[string]any{"device_id": "register-a"}).expect(http.StatusBadRequest)
		a.do(http.MethodPost, labelPrintPath(missing, action), map[string]any{"device_id": " "}).expect(http.StatusBadRequest)
		a.do(http.MethodPost, labelPrintPath(missing, action), map[string]any{"device_id": strings.Repeat("x", labelPrintDeviceMax+1)}).expect(http.StatusBadRequest)
	}
}

// 緊急の取り消しと同時に頼まれても、取り消した緊急のシールの頼みは残らない。
// 取り消し（淹れ直しの行を消してから頼みを消す）がトランザクションの途中なら、頼みはそれを待ってから 410 になる
func TestLabelPrintRequestWaitsForEmergencyCancel(t *testing.T) {
	a := newTestAPI(t)
	id := a.seedEmergency()

	cancel := a.db.Begin()
	if err := cancel.Delete(&models.CupEmergency{}, "id = ?", id).Error; err != nil {
		t.Fatal(err)
	}
	done := make(chan int, 1)
	go func() {
		body, _ := json.Marshal(map[string]any{"id": id, "job": testLabelJob})
		req := httptest.NewRequest(http.MethodPost, "/api/label-print-requests", strings.NewReader(string(body)))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		a.router.ServeHTTP(rec, req)
		done <- rec.Code
	}()
	select {
	case code := <-done:
		_ = cancel.Rollback()
		t.Fatalf("request did not wait for the cancel: %d", code)
	case <-time.After(300 * time.Millisecond):
	}
	if err := cancel.Delete(&models.LabelPrintRequest{}, "id = ?", id).Error; err != nil {
		t.Fatal(err)
	}
	if err := cancel.Commit().Error; err != nil {
		t.Fatal(err)
	}
	select {
	case code := <-done:
		if code != http.StatusGone {
			t.Fatalf("status = %d, want 410", code)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("request did not finish")
	}
	var count int64
	if err := a.db.Model(&models.LabelPrintRequest{}).Where("id = ?", id).Count(&count).Error; err != nil || count != 0 {
		t.Fatalf("label print requests = %d, %v", count, err)
	}
	a.noBroadcast()
}
