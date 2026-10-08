package caos

import (
	"cmp"
	"math"
	"slices"
	"time"
)

// 本番の抽出時間の集計（Issue #803）。抽出が終わったカードの抽出時間（finished_at - started_at）を、
// ドリッパー・杯数・時間帯（日本時間の 30 分ごと）・担当者ごとにまとめ、標準の抽出時間に対する係数を出す。
//
// ここは決まりだけで DB を使わない。カード（caos_drips）と列の担当者の交代の記録（caos_ops）は
// handlers/caos_stats.go が GORM で読んで渡す（API は GET /api/caos/brew-stats）。

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

// BrewSlotMinutes は時間帯の枠の長さ（分）。sohosai-shift の割り当て（30 分ごと）と突き合わせられるようにそろえる。
const BrewSlotMinutes = 30

// LaneChange は列の担当者が変わった時点。Lanes は、その時点から後の、変わった列の担当者（変わらなかった列は入らない）。
type LaneChange struct {
	At    time.Time
	Lanes []Lane
}

// LaneChangesOfOp は操作の記録（caos_ops）1 件から、列の担当者が変わった時点を作る。
// 操作した時刻に lanesAfter になり、「1つ戻す」で戻した操作は、戻した時刻（undoneAt）に lanesBefore へ戻る。
// 担当者を替えない操作（lanesAfter が空）は何も返さない。
func LaneChangesOfOp(createdAt time.Time, undoneAt *time.Time, lanesBefore, lanesAfter []Lane) []LaneChange {
	if len(lanesAfter) == 0 {
		return nil
	}
	changes := []LaneChange{{At: createdAt, Lanes: lanesAfter}}
	if undoneAt != nil {
		changes = append(changes, LaneChange{At: *undoneAt, Lanes: lanesBefore})
	}
	return changes
}

// BrewDay は 1 営業日分の集計の材料。
type BrewDay struct {
	// 営業日（YYYY-MM-DD）
	Day string
	// その日のカード。抽出が終わったもの（status が done で、started_at と finished_at があるもの）だけを数え、ほかは無視する
	Drips []Drip
	// 列の担当者が変わった時点（順不同）。その日の始まりは、全部の列が担当者なし
	LaneChanges []LaneChange
}

// BrewSummary は抽出時間のまとめ。
type BrewSummary struct {
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

// DripperBrewStat は日・ドリッパー（列の番号 1〜6）・杯数ごとのまとめ。
type DripperBrewStat struct {
	Day     string `json:"day"`
	Dripper int    `json:"dripper"`
	Cups    int    `json:"cups"`
	BrewSummary
}

// SlotBrewStat は日・時間帯・杯数ごとのまとめ（全部のドリッパーを合わせる）。
type SlotBrewStat struct {
	Day string `json:"day"`
	// 枠の始まり（日本時間の HH:MM。抽出を始めた時刻で分ける）
	Slot string `json:"slot"`
	Cups int    `json:"cups"`
	BrewSummary
}

// PersonBrewStat は担当者・杯数ごとのまとめ（集計した全部の日を合わせる）。
type PersonBrewStat struct {
	// 抽出を始めたときに、その列にいた担当者の名前
	Name string `json:"name"`
	Cups int    `json:"cups"`
	BrewSummary
}

// PersonSkipped は担当者ごとのまとめに入れなかったカードの数。
type PersonSkipped struct {
	// 抽出を始めたとき、その列に担当者がいなかった
	NoPerson int `json:"no_person"`
	// 抽出の途中で、その列の担当者が替わった（誰の抽出か決められない）
	Handover int `json:"handover"`
}

// RebrewStat は日・ドリッパーごとの、入れ直しと中断の数。
type RebrewStat struct {
	Day string `json:"day"`
	// 入れ直しは元のカードを淹れたドリッパー、中断はそのカードのドリッパー。元のカードが終わっていない・見つからないときは null
	Dripper *int `json:"dripper"`
	// 抽出が終わった入れ直しのカードの数
	Rebrews int `json:"rebrews"`
	// 途中でやめた抽出の数
	Interrupted int `json:"interrupted"`
	// 入れ直しで余分に使った杯数（抽出が終わった入れ直しのカードの杯数の合計）
	ExtraCups int `json:"extra_cups"`
}

// BrewStandard は係数の分母にした標準の抽出時間（秒）。
type BrewStandard struct {
	OneCupSec int `json:"one_cup_sec"`
	TwoCupSec int `json:"two_cup_sec"`
}

// BrewStats は抽出時間の集計の結果。
type BrewStats struct {
	Standard BrewStandard `json:"standard"`
	// 抽出時間のまとめに入れたカードの数（抽出が終わったカードから、入れ直しと中断を除いたもの）
	Brews     int               `json:"brews"`
	ByDripper []DripperBrewStat `json:"by_dripper"`
	BySlot    []SlotBrewStat    `json:"by_slot"`
	ByPerson  []PersonBrewStat  `json:"by_person"`
	// 担当者ごとのまとめに入れなかったカード
	PersonSkipped PersonSkipped `json:"person_skipped"`
	Rebrews       []RebrewStat  `json:"rebrews"`
}

// brewSample は抽出時間のまとめに入れるカード 1 枚。
type brewSample struct {
	seconds float64
	ratio   float64
}

func newBrewSample(d Drip) brewSample {
	sec := d.FinishedAt.Sub(*d.StartedAt).Seconds()
	return brewSample{seconds: sec, ratio: sec / float64(StandardBrewSec(d.Cups))}
}

func isFinishedBrew(d Drip) bool {
	return d.Status == StatusDone && d.StartedAt != nil && d.FinishedAt != nil && d.Dripper != nil
}

// BuildBrewStats は抽出時間を集計する。
//
// 抽出時間のまとめ（by_dripper・by_slot・by_person）には、抽出が終わったカードのうち、入れ直し（rebrew_of あり）と中断（interrupted）を除いたものを入れる。
// 入れ直しと中断は rebrews に別に数える。担当者は、抽出を始めたときにその列にいた人（列の担当者の交代の記録から出す）で、
// 抽出の途中で替わったカードと、担当者がいなかったカードは person_skipped に数える。
func BuildBrewStats(days []BrewDay) BrewStats {
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
		dripper int // 0 は不明
	}
	byDripper := map[dripperKey][]brewSample{}
	bySlot := map[slotKey][]brewSample{}
	byPerson := map[personKey][]brewSample{}
	rebrews := map[rebrewKey]*RebrewStat{}
	stats := BrewStats{Standard: BrewStandard{OneCupSec: OneCupBrewSec, TwoCupSec: TwoCupBrewSec}}

	rebrewOf := func(day string, dripper *int) *RebrewStat {
		k := rebrewKey{day: day}
		if dripper != nil {
			k.dripper = *dripper
		}
		r, ok := rebrews[k]
		if !ok {
			r = &RebrewStat{Day: day}
			if dripper != nil {
				r.Dripper = ptr(*dripper)
			}
			rebrews[k] = r
		}
		return r
	}

	for _, day := range days {
		lanes := newLaneTimeline(day.LaneChanges)
		finished := map[string]Drip{}
		for _, d := range day.Drips {
			if isFinishedBrew(d) {
				finished[d.ID] = d
			}
		}
		for _, d := range day.Drips {
			if !isFinishedBrew(d) {
				continue
			}
			if d.Interrupted {
				rebrewOf(day.Day, d.Dripper).Interrupted++
			}
			if d.RebrewOf != nil {
				// 余分に使った杯数は、元のカード（失敗した抽出）を淹れたドリッパーに数える
				var src *int
				if s, ok := finished[*d.RebrewOf]; ok {
					src = s.Dripper
				}
				r := rebrewOf(day.Day, src)
				r.Rebrews++
				r.ExtraCups += d.Cups
			}
			if d.Interrupted || d.RebrewOf != nil {
				continue
			}
			s := newBrewSample(d)
			stats.Brews++
			byDripper[dripperKey{day.Day, *d.Dripper, d.Cups}] = append(byDripper[dripperKey{day.Day, *d.Dripper, d.Cups}], s)
			sk := slotKey{day.Day, BrewSlot(*d.StartedAt), d.Cups}
			bySlot[sk] = append(bySlot[sk], s)
			name := lanes.nameAt(*d.Dripper, *d.StartedAt)
			switch {
			case lanes.changedDuring(*d.Dripper, *d.StartedAt, *d.FinishedAt):
				stats.PersonSkipped.Handover++
			case name == "":
				stats.PersonSkipped.NoPerson++
			default:
				pk := personKey{name, d.Cups}
				byPerson[pk] = append(byPerson[pk], s)
			}
		}
	}

	stats.ByDripper = make([]DripperBrewStat, 0, len(byDripper))
	for k, s := range byDripper {
		stats.ByDripper = append(stats.ByDripper, DripperBrewStat{Day: k.day, Dripper: k.dripper, Cups: k.cups, BrewSummary: summarize(s)})
	}
	slices.SortFunc(stats.ByDripper, func(a, b DripperBrewStat) int {
		return cmp.Or(cmp.Compare(a.Day, b.Day), cmp.Compare(a.Dripper, b.Dripper), cmp.Compare(a.Cups, b.Cups))
	})
	stats.BySlot = make([]SlotBrewStat, 0, len(bySlot))
	for k, s := range bySlot {
		stats.BySlot = append(stats.BySlot, SlotBrewStat{Day: k.day, Slot: k.slot, Cups: k.cups, BrewSummary: summarize(s)})
	}
	slices.SortFunc(stats.BySlot, func(a, b SlotBrewStat) int {
		return cmp.Or(cmp.Compare(a.Day, b.Day), cmp.Compare(a.Slot, b.Slot), cmp.Compare(a.Cups, b.Cups))
	})
	stats.ByPerson = make([]PersonBrewStat, 0, len(byPerson))
	for k, s := range byPerson {
		stats.ByPerson = append(stats.ByPerson, PersonBrewStat{Name: k.name, Cups: k.cups, BrewSummary: summarize(s)})
	}
	slices.SortFunc(stats.ByPerson, func(a, b PersonBrewStat) int {
		return cmp.Or(cmp.Compare(a.Name, b.Name), cmp.Compare(a.Cups, b.Cups))
	})
	stats.Rebrews = make([]RebrewStat, 0, len(rebrews))
	for _, r := range rebrews {
		stats.Rebrews = append(stats.Rebrews, *r)
	}
	slices.SortFunc(stats.Rebrews, func(a, b RebrewStat) int {
		// ドリッパーが不明な行は、その日の最後に
		da, db := 7, 7
		if a.Dripper != nil {
			da = *a.Dripper
		}
		if b.Dripper != nil {
			db = *b.Dripper
		}
		return cmp.Or(cmp.Compare(a.Day, b.Day), cmp.Compare(da, db))
	})
	return stats
}

// BrewSlot は抽出を始めた時刻の枠（日本時間の 30 分ごと）の始まりを HH:MM で返す。
func BrewSlot(startedAt time.Time) string {
	t := startedAt.In(jst)
	return time.Date(t.Year(), t.Month(), t.Day(), t.Hour(), t.Minute()/BrewSlotMinutes*BrewSlotMinutes, 0, 0, jst).Format("15:04")
}

func summarize(samples []brewSample) BrewSummary {
	n := len(samples)
	if n == 0 {
		return BrewSummary{}
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
	return BrewSummary{
		Brews: n, AvgSec: round(avg, 1), MedianSec: round(median, 1), StddevSec: round(stddev, 1),
		Coefficient: round(ratioSum/float64(n), 2),
	}
}

func round(v float64, digits int) float64 {
	p := math.Pow10(digits)
	return math.Round(v*p) / p
}

// laneTimeline は列ごとの担当者の移り変わり（時刻の順）。
type laneTimeline map[int][]laneAt

type laneAt struct {
	at   time.Time
	name string
}

func newLaneTimeline(changes []LaneChange) laneTimeline {
	sorted := slices.Clone(changes)
	slices.SortStableFunc(sorted, func(a, b LaneChange) int { return a.At.Compare(b.At) })
	t := laneTimeline{}
	for _, c := range sorted {
		for _, l := range c.Lanes {
			t[l.Dripper] = append(t[l.Dripper], laneAt{at: c.At, name: l.Name})
		}
	}
	return t
}

// nameAt は at の時点でその列にいた担当者（いなければ空）。
func (t laneTimeline) nameAt(dripper int, at time.Time) string {
	name := ""
	for _, c := range t[dripper] {
		if c.at.After(at) {
			break
		}
		name = c.name
	}
	return name
}

// changedDuring は from より後、to までに、その列の担当者が from の時点の人から替わったか。
func (t laneTimeline) changedDuring(dripper int, from, to time.Time) bool {
	name := t.nameAt(dripper, from)
	for _, c := range t[dripper] {
		if c.at.After(from) && !c.at.After(to) && c.name != name {
			return true
		}
	}
	return false
}
