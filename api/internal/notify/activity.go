// api/internal/notify/activity.go
package notify

import (
	"context"
	"log"
	"strings"
	"time"
)

// 商品の登録・変更・削除や入荷・棚卸しなどの操作を Slack に流す。
// 取り込みのように続けて来たものは、quiet だけ途切れるまで待って1通にまとめる。
// 送信は裏で行い、呼び出し側（API の応答）を待たせない。
type Activity struct {
	slack *Slack
	lines chan string
	quiet time.Duration
	// 1通にまとめる行数の上限。超えたら待たずに送る
	max int
}

func NewActivity(slack *Slack) *Activity {
	return newActivity(slack, 2*time.Second, 30)
}

func newActivity(slack *Slack, quiet time.Duration, max int) *Activity {
	a := &Activity{slack: slack, lines: make(chan string, 256), quiet: quiet, max: max}
	go a.run()
	return a
}

// Post は送信を待たない。溜まりすぎていたらログに残して捨てる。nil や空の文面は無視する。
func (a *Activity) Post(text string) {
	if a == nil || text == "" {
		return
	}
	select {
	case a.lines <- text:
	default:
		log.Printf("activity: queue is full, dropped: %s", text)
	}
}

func (a *Activity) run() {
	var pending []string
	timer := time.NewTimer(a.quiet)
	timer.Stop()

	flush := func() {
		if len(pending) == 0 {
			return
		}
		text := strings.Join(pending, "\n")
		pending = nil
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := a.slack.Send(ctx, text); err != nil {
			log.Printf("activity: failed to send: %v", err)
		}
	}

	for {
		select {
		case line := <-a.lines:
			pending = append(pending, line)
			if len(pending) >= a.max {
				timer.Stop()
				flush()
				continue
			}
			timer.Reset(a.quiet)
		case <-timer.C:
			flush()
		}
	}
}
