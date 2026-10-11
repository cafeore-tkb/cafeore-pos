package notify

import (
	"context"
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

func TestActivityCloseSendsPendingLines(t *testing.T) {
	slack, received := activityServer(t)
	a := newActivity(slack, time.Hour, 10)

	a.Post("one")
	a.Post("two")
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	a.Close(ctx)
	if text := receive(t, received); text != "one\ntwo" {
		t.Fatalf("unexpected message: %q", text)
	}

	// Close の後に来たものはまとめずにすぐ送る
	a.Post("three")
	if text := receive(t, received); text != "three" {
		t.Fatalf("unexpected message: %q", text)
	}
}

func TestActivityEscapesSlackMarkup(t *testing.T) {
	slack, received := activityServer(t)
	a := newActivity(slack, 10*time.Millisecond, 10)

	a.Post("🆕 アイテムを追加: <!channel> & <@U123>")
	if text := receive(t, received); text != "🆕 アイテムを追加: &lt;!channel&gt; &amp; &lt;@U123&gt;" {
		t.Fatalf("unexpected message: %q", text)
	}
}

func TestNilActivityIgnoresPosts(t *testing.T) {
	var a *Activity
	a.Post("nothing")
	a.Close(context.Background())
}
