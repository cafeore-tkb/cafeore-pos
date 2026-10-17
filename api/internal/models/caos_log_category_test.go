package models

import (
	"encoding/json"
	"testing"
)

func TestCaosLogCategory(t *testing.T) {
	for _, tc := range []struct{ event, details, want string }{
		{"comment.stamp.requested", `{}`, "human"},
		{"comment.stamp.succeeded", `{}`, "system"},
		{"comment.notice.clicked", `{}`, "human"},
		{"comment.notice.received", `{}`, "system"},
		{"search.submitted", `{}`, "human"},
		{"search.result.changed", `{}`, "system"},
		{"ui.click", `{"isTrusted":true}`, "human"},
		{"ui.click", `{"isTrusted":false}`, "system"},
		{"ui.scroll", `{}`, "system"}, // scrollIntoViewも発火するため断定しない
		{"ui.workspace.changed", `{}`, "system"},
		{"board.merge.requested", `{}`, "human"},
		{"outbox.send", `{}`, "system"},
		{"outbox.retry", `{}`, "human"},
		{"shift-feed.load.requested", `{}`, "system"},
		{"emergency.api.requested", `{}`, "system"},
		{"practice.finished", `{"source":"time-up"}`, "system"},
		{"practice.finished", `{"source":"manual"}`, "human"},
		{"future.unknown", `{}`, "system"},
	} {
		t.Run(tc.event+tc.details, func(t *testing.T) {
			if got := CaosLogCategory(tc.event, json.RawMessage(tc.details)); got != tc.want {
				t.Fatalf("got %s, want %s", got, tc.want)
			}
		})
	}
}

func TestCaosLogJSONCategorizesLegacyRowsWithoutChangingDetails(t *testing.T) {
	original := json.RawMessage(`{"orderId":"order-1","category":"spoofed"}`)
	for _, tc := range []struct {
		row  any
		want string
	}{
		{CaosClientLog{Event: "comment.notice.clicked", Details: original}, "human"},
		{CaosOperation{Kind: "comment.created", Details: original}, "system"},
	} {
		data, err := json.Marshal(tc.row)
		if err != nil {
			t.Fatal(err)
		}
		var decoded struct {
			Details map[string]any `json:"details"`
		}
		if err := json.Unmarshal(data, &decoded); err != nil {
			t.Fatal(err)
		}
		if decoded.Details["category"] != tc.want || decoded.Details["orderId"] != "order-1" {
			t.Fatalf("unexpected JSON: %s", data)
		}
	}
	if string(original) != `{"orderId":"order-1","category":"spoofed"}` {
		t.Fatal("changed stored details")
	}
}
