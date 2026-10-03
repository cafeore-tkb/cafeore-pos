package notify

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func activityServer(t *testing.T) (*Slack, chan string) {
	t.Helper()
	received := make(chan string, 10)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]string
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		received <- body["text"]
	}))
	t.Cleanup(server.Close)
	return NewSlack(server.URL), received
}

func receive(t *testing.T, received chan string) string {
	t.Helper()
	select {
	case text := <-received:
		return text
	case <-time.After(2 * time.Second):
		t.Fatal("no message")
		return ""
	}
}

func TestActivityBatchesLinesUntilQuiet(t *testing.T) {
	slack, received := activityServer(t)
	a := newActivity(slack, 50*time.Millisecond, 10)

	a.Post("one")
	a.Post("two")
	if text := receive(t, received); text != "one\ntwo" {
		t.Fatalf("unexpected message: %q", text)
	}

	a.Post("three")
	if text := receive(t, received); text != "three" {
		t.Fatalf("unexpected message: %q", text)
	}
}

func TestActivitySendsWhenBatchIsFull(t *testing.T) {
	slack, received := activityServer(t)
	a := newActivity(slack, time.Hour, 2)

	a.Post("one")
	a.Post("two")
	if text := receive(t, received); text != "one\ntwo" {
		t.Fatalf("unexpected message: %q", text)
	}
}

func TestNilActivityIgnoresPosts(t *testing.T) {
	var a *Activity
	a.Post("nothing")
}
