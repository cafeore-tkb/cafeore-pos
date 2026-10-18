package handlers

import (
	"encoding/json"
	"testing"
	"time"

	"cafeore-pos/api/internal/models"
)

func TestHumanCaosLog(t *testing.T) {
	for _, event := range []string{"page.open", "board.changed", "ui.scroll", "ui.pointerup", "ui.click", "outbox.send", "comment.stamp.succeeded"} {
		if entry := humanCaosLog(models.CaosClientLog{Event: event, Details: json.RawMessage(`{}`)}, nil); entry != nil {
			t.Fatalf("exported %s", event)
		}
	}
	at := time.Date(2026, 10, 17, 17, 0, 0, 0, time.UTC)
	row := models.CaosClientLog{Event: "component.activated", At: at, Details: json.RawMessage(`{"component":"OrderCard","control":"card","orderLabel":"#010","cardKey":"cup-a","x":123,"source":{"startX":50,"cardKey":"cup-b"}}`)}
	entry := humanCaosLog(row, nil)
	if entry == nil || entry.Action != "component.activated" || entry.Target != "#010" || entry.Time != "2026-10-18 02:00:00.000 +09:00" {
		t.Fatalf("unexpected entry: %+v", entry)
	}
	if _, ok := entry.Details["x"]; ok {
		t.Fatal("exported coordinate")
	}
	source := entry.Details["source"].(map[string]any)
	if _, ok := source["startX"]; ok {
		t.Fatal("exported nested coordinate")
	}
	if source["cardKey"] != "cup-b" {
		t.Fatal("lost component identifier")
	}
	no := 10
	reply := humanCaosLog(models.CaosClientLog{Event: "comment.stamp.requested", Details: json.RawMessage(`{"stamp":"👍 了解","orderId":"order-10"}`)}, &no)
	if reply.Target != "注文 #010" || reply.Action != "comment.stamp.requested" || reply.Details["stamp"] != "👍 了解" {
		t.Fatalf("reply: %+v", reply)
	}
}
