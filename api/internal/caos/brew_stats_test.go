package caos

import (
	"encoding/json"
	"testing"
	"time"
)

// 抽出時間の集計（BuildBrewStats）。

var statsDayStart = time.Date(2026, 11, 1, 0, 0, 0, 0, jst)

// at は日本時間のその日の h 時 m 分 s 秒
func at(h, m, s int) time.Time {
	return statsDayStart.Add(time.Duration(h)*time.Hour + time.Duration(m)*time.Minute + time.Duration(s)*time.Second)
}

// brew は dripper で start から sec 秒かけて抽出が終わったカード
func brew(id string, dripper, cups int, start time.Time, sec int) Drip {
	end := start.Add(time.Duration(sec) * time.Second)
	return Drip{ID: id, Status: StatusDone, Dripper: ptr(dripper), Cups: cups, StartedAt: ptr(start), FinishedAt: ptr(end)}
}

func lanesAt(t time.Time, lanes ...Lane) LaneChange { return LaneChange{At: t, Lanes: lanes} }

func toJSON(t *testing.T, v any) string {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

// 標準の抽出時間は画面（caosTiming.ts）と同じ 1 杯 135 秒・2 杯 195 秒
func TestStandardBrewSec(t *testing.T) {
	if StandardBrewSec(1) != 135 || StandardBrewSec(2) != 195 {
		t.Fatalf("標準：%d %d", StandardBrewSec(1), StandardBrewSec(2))
	}
}

// 平均・中央値・標準偏差（標本）・係数（1 件ごとの 実際 ÷ 標準 の平均）
func TestBrewSummary(t *testing.T) {
	got := summarize([]brewSample{
		newBrewSample(brew("a", 1, 1, at(10, 0, 0), 120)),
		newBrewSample(brew("b", 1, 1, at(10, 5, 0), 150)),
		newBrewSample(brew("c", 1, 1, at(10, 10, 0), 180)),
		newBrewSample(brew("d", 1, 1, at(10, 15, 0), 150)),
	})
	// 平均 150、中央値 (150+150)/2、標準偏差 sqrt((900+0+900+0)/3)=24.49…、係数 150/135=1.111…
	want := BrewSummary{Brews: 4, AvgSec: 150, MedianSec: 150, StddevSec: 24.5, Coefficient: 1.11}
	if got != want {
		t.Fatalf("まとめ：%+v", got)
	}
	if one := summarize([]brewSample{newBrewSample(brew("a", 1, 2, at(10, 0, 0), 234))}); one != (BrewSummary{Brews: 1, AvgSec: 234, MedianSec: 234, Coefficient: 1.2}) {
		t.Fatalf("1 件なら標準偏差は 0、2 杯は 195 秒で割る：%+v", one)
	}
	// 杯数が混ざっても、係数は 1 件ごとの比の平均（135 秒の 1 杯と 195 秒の 2 杯なら 1.00）
	if mixed := summarize([]brewSample{newBrewSample(brew("a", 1, 1, at(10, 0, 0), 135)), newBrewSample(brew("b", 1, 2, at(10, 5, 0), 195))}); mixed.Coefficient != 1 {
		t.Fatalf("杯数が混ざったとき：%+v", mixed)
	}
}

// ドリッパー・杯数ごと、時間帯（日本時間の 30 分ごと）ごとにまとめる。抽出が終わっていないカードは数えない
func TestBuildBrewStatsGroups(t *testing.T) {
	stats := BuildBrewStats([]BrewDay{{
		Day: "2026-11-01",
		Drips: []Drip{
			brew("a", 2, 1, at(10, 29, 0), 150),
			brew("b", 2, 1, at(10, 30, 0), 140),
			brew("c", 1, 2, at(10, 0, 0), 195),
			// 抽出中・待機中・時刻の無いカードは数えない
			{ID: "x", Status: StatusBrewing, Dripper: ptr(1), Cups: 1, StartedAt: ptr(at(11, 0, 0))},
			{ID: "y", Status: StatusQueued, Dripper: ptr(1), Cups: 1},
			{ID: "z", Status: StatusDone, Dripper: ptr(1), Cups: 1},
		},
	}})
	if stats.Brews != 3 || stats.Standard != (BrewStandard{OneCupSec: 135, TwoCupSec: 195}) {
		t.Fatalf("件数と標準：%+v", stats)
	}
	if got := toJSON(t, stats.ByDripper); got != `[{"day":"2026-11-01","dripper":1,"cups":2,"brews":1,"avg_sec":195,"median_sec":195,"stddev_sec":0,"coefficient":1},`+
		`{"day":"2026-11-01","dripper":2,"cups":1,"brews":2,"avg_sec":145,"median_sec":145,"stddev_sec":7.1,"coefficient":1.07}]` {
		t.Fatalf("ドリッパー・杯数ごと：%s", got)
	}
	if got := toJSON(t, stats.BySlot); got != `[{"day":"2026-11-01","slot":"10:00","cups":1,"brews":1,"avg_sec":150,"median_sec":150,"stddev_sec":0,"coefficient":1.11},`+
		`{"day":"2026-11-01","slot":"10:00","cups":2,"brews":1,"avg_sec":195,"median_sec":195,"stddev_sec":0,"coefficient":1},`+
		`{"day":"2026-11-01","slot":"10:30","cups":1,"brews":1,"avg_sec":140,"median_sec":140,"stddev_sec":0,"coefficient":1.04}]` {
		t.Fatalf("時間帯ごと（10:29 は 10:00 の枠、10:30 は 10:30 の枠）：%s", got)
	}
	// 担当者の交代の記録が無ければ、全部「担当者なし」
	if len(stats.ByPerson) != 0 || stats.PersonSkipped != (PersonSkipped{NoPerson: 3}) {
		t.Fatalf("担当者なし：%+v %+v", stats.ByPerson, stats.PersonSkipped)
	}
	if len(stats.Rebrews) != 0 {
		t.Fatalf("入れ直しなし：%+v", stats.Rebrews)
	}
}

// 時間帯は日本時間で分ける（UTC の時刻で渡しても同じ）
func TestBrewSlotIsJST(t *testing.T) {
	if got := BrewSlot(time.Date(2026, 11, 1, 1, 45, 10, 0, time.UTC)); got != "10:30" {
		t.Fatalf("UTC 1:45 は日本時間 10:45 → 10:30 の枠：%s", got)
	}
}

// 入れ直しと中断は抽出時間のまとめから除き、別に数える。余分な杯数は元のカードを淹れたドリッパーに数える
func TestBuildBrewStatsRebrews(t *testing.T) {
	interrupted := brew("src1", 3, 2, at(12, 0, 0), 60)
	interrupted.Interrupted = true
	redo := brew("redo1", 4, 1, at(12, 2, 0), 140) // ドリッパー 3 の中断の入れ直しを、ドリッパー 4 が淹れた
	redo.RebrewOf = ptr("src1")
	src2 := brew("src2", 3, 2, at(12, 10, 0), 200)
	redo2 := brew("redo2", 3, 2, at(12, 15, 0), 200) // 終わったカードの入れ直し（中断なし）
	redo2.RebrewOf = ptr("src2")
	orphan := brew("redo3", 5, 1, at(12, 20, 0), 130) // 元のカードがまだ終わっていない
	orphan.RebrewOf = ptr("still-brewing")
	pending := Drip{ID: "redo4", Status: StatusQueued, Dripper: ptr(3), Cups: 2, RebrewOf: ptr("src2")} // まだ淹れていない入れ直しは数えない

	stats := BuildBrewStats([]BrewDay{{Day: "2026-11-01", Drips: []Drip{interrupted, redo, src2, redo2, orphan, pending}}})
	if stats.Brews != 1 || len(stats.ByDripper) != 1 || stats.ByDripper[0].Dripper != 3 || stats.ByDripper[0].AvgSec != 200 {
		t.Fatalf("まとめに入るのは src2 だけ：%+v", stats.ByDripper)
	}
	if got := toJSON(t, stats.Rebrews); got != `[{"day":"2026-11-01","dripper":3,"rebrews":2,"interrupted":1,"extra_cups":3},`+
		`{"day":"2026-11-01","dripper":null,"rebrews":1,"interrupted":0,"extra_cups":1}]` {
		t.Fatalf("入れ直しと中断：%s", got)
	}
}

// 担当者は、抽出を始めたときにその列にいた人。途中で替わったカードは担当者ごとのまとめに入れない。
// 「1つ戻す」で戻した交代は、戻した時刻に元の担当者へ戻る
func TestBuildBrewStatsByPerson(t *testing.T) {
	changes := []LaneChange{}
	// 9:00 に列 1 を山田、列 2 を佐藤にする
	changes = append(changes, LaneChangesOfOp(at(9, 0, 0), nil, []Lane{{Dripper: 1}}, []Lane{{Dripper: 1, Name: "山田"}})...)
	changes = append(changes, LaneChangesOfOp(at(9, 0, 1), nil, []Lane{{Dripper: 2}}, []Lane{{Dripper: 2, Name: "佐藤"}})...)
	// 10:00 に列 1 と列 2 を入れ替える
	changes = append(changes, LaneChangesOfOp(at(10, 0, 0), nil,
		[]Lane{{Dripper: 1, Name: "山田"}, {Dripper: 2, Name: "佐藤"}}, []Lane{{Dripper: 1, Name: "佐藤"}, {Dripper: 2, Name: "山田"}})...)
	// 11:00 に列 1 を鈴木にしたが、11:10 に戻した（佐藤に戻る）
	undone := at(11, 10, 0)
	changes = append(changes, LaneChangesOfOp(at(11, 0, 0), &undone, []Lane{{Dripper: 1, Name: "佐藤"}}, []Lane{{Dripper: 1, Name: "鈴木"}})...)
	// 担当者を替えない操作は何も足さない
	if c := LaneChangesOfOp(at(11, 30, 0), nil, nil, nil); c != nil {
		t.Fatalf("交代でない操作：%+v", c)
	}
	// 順不同で渡しても、時刻の順に並べて使う
	changes[0], changes[len(changes)-1] = changes[len(changes)-1], changes[0]

	stats := BuildBrewStats([]BrewDay{{Day: "2026-11-01", LaneChanges: changes, Drips: []Drip{
		brew("a", 1, 1, at(8, 50, 0), 140),  // 担当者なし
		brew("b", 1, 1, at(9, 30, 0), 150),  // 山田
		brew("c", 2, 1, at(9, 30, 0), 135),  // 佐藤
		brew("d", 1, 1, at(9, 59, 0), 150),  // 途中で入れ替え → 数えない
		brew("e", 2, 2, at(10, 30, 0), 234), // 山田（入れ替えのあと）
		brew("f", 1, 1, at(11, 5, 0), 135),  // 鈴木（戻す前）
		brew("g", 1, 1, at(11, 9, 0), 162),  // 途中で戻した → 数えない
		brew("h", 1, 1, at(11, 20, 0), 135), // 佐藤（戻したあと）
	}}})
	if got := toJSON(t, stats.ByPerson); got != `[{"name":"佐藤","cups":1,"brews":2,"avg_sec":135,"median_sec":135,"stddev_sec":0,"coefficient":1},`+
		`{"name":"山田","cups":1,"brews":1,"avg_sec":150,"median_sec":150,"stddev_sec":0,"coefficient":1.11},`+
		`{"name":"山田","cups":2,"brews":1,"avg_sec":234,"median_sec":234,"stddev_sec":0,"coefficient":1.2},`+
		`{"name":"鈴木","cups":1,"brews":1,"avg_sec":135,"median_sec":135,"stddev_sec":0,"coefficient":1}]` {
		t.Fatalf("担当者ごと：%s", got)
	}
	if stats.PersonSkipped != (PersonSkipped{NoPerson: 1, Handover: 2}) {
		t.Fatalf("担当者ごとに入れなかったカード：%+v", stats.PersonSkipped)
	}
}

// 担当者は日ごと（前の日の担当者は次の日に持ち越さない）。担当者ごとのまとめは日をまたいで合わせる
func TestBuildBrewStatsPersonAcrossDays(t *testing.T) {
	next := statsDayStart.AddDate(0, 0, 1)
	stats := BuildBrewStats([]BrewDay{
		{Day: "2026-11-01", LaneChanges: []LaneChange{lanesAt(at(9, 0, 0), Lane{Dripper: 1, Name: "山田"})}, Drips: []Drip{brew("a", 1, 1, at(10, 0, 0), 140)}},
		{Day: "2026-11-02", LaneChanges: []LaneChange{lanesAt(next.Add(9*time.Hour), Lane{Dripper: 2, Name: "山田"})}, Drips: []Drip{
			brew("b", 1, 1, next.Add(10*time.Hour), 140), // 列 1 はこの日は担当者なし
			brew("c", 2, 1, next.Add(10*time.Hour), 160),
		}},
	})
	if len(stats.ByPerson) != 1 || stats.ByPerson[0].Brews != 2 || stats.ByPerson[0].AvgSec != 150 || stats.PersonSkipped.NoPerson != 1 {
		t.Fatalf("日をまたいだ担当者：%+v %+v", stats.ByPerson, stats.PersonSkipped)
	}
	if len(stats.ByDripper) != 3 || stats.ByDripper[0].Day != "2026-11-01" {
		t.Fatalf("ドリッパーごとは日ごと：%+v", stats.ByDripper)
	}
}

// 何も無ければ空の配列（JSON で null にしない）
func TestBuildBrewStatsEmpty(t *testing.T) {
	got := toJSON(t, BuildBrewStats(nil))
	want := `{"standard":{"one_cup_sec":135,"two_cup_sec":195},"brews":0,"by_dripper":[],"by_slot":[],"by_person":[],"person_skipped":{"no_person":0,"handover":0},"rebrews":[]}`
	if got != want {
		t.Fatalf("空：%s", got)
	}
}
