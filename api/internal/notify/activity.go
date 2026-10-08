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
// 溜まっている分はメモリにしか無いので、終了時に Close で送り切る。
type Activity struct {
	slack *Slack
	lines chan string
	quiet time.Duration
	// 1通にまとめる行数の上限。超えたら待たずに送る
	max int
	// Close から、溜まっている分を送り終えたら閉じるチャネルを受け取る
	flushNow chan chan struct{}
}

func NewActivity(slack *Slack) *Activity {
	return newActivity(slack, 2*time.Second, 30)
}

func newActivity(slack *Slack, quiet time.Duration, max int) *Activity {
	a := &Activity{
		slack:    slack,
		lines:    make(chan string, 256),
		quiet:    quiet,
		max:      max,
		flushNow: make(chan chan struct{}),
	}
	go a.run()
	return a
}

// Post は送信を待たない。溜まりすぎていたらログに残して捨てる。nil や空の文面は無視する。
// 名前やメモに <!channel> などが入っていてもメンションにならないよう、ここで逃がす。
func (a *Activity) Post(text string) {
	if a == nil || text == "" {
		return
	}
	text = EscapeText(text)
	select {
	case a.lines <- text:
	default:
		log.Printf("activity: queue is full, dropped: %s", text)
	}
}

// Close は quiet を待たずに、溜まっている分を今すぐ送る。終了時（SIGTERM）に呼ぶ。
// 以降に Post されたもの（応答後の goroutine から来るもの）は、まとめずにすぐ送る。
// ctx が切れたら送り終わりを待たずに戻る。
func (a *Activity) Close(ctx context.Context) {
	if a == nil {
		return
	}
	done := make(chan struct{})
	select {
	case a.flushNow <- done:
	case <-ctx.Done():
		return
	}
	select {
	case <-done:
	case <-ctx.Done():
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

	// Close の後は止まる直前なので、まとめるのを待たない
	closed := false

	for {
		select {
		case line := <-a.lines:
			pending = append(pending, line)
			if closed || len(pending) >= a.max {
				timer.Stop()
				flush()
				continue
			}
			timer.Reset(a.quiet)
		case <-timer.C:
			flush()
		case done := <-a.flushNow:
			// まだ受け取っていない分も拾ってから送る
			for drained := false; !drained; {
				select {
				case line := <-a.lines:
					pending = append(pending, line)
				default:
					drained = true
				}
			}
			timer.Stop()
			flush()
			closed = true
			close(done)
		}
	}
}
