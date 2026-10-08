// Package caosstats は CaOS の本番の抽出時間の集計（Issue #803）。DB を使わない純粋な関数だけを置く。
//
// 材料は注文のカップの CaOS の列（order_cups の drip_id・dripper・brew_started_at・brew_finished_at・
// emergency_at・emergency_drip_id）と、その日のドリッパーの担当者（caos_lanes）。読むのは handlers/caos_brew_stats.go（GORM）で、
// API は GET /api/caos/brew-stats。
//
// 今の設計で分からないこと（TODO。集計の結果にも数を出す）：
//   - 緊急（CaOS10）にしたカップは、最初の抽出の dripper・brew_started_at・brew_finished_at が空に戻り、入れ直しの値で上書きされる
//     （drip_id だけ残る）。なので、カードのカップが全部緊急になった最初の抽出は数えられない（uncounted_original_brews）。
//     中断（抽出中に緊急にした）と、終わってから緊急にした、も区別できない
//   - 担当者（caos_lanes）は日・ドリッパーごとに今の 1 行（name と、最後に替えた updated_at）しか無く、交代の記録が無い。
//     抽出を始めたあとに替わったドリッパーの抽出は、誰が淹れたか分からない（person_skipped.unknown）。今の担当者を当てはめることはしない
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
	// カード（同じ値のカップが 1 枚のカード）。緊急のカップでも、最初に淹れたカードとして残る
	DripID         *uuid.UUID
	Dripper        *int
	BrewStartedAt  *time.Time
	BrewFinishedAt *time.Time
	// 緊急（入れ直し）。緊急のカップの CaOS の列（dripper・時刻）は入れ直しのカード（EmergencyDripID）の値
	EmergencyAt     *time.Time
	EmergencyDripID *uuid.UUID
}

// Lane はその日のそのドリッパーの担当者（caos_lanes の 1 行）。行が無いドリッパーは、その日ずっと担当者なし。
type Lane struct {
	Day     string
	Dripper int
	// 担当者の名前（空なら担当者なし）
	Name string
	// 最後に替えた時刻。これより前の担当者は分からない
	UpdatedAt time.Time
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
	// 抽出を始めたとき、そのドリッパーに担当者がいなかった
	NoPerson int `json:"no_person"`
	// 抽出を始めたあとに、そのドリッパーの担当者を替えている（交代の記録が無いので、始めたときの担当者が分からない）
	Unknown int `json:"unknown"`
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
	// 抽出時間のまとめに入れたカードの数（抽出が終わったカード。入れ直しのカードは除く）
	Brews     int           `json:"brews"`
	ByDripper []DripperStat `json:"by_dripper"`
	BySlot    []SlotStat    `json:"by_slot"`
	ByPerson  []PersonStat  `json:"by_person"`
	// 担当者ごとのまとめに入れなかったカード
	PersonSkipped PersonSkipped `json:"person_skipped"`
	Rebrews       []RebrewStat  `json:"rebrews"`
	// 緊急で最初の抽出の時刻が上書きされて数えられなかったカードの数（カードのカップが全部緊急になったもの）
	UncountedOriginalBrews int `json:"uncounted_original_brews"`
}

// card は 1 枚のカード（同じ drip_id、緊急のカップは同じ emergency_drip_id のカップ）。
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

// finishedCard はカードの最初のカップ（同じカードのカップは同じ値）から、抽出が終わったカードを作る。終わっていなければ false
func finishedCard(c Cup, cups int) (card, bool) {
	if c.Dripper == nil || c.BrewStartedAt == nil || c.BrewFinishedAt == nil {
		return card{}, false
	}
	return card{day: c.Day, dripper: *c.Dripper, cups: cups, start: *c.BrewStartedAt, finish: *c.BrewFinishedAt}, true
}

// Build は抽出時間を集計する。
//
//   - 抽出時間のまとめ（by_dripper・by_slot・by_person）：抽出が終わったふつうのカード（緊急でないカップの drip_id ごと）の
//     brew_finished_at - brew_started_at。杯数は、その drip_id のカップの数（あとで緊急にしたカップも、最初の抽出で淹れたので数える）
//   - 入れ直し（緊急のカップの emergency_drip_id ごと）は、まとめから除いて rebrews に数える（入れ直しを淹れたドリッパーに数える）
//   - 担当者は、その日のそのドリッパーの担当者が、抽出を始めた時刻より前に替えたきりなら、その人。
//     行が無い・名前が空なら担当者なし、始めたあとに替えていれば分からない（person_skipped）
func Build(cups []Cup, lanes []Lane) BrewStats {
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
	type laneKey struct {
		day     string
		dripper int
	}

	// カードごとのカップ（ふつうのカードは drip_id、入れ直しのカードは emergency_drip_id）
	var normalIDs, rebrewIDs []uuid.UUID
	normal := map[uuid.UUID][]Cup{}
	rebrew := map[uuid.UUID][]Cup{}
	// drip_id ごとのカップの数（緊急にしたカップも含める＝最初の抽出の杯数）
	original := map[uuid.UUID]int{}
	for _, c := range cups {
		if c.DripID != nil {
			original[*c.DripID]++
		}
		switch {
		case c.EmergencyAt == nil && c.DripID != nil:
			if _, ok := normal[*c.DripID]; !ok {
				normalIDs = append(normalIDs, *c.DripID)
			}
			normal[*c.DripID] = append(normal[*c.DripID], c)
		case c.EmergencyAt != nil && c.EmergencyDripID != nil:
			if _, ok := rebrew[*c.EmergencyDripID]; !ok {
				rebrewIDs = append(rebrewIDs, *c.EmergencyDripID)
			}
			rebrew[*c.EmergencyDripID] = append(rebrew[*c.EmergencyDripID], c)
		}
	}

	laneOf := map[laneKey]Lane{}
	for _, l := range lanes {
		laneOf[laneKey{l.Day, l.Dripper}] = l
	}

	stats := BrewStats{Standard: Standard{OneCupSec: OneCupBrewSec, TwoCupSec: TwoCupBrewSec}}
	byDripper := map[dripperKey][]sample{}
	bySlot := map[slotKey][]sample{}
	byPerson := map[personKey][]sample{}
	rebrews := map[rebrewKey]*RebrewStat{}

	for _, id := range normalIDs {
		c, ok := finishedCard(normal[id][0], original[id])
		if !ok {
			continue
		}
		s := c.sample()
		stats.Brews++
		dk := dripperKey{c.day, c.dripper, c.cups}
		byDripper[dk] = append(byDripper[dk], s)
		sk := slotKey{c.day, Slot(c.start), c.cups}
		bySlot[sk] = append(bySlot[sk], s)
		lane, ok := laneOf[laneKey{c.day, c.dripper}]
		switch {
		case !ok:
			stats.PersonSkipped.NoPerson++
		case lane.UpdatedAt.After(c.start):
			stats.PersonSkipped.Unknown++
		case lane.Name == "":
			stats.PersonSkipped.NoPerson++
		default:
			pk := personKey{lane.Name, c.cups}
			byPerson[pk] = append(byPerson[pk], s)
		}
	}

	for _, id := range rebrewIDs {
		c, ok := finishedCard(rebrew[id][0], len(rebrew[id]))
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

	// 最初の抽出が数えられないカード：緊急のカップの drip_id で、緊急でないカップが 1 杯も残っていないもの
	lost := map[uuid.UUID]bool{}
	for _, c := range cups {
		if c.EmergencyAt != nil && c.DripID != nil && len(normal[*c.DripID]) == 0 {
			lost[*c.DripID] = true
		}
	}
	stats.UncountedOriginalBrews = len(lost)

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
