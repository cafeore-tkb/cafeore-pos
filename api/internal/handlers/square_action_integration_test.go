package handlers

// 決済手段を選ぶ画面（Terminal action）を、実際の Postgres と偽の Square サーバーで通しで確かめる。
// 動かし方は square_integration_test.go を参照（SQUARE_INTEGRATION_DATABASE_URL が無ければスキップ）。

import (
	"net/http"
	"testing"

	"github.com/google/uuid"

	"cafeore-pos/api/internal/models"
)

func (e *integrationEnv) createAction(key string, amount int) (int, models.SquareActionResponse) {
	e.t.Helper()
	var action models.SquareActionResponse
	status := e.call(http.MethodPost, "/api/square/actions", map[string]any{
		"idempotency_key": key, "device_id": "device-1", "amount": amount,
		"options": []string{"CASH", "CARD_PRESENT", "QR_CODE"},
	}, nil, &action)
	return status, action
}

func (e *integrationEnv) getAction(id uuid.UUID) models.SquareActionResponse {
	e.t.Helper()
	var action models.SquareActionResponse
	if code := e.call(http.MethodGet, "/api/square/actions/"+id.String(), nil, nil, &action); code != http.StatusOK {
		e.t.Fatalf("get action: %d %+v", code, action)
	}
	return action
}

func TestSquareIntegrationActionSelected(t *testing.T) {
	env := newIntegrationEnv(t)
	key := uuid.NewString()
	code, action := env.createAction(key, 1200)
	if code != http.StatusCreated || action.Outcome != models.ActionPending || action.ActionId == nil || action.Status != squareStatusPending {
		t.Fatalf("create: %d %+v", code, action)
	}
	sent := env.fake.actions[*action.ActionId]
	if sent.Type != "SELECT" || sent.DeviceID != "device-1" || sent.SelectOptions == nil || len(sent.SelectOptions.Options) != 3 ||
		sent.SelectOptions.Options[0].ReferenceID != "CASH" || sent.SelectOptions.Options[0].Title != "現金" ||
		sent.SelectOptions.Body != "お会計 1,200 円" {
		t.Fatalf("unexpected action sent to Square: %+v %+v", sent, sent.SelectOptions)
	}

	// 選ばれるまでは pending のまま。
	if got := env.getAction(action.Id); got.Outcome != models.ActionPending || got.Selected != nil {
		t.Fatalf("before selection: %+v", got)
	}
	env.fake.selectOption(*action.ActionId, "QR_CODE")
	got := env.getAction(action.Id)
	if got.Outcome != models.ActionSelected || got.Selected == nil || *got.Selected != "QR_CODE" {
		t.Fatalf("after selection: %+v", got)
	}

	// 同じ idempotency_key の再送は、作り直さずに同じものを返す。
	code, again := env.createAction(key, 1200)
	if code != http.StatusOK || again.Id != action.Id || again.Outcome != models.ActionSelected {
		t.Fatalf("resend: %d %+v", code, again)
	}
	if len(env.fake.actions) != 1 {
		t.Fatalf("expected one action sent to Square, got %d", len(env.fake.actions))
	}

	// 選ばれた後に取り消しても、何もせずに今の状態を返す。
	var canceled models.SquareActionResponse
	if code := env.call(http.MethodPost, "/api/square/actions/"+action.Id.String()+"/cancel", nil, nil, &canceled); code != http.StatusOK ||
		canceled.Outcome != models.ActionSelected {
		t.Fatalf("cancel after selection: %d %+v", code, canceled)
	}
	if len(env.fake.actionCancels) != 0 {
		t.Fatalf("a selected action must not be canceled: %v", env.fake.actionCancels)
	}
}

func TestSquareIntegrationActionCancel(t *testing.T) {
	env := newIntegrationEnv(t)
	code, action := env.createAction(uuid.NewString(), 600)
	if code != http.StatusCreated {
		t.Fatalf("create: %d %+v", code, action)
	}
	var canceled models.SquareActionResponse
	if code := env.call(http.MethodPost, "/api/square/actions/"+action.Id.String()+"/cancel", nil, nil, &canceled); code != http.StatusOK {
		t.Fatalf("cancel: %d %+v", code, canceled)
	}
	if canceled.Outcome != models.ActionClosed || canceled.CancelReason == nil || *canceled.CancelReason != "SELLER_CANCELED" {
		t.Fatalf("canceled: %+v", canceled)
	}
	// もう一度押しても Square には頼まない。
	if code := env.call(http.MethodPost, "/api/square/actions/"+action.Id.String()+"/cancel", nil, nil, &canceled); code != http.StatusOK ||
		canceled.Outcome != models.ActionClosed {
		t.Fatalf("cancel again: %d %+v", code, canceled)
	}
	if len(env.fake.actionCancels) != 1 {
		t.Fatalf("expected one cancel request, got %v", env.fake.actionCancels)
	}
}

// 端末への依頼は順に出るので、決済依頼を作る前に、出したままの決済手段の画面を取り消す。
func TestSquareIntegrationCheckoutCancelsPendingAction(t *testing.T) {
	env := newIntegrationEnv(t)
	code, action := env.createAction(uuid.NewString(), 600)
	if code != http.StatusCreated {
		t.Fatalf("create action: %d %+v", code, action)
	}
	if code, _, _ := env.createCheckout(uuid.NewString(), 600); code != http.StatusCreated {
		t.Fatalf("create checkout: %d", code)
	}
	if status := env.fake.actionStatus(*action.ActionId); status != squareStatusCanceled {
		t.Fatalf("pending action must be canceled before the checkout, got %s", status)
	}
	if got := env.getAction(action.Id); got.Outcome != models.ActionClosed {
		t.Fatalf("action after checkout: %+v", got)
	}

	// 決済が進行中の端末には出さない（決済画面の後ろに並んでしまう）。
	if code, busy := env.createAction(uuid.NewString(), 600); code != http.StatusConflict {
		t.Fatalf("action during checkout: %d %+v", code, busy)
	}
	if len(env.fake.actions) != 1 {
		t.Fatalf("expected one action sent to Square, got %d", len(env.fake.actions))
	}
}

func TestSquareIntegrationActionReplacesPrevious(t *testing.T) {
	env := newIntegrationEnv(t)
	code, first := env.createAction(uuid.NewString(), 600)
	if code != http.StatusCreated {
		t.Fatalf("first: %d %+v", code, first)
	}
	// 請求額が変わって出し直したら、前の画面は取り消す。
	code, second := env.createAction(uuid.NewString(), 400)
	if code != http.StatusCreated || second.Id == first.Id {
		t.Fatalf("second: %d %+v", code, second)
	}
	if status := env.fake.actionStatus(*first.ActionId); status != squareStatusCanceled {
		t.Fatalf("previous action must be canceled, got %s", status)
	}
	if status := env.fake.actionStatus(*second.ActionId); status != squareStatusPending {
		t.Fatalf("new action must stay, got %s", status)
	}
	// 取り消されたことは記録にも残る（次に決済依頼を作るとき、もう一度頼まない）。
	if got := env.getAction(first.Id); got.Outcome != models.ActionClosed {
		t.Fatalf("previous action: %+v", got)
	}
}

func TestSquareIntegrationActionValidation(t *testing.T) {
	env := newIntegrationEnv(t)
	bodies := map[string]map[string]any{
		"unregistered device": {"idempotency_key": uuid.NewString(), "device_id": "device-unknown", "amount": 600, "options": []string{"CASH", "QR_CODE"}},
		"one option":          {"idempotency_key": uuid.NewString(), "device_id": "device-1", "amount": 600, "options": []string{"CASH"}},
		"duplicated option":   {"idempotency_key": uuid.NewString(), "device_id": "device-1", "amount": 600, "options": []string{"CASH", "CASH"}},
		"unknown option":      {"idempotency_key": uuid.NewString(), "device_id": "device-1", "amount": 600, "options": []string{"CASH", "POINTS"}},
		"zero amount":         {"idempotency_key": uuid.NewString(), "device_id": "device-1", "amount": 0, "options": []string{"CASH", "QR_CODE"}},
	}
	for name, body := range bodies {
		t.Run(name, func(t *testing.T) {
			if code := env.call(http.MethodPost, "/api/square/actions", body, nil, nil); code != http.StatusBadRequest {
				t.Fatalf("got %d", code)
			}
		})
	}
	if len(env.fake.actions) != 0 {
		t.Fatalf("nothing must be sent to Square, got %d", len(env.fake.actions))
	}
}
