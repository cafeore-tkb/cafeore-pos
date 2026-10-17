package handlers

import (
	"strings"
	"testing"
	"time"

	"cafeore-pos/api/internal/models"
	"cafeore-pos/api/internal/square"
	"github.com/google/uuid"
)

func squareActionRecord(status string, mutate func(*models.SquareAction)) *models.SquareAction {
	record := &models.SquareAction{
		ID:        uuid.New(),
		ActionID:  ptr("act"),
		DeviceID:  "dev",
		Amount:    600,
		Options:   []string{"CASH", "CARD_PRESENT", "QR_CODE"},
		Status:    status,
		CreatedAt: squareTestNow.Add(-time.Minute),
	}
	if mutate != nil {
		mutate(record)
	}
	return record
}

func TestSquareActionOutcome(t *testing.T) {
	cases := map[string]struct {
		record *models.SquareAction
		want   models.SquareActionOutcome
	}{
		"pending":          {squareActionRecord(squareStatusPending, nil), models.ActionPending},
		"in progress":      {squareActionRecord(squareStatusInProgress, nil), models.ActionPending},
		"cancel requested": {squareActionRecord(squareStatusCancelRequested, nil), models.ActionPending},
		"unknown status":   {squareActionRecord("SOMETHING_NEW", nil), models.ActionPending},
		"selected": {
			squareActionRecord(squareStatusCompleted, func(r *models.SquareAction) { r.Selected = ptr("CASH") }), models.ActionSelected,
		},
		"completed without selection": {squareActionRecord(squareStatusCompleted, nil), models.ActionClosed},
		"canceled":                    {squareActionRecord(squareStatusCanceled, nil), models.ActionClosed},
		"error":                       {squareActionRecord(squareStatusError, nil), models.ActionClosed},
		"creating just now": {
			squareActionRecord(squareStatusCreating, func(r *models.SquareAction) { r.CreatedAt = squareTestNow }), models.ActionPending,
		},
		"creating stale": {
			squareActionRecord(squareStatusCreating, func(r *models.SquareAction) {
				r.CreatedAt = squareTestNow.Add(-(squareCreatingStale + time.Second))
			}), models.ActionClosed,
		},
		// 期限を過ぎても取り消されたと分からないものは、待つのをやめる。
		"pending past deadline": {
			squareActionRecord(squareStatusPending, func(r *models.SquareAction) {
				r.CreatedAt = squareTestNow.Add(-(squareActionDeadline + squareTimeoutGrace + time.Second))
			}), models.ActionClosed,
		},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			if got := squareActionOutcome(tc.record, squareTestNow); got != tc.want {
				t.Fatalf("got %s, want %s", got, tc.want)
			}
		})
	}
}

func TestApplySquareAction(t *testing.T) {
	record := squareActionRecord(squareStatusCreating, func(r *models.SquareAction) { r.ActionID = nil })
	applySquareAction(record, &square.TerminalAction{ID: "act-1", Status: squareStatusPending})
	if record.ActionID == nil || *record.ActionID != "act-1" || record.Status != squareStatusPending {
		t.Fatalf("unexpected record: %+v", record)
	}

	// 並べていない選択肢が返ってきても記録しない。
	applySquareAction(record, &square.TerminalAction{ID: "act-1", Status: squareStatusCompleted, SelectOptions: &square.SelectOptions{
		SelectedOption: &square.SelectOption{ReferenceID: "FELICA_ALL"},
	}})
	if record.Status != squareStatusCompleted || record.Selected != nil {
		t.Fatalf("unknown selection must be ignored: %+v", record)
	}

	record = squareActionRecord(squareStatusPending, nil)
	applySquareAction(record, &square.TerminalAction{ID: "act", Status: squareStatusCompleted, SelectOptions: &square.SelectOptions{
		SelectedOption: &square.SelectOption{ReferenceID: "CARD_PRESENT", Title: "カード"},
	}})
	if record.Status != squareStatusCompleted || record.Selected == nil || *record.Selected != "CARD_PRESENT" {
		t.Fatalf("selection not applied: %+v", record)
	}

	// 応答が前後しても、選ばれた後を取り消しで上書きしない。
	applySquareAction(record, &square.TerminalAction{ID: "act", Status: squareStatusCanceled, CancelReason: "SELLER_CANCELED"})
	if record.Status != squareStatusCompleted || record.CancelReason != nil {
		t.Fatalf("selected action must not regress: %+v", record)
	}
}

func TestValidateSquareActionRequest(t *testing.T) {
	valid := models.SquareActionCreateRequest{
		IdempotencyKey: "key", DeviceId: "dev", Amount: 600,
		Options: []models.SquareActionOption{models.OptionCash, models.OptionCardPresent, models.OptionQrCode},
	}
	if err := validateSquareActionRequest(valid); err != nil {
		t.Fatalf("valid request rejected: %v", err)
	}
	withSplit := valid
	withSplit.Options = append(append([]models.SquareActionOption(nil), valid.Options...), models.OptionSplit)
	if err := validateSquareActionRequest(withSplit); err != nil {
		t.Fatalf("request with SPLIT rejected: %v", err)
	}
	cases := map[string]func(*models.SquareActionCreateRequest){
		"no key": func(r *models.SquareActionCreateRequest) { r.IdempotencyKey = "" },
		"long key": func(r *models.SquareActionCreateRequest) {
			r.IdempotencyKey = strings.Repeat("k", squareIdempotencyKeyMaxLength+1)
		},
		"no device":   func(r *models.SquareActionCreateRequest) { r.DeviceId = "" },
		"zero amount": func(r *models.SquareActionCreateRequest) { r.Amount = 0 },
		"one option":  func(r *models.SquareActionCreateRequest) { r.Options = r.Options[:1] },
		"six options": func(r *models.SquareActionCreateRequest) {
			r.Options = append(r.Options, models.OptionFelicaAll, "A", "B")
		},
		"duplicated": func(r *models.SquareActionCreateRequest) {
			r.Options = []models.SquareActionOption{models.OptionCash, models.OptionCash}
		},
		"unknown value": func(r *models.SquareActionCreateRequest) {
			r.Options = []models.SquareActionOption{models.OptionCash, "POINTS"}
		},
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			req := valid
			req.Options = append([]models.SquareActionOption(nil), valid.Options...)
			mutate(&req)
			if err := validateSquareActionRequest(req); err == nil {
				t.Fatal("expected an error")
			}
		})
	}
}

func TestBuildTerminalAction(t *testing.T) {
	record := squareActionRecord(squareStatusCreating, func(r *models.SquareAction) {
		r.Amount = 12300
		r.Options = append(r.Options, "SPLIT")
	})
	action := buildTerminalAction(record)
	if action.DeviceID != "dev" || action.Type != "SELECT" || action.DeadlineDuration != "PT5M" || action.SelectOptions == nil {
		t.Fatalf("unexpected action: %+v", action)
	}
	if action.SelectOptions.Body != "お会計 12,300 円" || action.SelectOptions.SelectedOption != nil {
		t.Fatalf("unexpected select options: %+v", action.SelectOptions)
	}
	want := []square.SelectOption{
		{ReferenceID: "CASH", Title: "現金"},
		{ReferenceID: "CARD_PRESENT", Title: "カード"},
		{ReferenceID: "QR_CODE", Title: "QR コード"},
		{ReferenceID: "SPLIT", Title: "割り勘したい"},
	}
	if len(action.SelectOptions.Options) != len(want) {
		t.Fatalf("unexpected options: %+v", action.SelectOptions.Options)
	}
	for i, option := range want {
		if action.SelectOptions.Options[i] != option {
			t.Fatalf("option %d: got %+v, want %+v", i, action.SelectOptions.Options[i], option)
		}
	}
}

func TestGroupThousands(t *testing.T) {
	cases := map[int]string{0: "0", 1: "1", 999: "999", 1000: "1,000", 12300: "12,300", 1234567: "1,234,567"}
	for value, want := range cases {
		if got := groupThousands(value); got != want {
			t.Fatalf("groupThousands(%d) = %q, want %q", value, got, want)
		}
	}
}
