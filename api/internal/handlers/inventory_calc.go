// api/internal/handlers/inventory_calc.go
package handlers

import (
	"fmt"
	"math"
	"strings"
	"time"

	"cafeore-pos/api/internal/models"
)

// 在庫対象1つ分の、ある時点での集計結果。
type stockSnapshot struct {
	Resource models.StockResource
	// 棚卸し・入荷が一度でもあるか。無ければ残量は出せない
	Tracked bool
	// 基準点。最後の棚卸し、無ければ最初の入荷
	BaseAt *time.Time
	// 基準点の棚卸しの実数。棚卸しが無ければ nil
	CountedQuantity *float64
	// 基準点以降の入荷・調整（棚卸しが無いときは最初の入荷も含む）
	Received float64
	// 基準点以降の注文での消費量と杯数
	Consumed         float64
	Servings         int
	ServingsLastHour int
}

// 基準点を決める。events は古い順に並んでいること。
func stockBaseline(events []models.StockEvent) (baseAt *time.Time, counted *float64, received float64) {
	if len(events) == 0 {
		return nil, nil, 0
	}

	start := 0
	for i, e := range events {
		if e.Kind == string(models.StockEventKindCount) {
			start = i
		}
	}

	first := events[start]
	at := first.CreatedAt
	baseAt = &at
	rest := events[start:]
	if first.Kind == string(models.StockEventKindCount) {
		q := first.Quantity
		counted = &q
		rest = events[start+1:]
	}
	for _, e := range rest {
		received += e.Quantity
	}
	return baseAt, counted, received
}

func (s stockSnapshot) Remaining() *float64 {
	if !s.Tracked {
		return nil
	}
	r := s.Received - s.Consumed
	if s.CountedQuantity != nil {
		r += *s.CountedQuantity
	}
	return &r
}

func (s stockSnapshot) RemainingServings() *float64 {
	r := s.Remaining()
	if r == nil || s.Resource.PerServing <= 0 {
		return nil
	}
	v := *r / s.Resource.PerServing
	return &v
}

func (s stockSnapshot) Level() models.InventoryLevel {
	rs := s.RemainingServings()
	switch {
	case rs == nil:
		return models.InventoryLevelUntracked
	case *rs <= float64(s.Resource.Buffer):
		return models.InventoryLevelCritical
	case *rs <= float64(s.Resource.NotifyFrom):
		return models.InventoryLevelWarning
	default:
		return models.InventoryLevelOk
	}
}

// 残り杯数が属する通知の閾値。from, from-step, from-2step, …, 0 のうち
// remaining 以上で最小のもの。from より多く残っていれば nil。
//
// 例（from=500, step=100）: 520 → nil, 500 → 500, 450 → 500, 399 → 400, -3 → 0
func alertThreshold(remaining float64, from, step int) *int {
	if remaining > float64(from) {
		return nil
	}
	t := 0
	if remaining > 0 {
		t = from
		if step > 0 {
			k := int(math.Floor((float64(from) - remaining) / float64(step)))
			t = from - k*step
		}
		if t < 0 {
			t = 0
		}
	}
	return &t
}

// 通知の閾値の変化から、何をすべきか決める。
// notify: 新しく下の閾値を切ったので通知する。
// reset: 通知はしないが、残量が戻ったので記録を next に戻す。
func nextAlertState(last, next *int) (notify, reset bool) {
	switch {
	case next == nil && last == nil:
		return false, false
	case next != nil && (last == nil || *next < *last):
		return true, false
	case next == nil || *next > *last:
		return false, true
	default:
		return false, false
	}
}

func formatQuantity(v float64) string {
	if v == math.Trunc(v) {
		return fmt.Sprintf("%.0f", v)
	}
	return fmt.Sprintf("%.1f", v)
}

// 「残り約N杯（Mg）」。カップは1杯 = 1個なので「残り約N個」
func describeRemaining(s stockSnapshot) string {
	r, rs := s.Remaining(), s.RemainingServings()
	if r == nil || rs == nil {
		return "未計測"
	}
	if s.Resource.Kind == string(models.StockResourceKindCup) {
		return fmt.Sprintf("残り約%.0f個", math.Floor(*rs))
	}
	return fmt.Sprintf("残り約%.0f杯（%s%s）", math.Floor(*rs), formatQuantity(*r), s.Resource.Unit)
}

// 直近1時間のペースで、あと何時間もつか。
func describePace(s stockSnapshot) string {
	rs := s.RemainingServings()
	if rs == nil || s.ServingsLastHour == 0 {
		return ""
	}
	if *rs <= 0 {
		return fmt.Sprintf("直近1時間 %d杯", s.ServingsLastHour)
	}
	hours := *rs / float64(s.ServingsLastHour)
	return fmt.Sprintf("直近1時間 %d杯 → 約%sで切れる見込み", s.ServingsLastHour, formatDuration(time.Duration(hours*float64(time.Hour))))
}

func formatDuration(d time.Duration) string {
	m := int(d.Round(time.Minute).Minutes())
	if m < 60 {
		return fmt.Sprintf("%d分", m)
	}
	// 10 時間を超えたら分までは要らない
	if m%60 == 0 || m >= 600 {
		return fmt.Sprintf("%d時間", m/60)
	}
	return fmt.Sprintf("%d時間%d分", m/60, m%60)
}

func alertMessage(s stockSnapshot) string {
	icon := "⚠️"
	suffix := ""
	if s.Level() == models.InventoryLevelCritical {
		icon = "🚨"
		// バッファは杯数で持つが、カップは1杯 = 1個なので残量と同じく個で出す
		unit := "杯"
		if s.Resource.Kind == string(models.StockResourceKindCup) {
			unit = "個"
		}
		suffix = fmt.Sprintf("（バッファ%d%sを切りました）", s.Resource.Buffer, unit)
	}
	lines := []string{fmt.Sprintf("%s *%s* %s%s", icon, s.Resource.Name, describeRemaining(s), suffix)}
	if pace := describePace(s); pace != "" {
		lines = append(lines, "　"+pace)
	}
	return strings.Join(lines, "\n")
}

func remindMessage(snapshots []stockSnapshot, now time.Time, posURL string) string {
	lines := []string{"⏰ 在庫の残量確認の時間です。数えて POS の在庫ページに入力してください。"}
	for _, s := range snapshots {
		last := "未実施"
		if s.CountedQuantity != nil && s.BaseAt != nil {
			last = formatDuration(now.Sub(*s.BaseAt)) + "前"
		}
		lines = append(lines, fmt.Sprintf("• %s: %s（最終確認 %s）", s.Resource.Name, describeRemaining(s), last))
	}
	if posURL != "" {
		lines = append(lines, fmt.Sprintf("<%s/inventory|在庫ページを開く>", strings.TrimRight(posURL, "/")))
	}
	return strings.Join(lines, "\n")
}
