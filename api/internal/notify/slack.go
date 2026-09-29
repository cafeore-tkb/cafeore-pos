// api/internal/notify/slack.go
package notify

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"
)

// Slack の Incoming Webhook に投げる。URL が空なら何もしない（ローカルや
// PR プレビューで本番のチャンネルに流さないため）。
type Slack struct {
	url    string
	client *http.Client
}

func NewSlack(url string) *Slack {
	return &Slack{url: url, client: &http.Client{Timeout: 5 * time.Second}}
}

func (s *Slack) Enabled() bool {
	return s != nil && s.url != ""
}

func (s *Slack) Send(ctx context.Context, text string) error {
	if !s.Enabled() {
		log.Printf("slack: SLACK_WEBHOOK_URL is not set, skipped: %s", text)
		return nil
	}

	body, err := json.Marshal(map[string]string{"text": text})
	if err != nil {
		return err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	res, err := s.client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()

	if res.StatusCode >= 300 {
		return fmt.Errorf("slack: unexpected status %d", res.StatusCode)
	}
	return nil
}
