package caosstats

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/google/uuid"
)

// 抽出時間の集計（Build）の単体テスト。DB は使わない。

const day = "2026-11-01"

var dayStart = time.Date(2026, 11, 1, 0, 0, 0, 0, jst)

// at は日本時間のその日の h 時 m 分 s 秒
func at(h, m, s int) time.Time {
	return dayStart.Add(time.Duration(h)*time.Hour + time.Duration(m)*time.Minute + time.Duration(s)*time.Second)
}

func ptr[T any](v T) *T { return &v }

// brew は dripper で start から sec 秒かけて抽出が終わったカード（cups 杯）のカップ
func brew(dripper, cups int, start time.Time, sec int) []Cup {
	id := uuid.New()
	end := start.Add(time.Duration(sec) * time.Second)
	out := make([]Cup, cups)
	for i := range out {
		out[i] = Cup{Day: day, DripID: ptr(id), Dripper: ptr(dripper), BrewStartedAt: ptr(start), BrewFinishedAt: ptr(end)}
	}
	return out
}

func toJSON(t *testing.T, v any) string {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func concat(groups ...[]Cup) []Cup {
	var out []Cup
	for _, g := range groups {
		out = append(out, g...)
	}
	return out
}

// 標準の抽出時間は画面（caosTiming.ts）と同じ 1 杯 135 秒・2 杯 195 秒
func TestStandardBrewSec(t *testing.T) {
	if StandardBrewSec(1) != 135 || StandardBrewSec(2) != 195 {
		t.Fatalf("標準：%d %d", StandardBrewSec(1), StandardBrewSec(2))
	}
}

// 平均・中央値・標準偏差（標本）・係数（1 件ごとの 実際 ÷ 標準 の平均）
func TestSummarize(t *testing.T) {
	s := func(cups, sec int) sample {
		return card{cups: cups, start: at(10, 0, 0), finish: at(10, 0, 0).Add(time.Duration(sec) * time.Second)}.sample()
	}
	// 平均 150、中央値 (150+150)/2、標準偏差 sqrt((900+0+900+0)/3)=24.49…、係数 150/135=1.111…
	if got := summarize([]sample{s(1, 120), s(1, 150), s(1, 180), s(1, 150)}); got != (Summary{Brews: 4, AvgSec: 150, MedianSec: 150, StddevSec: 24.5, Coefficient: 1.11}) {
		t.Fatalf("まとめ：%+v", got)
	}
	if one := summarize([]sample{s(2, 234)}); one != (Summary{Brews: 1, AvgSec: 234, MedianSec: 234, Coefficient: 1.2}) {
		t.Fatalf("1 件なら標準偏差は 0、2 杯は 195 秒で割る：%+v", one)
	}
	// 杯数が混ざっても、係数は 1 件ごとの比の平均（135 秒の 1 杯と 195 秒の 2 杯なら 1.00）
	if mixed := summarize([]sample{s(1, 135), s(2, 195)}); mixed.Coefficient != 1 {
		t.Fatalf("杯数が混ざったとき：%+v", mixed)
	}
}

// ドリッパー・杯数ごと、時間帯（日本時間の 30 分ごと）ごとにまとめる。カードは drip_id ごと。抽出が終わっていないカードは数えない
func TestBuildGroups(t *testing.T) {
	queued := uuid.New()
	brewing := uuid.New()
	stats := Build(concat(
		brew(2, 1, at(10, 29, 0), 150),
		brew(2, 1, at(10, 30, 0), 140),
		brew(1, 2, at(10, 0, 0), 195),
		// 抽出中・待機・未割当のカップは数えない
		[]Cup{
			{Day: day, DripID: ptr(brewing), Dripper: ptr(1), BrewStartedAt: ptr(at(11, 0, 0))},
			{Day: day, DripID: ptr(queued), Dripper: ptr(1)},
			{Day: day},
		},
	), nil)
	if stats.Brews != 3 || stats.Standard != (Standard{OneCupSec: 135, TwoCupSec: 195}) {
		t.Fatalf("件数と標準：%+v", stats)
	}
	wantDripper := `[{"day":"2026-11-01","dripper":1,"cups":2,"brews":1,"avg_sec":195,"median_sec":195,"stddev_sec":0,"coefficient":1},` +
		`{"day":"2026-11-01","dripper":2,"cups":1,"brews":2,"avg_sec":145,"median_sec":145,"stddev_sec":7.1,"coefficient":1.07}]`
	if got := toJSON(t, stats.ByDripper); got != wantDripper {
		t.Fatalf("ドリッパーごと：%s", got)
	}
	// 10:29 は 10:00 の枠、10:30 は 10:30 の枠
	wantSlot := `[{"day":"2026-11-01","slot":"10:00","cups":1,"brews":1,"avg_sec":150,"median_sec":150,"stddev_sec":0,"coefficient":1.11},` +
		`{"day":"2026-11-01","slot":"10:00","cups":2,"brews":1,"avg_sec":195,"median_sec":195,"stddev_sec":0,"coefficient":1},` +
		`{"day":"2026-11-01","slot":"10:30","cups":1,"brews":1,"avg_sec":140,"median_sec":140,"stddev_sec":0,"coefficient":1.04}]`
	if got := toJSON(t, stats.BySlot); got != wantSlot {
		t.Fatalf("時間帯ごと：%s", got)
	}
	// 交代の記録が無いドリッパーは担当者なし
	if stats.PersonSkipped != (PersonSkipped{NoPerson: 3}) || len(stats.ByPerson) != 0 {
		t.Fatalf("担当者：%+v %+v", stats.PersonSkipped, stats.ByPerson)
	}
	// 何も無ければ空の配列（null にしない）
	if got := toJSON(t, Build(nil, nil)); got != `{"standard":{"one_cup_sec":135,"two_cup_sec":195},"brews":0,"by_dripper":[],"by_slot":[],"by_person":[],"person_skipped":{"no_person":0},"rebrews":[],"interrupted_brews":0}` {
		t.Fatalf("空：%s", got)
	}
}

// 時間帯の枠は日本時間（UTC の時刻で渡しても日本時間で分ける）
func TestSlot(t *testing.T) {
	if got := Slot(time.Date(2026, 11, 1, 1, 59, 0, 0, time.UTC)); got != "10:30" {
		t.Fatalf("10:59 JST の枠：%s", got)
	}
	if got := Day(time.Date(2026, 10, 31, 15, 0, 0, 0, time.UTC)); got != "2026-11-01" {
		t.Fatalf("日本時間の日付：%s", got)
	}
	if _, _, err := DayRange("2026-1-1"); err == nil {
		t.Fatal("形の違う日付が通った")
	}
}

// 担当者：交代の記録から、抽出を始めた時刻にそのドリッパーにいた人（始めたあとに替えても、始めたときの人）
func TestBuildPersons(t *testing.T) {
	stats := Build(concat(
		brew(1, 1, at(10, 0, 0), 150),  // 1 番：9:00 から山田
		brew(1, 2, at(10, 30, 0), 195), // 1 番：2 杯
		brew(2, 1, at(10, 0, 0), 120),  // 2 番：9:00 から高橋、10:05 に佐藤に替えた → 10:00 に始めたのは高橋
		brew(2, 1, at(10, 10, 0), 150), // 2 番：替えたあとに始めた → 佐藤
		brew(3, 1, at(10, 0, 0), 135),  // 3 番：担当者を空にしてある
		brew(4, 1, at(10, 0, 0), 140),  // 4 番：その日に替えていない（記録が無い）
		brew(6, 1, at(9, 0, 0), 135),   // 6 番：記録より前に始めた → 担当者なし
		// 抽出を始めた時刻ちょうどに替えたら、替えたあとの人
		brew(5, 1, at(11, 0, 0), 135),
		brew(6, 1, at(11, 0, 0), 150), // 6 番：10:00 に 1 番と入れ替えて山田
	), []LaneChange{
		{Day: day, Dripper: 1, ChangedAt: at(9, 0, 0), Name: "山田"},
		{Day: day, Dripper: 2, ChangedAt: at(9, 0, 0), Name: "高橋"},
		{Day: day, Dripper: 3, ChangedAt: at(9, 0, 0), Name: "鈴木"},
		{Day: day, Dripper: 3, ChangedAt: at(9, 30, 0), Name: ""},
		{Day: day, Dripper: 2, ChangedAt: at(10, 5, 0), Name: "佐藤"},
		{Day: day, Dripper: 6, ChangedAt: at(10, 0, 0), Name: "山田"},
		{Day: day, Dripper: 1, ChangedAt: at(10, 45, 0), Name: "伊藤"},
		{Day: day, Dripper: 5, ChangedAt: at(11, 0, 0), Name: "鈴木"},
		// ほかの日の記録は使わない
		{Day: "2026-10-31", Dripper: 4, ChangedAt: at(-24, 0, 0), Name: "前の日"},
	})
	want := `[{"name":"佐藤","cups":1,"brews":1,"avg_sec":150,"median_sec":150,"stddev_sec":0,"coefficient":1.11},` +
		`{"name":"山田","cups":1,"brews":2,"avg_sec":150,"median_sec":150,"stddev_sec":0,"coefficient":1.11},` +
		`{"name":"山田","cups":2,"brews":1,"avg_sec":195,"median_sec":195,"stddev_sec":0,"coefficient":1},` +
		`{"name":"鈴木","cups":1,"brews":1,"avg_sec":135,"median_sec":135,"stddev_sec":0,"coefficient":1},` +
		`{"name":"高橋","cups":1,"brews":1,"avg_sec":120,"median_sec":120,"stddev_sec":0,"coefficient":0.89}]`
	if got := toJSON(t, stats.ByPerson); got != want {
		t.Fatalf("担当者ごと：%s", got)
	}
	if stats.PersonSkipped != (PersonSkipped{NoPerson: 3}) {
		t.Fatalf("担当者に入れなかった：%+v", stats.PersonSkipped)
	}
}

// 緊急（入れ直し）：緊急にしても最初の抽出の列は残るので、最初の抽出は最初の杯数のまま数える。
// 入れ直しのカード（emergency_drip_id・emergency_dripper・emergency_brew_*）はまとめから除いて rebrews に数える。
// 抽出を始めて終えずに中断したカード（カップが全部緊急）は interrupted_brews に数える
func TestBuildRebrews(t *testing.T) {
	first1, first2, first3, first4 := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	rebrew1, rebrew2 := uuid.New(), uuid.New()
	emergencyAt := ptr(at(10, 5, 0))
	firstBrew := func(id uuid.UUID, dripper int, start time.Time, sec int) Cup {
		return Cup{Day: day, DripID: ptr(id), Dripper: ptr(dripper), BrewStartedAt: ptr(start), BrewFinishedAt: ptr(start.Add(time.Duration(sec) * time.Second))}
	}
	rebrewed := func(c Cup, id uuid.UUID, dripper int, start time.Time, sec int) Cup {
		c.EmergencyAt, c.EmergencyDripID, c.EmergencyDripper = emergencyAt, ptr(id), ptr(dripper)
		c.EmergencyBrewStartedAt, c.EmergencyBrewFinishedAt = ptr(start), ptr(start.Add(time.Duration(sec)*time.Second))
		return c
	}
	cups := []Cup{
		// 2 杯のカード（first1。1 番で 210 秒）の 1 杯だけ緊急にし、3 番で入れ直した
		firstBrew(first1, 1, at(10, 0, 0), 210),
		rebrewed(firstBrew(first1, 1, at(10, 0, 0), 210), rebrew1, 3, at(10, 10, 0), 150),
		// 1 杯のカード（first2。2 番で 120 秒）を終えてから緊急にし、3 番で入れ直した
		rebrewed(firstBrew(first2, 2, at(10, 1, 0), 120), rebrew2, 3, at(10, 13, 0), 120),
		// 抽出中に中断した 1 杯のカード（first3）。始めた時刻だけが残り、まだ入れ直していない
		{Day: day, DripID: ptr(first3), Dripper: ptr(4), BrewStartedAt: ptr(at(10, 2, 0)), EmergencyAt: emergencyAt},
		// 抽出中のカード（first4）は中断に数えない
		{Day: day, DripID: ptr(first4), Dripper: ptr(5), BrewStartedAt: ptr(at(10, 20, 0))},
		// 待機のうちに緊急にしたカップ（first4 のカードにいたが、始めていない）は杯数に入れない
		{Day: day, DripID: ptr(first4), Dripper: ptr(5), EmergencyAt: emergencyAt},
	}
	stats := Build(cups, nil)

	if stats.Brews != 2 || stats.InterruptedBrews != 1 {
		t.Fatalf("最初の抽出 2 枚・中断 1 枚：%+v", stats)
	}
	// 最初の抽出：1 番は 2 杯（緊急にしたカップも最初は淹れた）で 210 秒、2 番は 1 杯で 120 秒
	want := `[{"day":"2026-11-01","dripper":1,"cups":2,"brews":1,"avg_sec":210,"median_sec":210,"stddev_sec":0,"coefficient":1.08},` +
		`{"day":"2026-11-01","dripper":2,"cups":1,"brews":1,"avg_sec":120,"median_sec":120,"stddev_sec":0,"coefficient":0.89}]`
	if got := toJSON(t, stats.ByDripper); got != want {
		t.Fatalf("ドリッパーごと：%s", got)
	}
	if got := toJSON(t, stats.Rebrews); got != `[{"day":"2026-11-01","dripper":3,"rebrews":2,"extra_cups":2}]` {
		t.Fatalf("入れ直し：%s", got)
	}
}
