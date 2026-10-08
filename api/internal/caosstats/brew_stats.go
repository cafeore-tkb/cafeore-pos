// Package caosstats は CaOS の本番の抽出時間の集計（Issue #803）。DB を使わない純粋な関数だけを置く。
//
// 材料は注文のカップの CaOS の列（order_cups の最初の抽出の drip_id・dripper・brew_started_at・brew_finished_at と、
// 緊急（入れ直し）の emergency_at・emergency_drip_id・emergency_dripper・emergency_brew_started_at・emergency_brew_finished_at）と、
// ドリッパーの担当者の交代の記録（caos_lane_changes）。読むのは handlers/caos_brew_stats.go（GORM）で、API は GET /api/caos/brew-stats。
package caosstats

import (
	"cmp"
	"math"
	"slices"
	"time"

	"github.com/google/uuid"
)

var jst = time.FixedZone("JST", 9*60*60)

// 標準の抽出時間（秒）。係数の分母に使う。
// 画面の modules/common/src/lib/caosTiming.ts の ONE_CUP_BREW_SEC・TWO_CUP_BREW_SEC（予定時刻の計算に使う）と同じ値にしておくこと。
const (
	OneCupBrewSec = 135
	TwoCupBrewSec = 195
)

// StandardBrewSec は杯数ごとの標準の抽出時間（秒）。画面の caosTiming.ts の brewDurationSec と同じ。
func StandardBrewSec(cups int) int {
	if cups > 1 {
		return TwoCupBrewSec
	}
	return OneCupBrewSec
}

// SlotMinutes は時間帯の枠の長さ（分）。sohosai-shift の割り当て（30 分ごと）と突き合わせられるようにそろえる。
const SlotMinutes = 30

// Cup は注文のカップ 1 杯の CaOS の列（order_cups の同じ名前の列）。
type Cup struct {
	// 営業日（注文を作った日。日本時間の YYYY-MM-DD。CaOS の盤面の「今日」と同じ区切り）
	Day string
	// 最初の抽出（同じ drip_id のカップが 1 枚のカード）。緊急にしても残る
	DripID         *uuid.UUID
	Dripper        *int
	BrewStartedAt  *time.Time
	BrewFinishedAt *time.Time
	// 緊急（入れ直し）。入れ直しのカード（同じ emergency_drip_id のカップ）の列
	EmergencyAt             *time.Time
	EmergencyDripID         *uuid.UUID
	EmergencyDripper        *int
	EmergencyBrewStartedAt  *time.Time
	EmergencyBrewFinishedAt *time.Time
}

// LaneChange は担当者の交代の記録（caos_lane_changes の 1 行）。入れ替えはドリッパーごとに 1 行ずつ。
type LaneChange struct {
	Day     string
	Dripper int
	// 替えた時刻（サーバーの時刻）
	ChangedAt time.Time
	// 替えたあとの担当者の名前（空なら担当者なし）
	Name string
}

// Summary は抽出時間のまとめ。
type Summary struct {
	// 件数
	Brews int `json:"brews"`
	// 抽出時間（秒）の平均・中央値・標準偏差（標本。1 件なら 0）。小数 1 桁に丸める
	AvgSec    float64 `json:"avg_sec"`
	MedianSec float64 `json:"median_sec"`
	StddevSec float64 `json:"stddev_sec"`
	// 係数：1 件ごとの「実際の抽出時間 ÷ 標準の抽出時間」の平均。1 より大きいほど遅い。小数 2 桁に丸める
	// （杯数をそろえた集まりなら「平均 ÷ 標準」と同じ）
	Coefficient float64 `json:"coefficient"`
}

// DripperStat は日・ドリッパー・杯数ごとのまとめ。
type DripperStat struct {
	Day     string `json:"day"`
	Dripper int    `json:"dripper"`
	Cups    int    `json:"cups"`
	Summary
}

// SlotStat は日・時間帯・杯数ごとのまとめ（全部のドリッパーを合わせる）。
type SlotStat struct {
	Day string `json:"day"`
	// 枠の始まり（日本時間の HH:MM。抽出を始めた時刻で分ける）
	Slot string `json:"slot"`
	Cups int    `json:"cups"`
	Summary
}

// PersonStat は担当者・杯数ごとのまとめ（集計した全部の日を合わせる）。
type PersonStat struct {
	// 抽出を始めたときに、そのドリッパーにいた担当者の名前
	Name string `json:"name"`
	Cups int    `json:"cups"`
	Summary
}

// PersonSkipped は担当者ごとのまとめに入れなかった抽出の数。
type PersonSkipped struct {
	// 抽出を始めたとき、そのドリッパーに担当者がいなかった（その日のそれより前の交代の記録が無い・名前が空）
	NoPerson int `json:"no_person"`
}

// RebrewStat は日・ドリッパー（入れ直しを淹れたドリッパー）ごとの、抽出が終わった入れ直しのカードの数。
type RebrewStat struct {
	Day     string `json:"day"`
	Dripper int    `json:"dripper"`
	// 抽出が終わった入れ直しのカードの数
	Rebrews int `json:"rebrews"`
	// 入れ直しで余分に使った杯数（抽出が終わった入れ直しのカードの杯数の合計）
	ExtraCups int `json:"extra_cups"`
}

// Standard は係数の分母にした標準の抽出時間（秒）。
type Standard struct {
	OneCupSec int `json:"one_cup_sec"`
	TwoCupSec int `json:"two_cup_sec"`
}

// BrewStats は抽出時間の集計の結果。
type BrewStats struct {
	Standard Standard `json:"standard"`
	// 抽出時間のまとめに入れたカードの数（抽出が終わった最初の抽出のカード。入れ直しのカードは除く）
	Brews     int           `json:"brews"`
	ByDripper []DripperStat `json:"by_dripper"`
	BySlot    []SlotStat    `json:"by_slot"`
	ByPerson  []PersonStat  `json:"by_person"`
	// 担当者ごとのまとめに入れなかったカード
	PersonSkipped PersonSkipped `json:"person_skipped"`
	Rebrews       []RebrewStat  `json:"rebrews"`
	// 抽出を始めたが終える前に中断した（カードのカップを全部緊急にした）最初の抽出のカードの数。抽出時間のまとめには入れない
	InterruptedBrews int `json:"interrupted_brews"`
}

// card は 1 枚のカード（最初の抽出は同じ drip_id、入れ直しは同じ emergency_drip_id のカップ）。
type card struct {
	day     string
	dripper int
	cups    int
	start   time.Time
	finish  time.Time
}

func (c card) sample() sample {
	sec := c.finish.Sub(c.start).Seconds()
	return sample{seconds: sec, ratio: sec / float64(StandardBrewSec(c.cups))}
}

type sample struct {
	seconds float64
	ratio   float64
}

// firstBrew は同じ drip_id のカップから、最初の抽出のカードを作る。淹れた杯数は抽出を始めたカップの数
// （待機のうちに緊急にしたカップは始めていないので入れない）。抽出を始めていなければ ok = false。
// 終えていなければ finished = false（抽出中か、中断した）。
func firstBrew(cups []Cup) (c card, ok, finished bool) {
	for _, cup := range cups {
		if cup.Dripper == nil || cup.BrewStartedAt == nil {
			continue
		}
		if !ok {
			c = card{day: cup.Day, dripper: *cup.Dripper, start: *cup.BrewStartedAt}
			if cup.BrewFinishedAt != nil {
				c.finish, finished = *cup.BrewFinishedAt, true
			}
			ok = true
		}
		c.cups++
	}
	return c, ok, finished
}

// rebrewOf は同じ emergency_drip_id のカップから、抽出が終わった入れ直しのカードを作る。終わっていなければ false
func rebrewOf(cups []Cup) (card, bool) {
	c := cups[0]
	if c.EmergencyDripper == nil || c.EmergencyBrewStartedAt == nil || c.EmergencyBrewFinishedAt == nil {
		return card{}, false
	}
	return card{day: c.Day, dripper: *c.EmergencyDripper, cups: len(cups), start: *c.EmergencyBrewStartedAt, finish: *c.EmergencyBrewFinishedAt}, true
}

// personAt は day の dripper の、at の時点の担当者（at までの最後の交代のあとの名前）。交代の記録が無ければ空（担当者なし）。
// changes は替えた順（同じ時刻なら記録した順）。
func personAt(changes []LaneChange, day string, dripper int, at time.Time) string {
	name := ""
	for _, ch := range changes {
		if ch.Day == day && ch.Dripper == dripper && !ch.ChangedAt.After(at) {
			name = ch.Name
		}
	}
	return name
}

// Build は抽出時間を集計する。
//
//   - 抽出時間のまとめ（by_dripper・by_slot・by_person）：抽出が終わった最初の抽出のカード（drip_id ごと）の
//     brew_finished_at - brew_started_at。杯数は、そのカードで抽出を始めたカップの数（あとで緊急にしたカップも、最初の抽出で淹れたので数える）。
//     抽出を始めたが終えずに中断したカード（カップが全部緊急）は interrupted_brews に数える
//   - 入れ直し（緊急のカップの emergency_drip_id ごと。emergency_dripper・emergency_brew_*）は、まとめから除いて rebrews に数える
//     （入れ直しを淹れたドリッパーに数える）
//   - 担当者は交代の記録（changes。替えた順）から、抽出を始めた時刻にそのドリッパーにいた人。記録が無い・名前が空なら担当者なし（person_skipped）
func Build(cups []Cup, changes []LaneChange) BrewStats {
	type dripperKey struct {
		day           string
		dripper, cups int
	}
	type slotKey struct {
		day, slot string
		cups      int
	}
	type personKey struct {
		name string
		cups int
	}
	type rebrewKey struct {
		day     string
		dripper int
	}

	// カードごとのカップ（最初の抽出は drip_id、入れ直しは emergency_drip_id）
	var firstIDs, rebrewIDs []uuid.UUID
	first := map[uuid.UUID][]Cup{}
	rebrew := map[uuid.UUID][]Cup{}
	for _, c := range cups {
		if c.DripID != nil {
			if _, ok := first[*c.DripID]; !ok {
				firstIDs = append(firstIDs, *c.DripID)
			}
			first[*c.DripID] = append(first[*c.DripID], c)
		}
		if c.EmergencyAt != nil && c.EmergencyDripID != nil {
			if _, ok := rebrew[*c.EmergencyDripID]; !ok {
				rebrewIDs = append(rebrewIDs, *c.EmergencyDripID)
			}
			rebrew[*c.EmergencyDripID] = append(rebrew[*c.EmergencyDripID], c)
		}
	}

	stats := BrewStats{Standard: Standard{OneCupSec: OneCupBrewSec, TwoCupSec: TwoCupBrewSec}}
	byDripper := map[dripperKey][]sample{}
	bySlot := map[slotKey][]sample{}
	byPerson := map[personKey][]sample{}
	rebrews := map[rebrewKey]*RebrewStat{}

	for _, id := range firstIDs {
		c, ok, finished := firstBrew(first[id])
		if !ok {
			continue
		}
		if !finished {
			// 中断：抽出を始めたカップが全部緊急（緊急でないカップが残っていれば、まだ抽出中）
			if !slices.ContainsFunc(first[id], func(cup Cup) bool { return cup.BrewStartedAt != nil && cup.EmergencyAt == nil }) {
				stats.InterruptedBrews++
			}
			continue
		}
		s := c.sample()
		stats.Brews++
		dk := dripperKey{c.day, c.dripper, c.cups}
		byDripper[dk] = append(byDripper[dk], s)
		sk := slotKey{c.day, Slot(c.start), c.cups}
		bySlot[sk] = append(bySlot[sk], s)
		if name := personAt(changes, c.day, c.dripper, c.start); name == "" {
			stats.PersonSkipped.NoPerson++
		} else {
			pk := personKey{name, c.cups}
			byPerson[pk] = append(byPerson[pk], s)
		}
	}

	for _, id := range rebrewIDs {
		c, ok := rebrewOf(rebrew[id])
		if !ok {
			continue
		}
		k := rebrewKey{c.day, c.dripper}
		r, ok := rebrews[k]
		if !ok {
			r = &RebrewStat{Day: c.day, Dripper: c.dripper}
			rebrews[k] = r
		}
		r.Rebrews++
		r.ExtraCups += c.cups
	}

	stats.ByDripper = make([]DripperStat, 0, len(byDripper))
	for k, s := range byDripper {
		stats.ByDripper = append(stats.ByDripper, DripperStat{Day: k.day, Dripper: k.dripper, Cups: k.cups, Summary: summarize(s)})
	}
	slices.SortFunc(stats.ByDripper, func(a, b DripperStat) int {
		return cmp.Or(cmp.Compare(a.Day, b.Day), cmp.Compare(a.Dripper, b.Dripper), cmp.Compare(a.Cups, b.Cups))
	})
	stats.BySlot = make([]SlotStat, 0, len(bySlot))
	for k, s := range bySlot {
		stats.BySlot = append(stats.BySlot, SlotStat{Day: k.day, Slot: k.slot, Cups: k.cups, Summary: summarize(s)})
	}
	slices.SortFunc(stats.BySlot, func(a, b SlotStat) int {
		return cmp.Or(cmp.Compare(a.Day, b.Day), cmp.Compare(a.Slot, b.Slot), cmp.Compare(a.Cups, b.Cups))
	})
	stats.ByPerson = make([]PersonStat, 0, len(byPerson))
	for k, s := range byPerson {
		stats.ByPerson = append(stats.ByPerson, PersonStat{Name: k.name, Cups: k.cups, Summary: summarize(s)})
	}
	slices.SortFunc(stats.ByPerson, func(a, b PersonStat) int {
		return cmp.Or(cmp.Compare(a.Name, b.Name), cmp.Compare(a.Cups, b.Cups))
	})
	stats.Rebrews = make([]RebrewStat, 0, len(rebrews))
	for _, r := range rebrews {
		stats.Rebrews = append(stats.Rebrews, *r)
	}
	slices.SortFunc(stats.Rebrews, func(a, b RebrewStat) int {
		return cmp.Or(cmp.Compare(a.Day, b.Day), cmp.Compare(a.Dripper, b.Dripper))
	})
	return stats
}

// Slot は抽出を始めた時刻の枠（日本時間の 30 分ごと）の始まりを HH:MM で返す。
func Slot(startedAt time.Time) string {
	t := startedAt.In(jst)
	return time.Date(t.Year(), t.Month(), t.Day(), t.Hour(), t.Minute()/SlotMinutes*SlotMinutes, 0, 0, jst).Format("15:04")
}

// Day は時刻の営業日（日本時間の YYYY-MM-DD）。
func Day(t time.Time) string { return t.In(jst).Format(time.DateOnly) }

// DayRange は営業日（日本時間の YYYY-MM-DD）の始まりと終わり（次の日の始まり）。形が違えばエラー。
func DayRange(day string) (time.Time, time.Time, error) {
	start, err := time.ParseInLocation(time.DateOnly, day, jst)
	if err != nil {
		return time.Time{}, time.Time{}, err
	}
	return start, start.AddDate(0, 0, 1), nil
}

func summarize(samples []sample) Summary {
	n := len(samples)
	if n == 0 {
		return Summary{}
	}
	secs := make([]float64, n)
	var sum, ratioSum float64
	for i, s := range samples {
		secs[i] = s.seconds
		sum += s.seconds
		ratioSum += s.ratio
	}
	avg := sum / float64(n)
	slices.Sort(secs)
	median := secs[n/2]
	if n%2 == 0 {
		median = (secs[n/2-1] + secs[n/2]) / 2
	}
	var stddev float64
	if n > 1 {
		var sq float64
		for _, s := range secs {
			sq += (s - avg) * (s - avg)
		}
		stddev = math.Sqrt(sq / float64(n-1))
	}
	return Summary{
		Brews: n, AvgSec: round(avg, 1), MedianSec: round(median, 1), StddevSec: round(stddev, 1),
		Coefficient: round(ratioSum/float64(n), 2),
	}
}

func round(v float64, digits int) float64 {
	p := math.Pow10(digits)
	return math.Round(v*p) / p
}
