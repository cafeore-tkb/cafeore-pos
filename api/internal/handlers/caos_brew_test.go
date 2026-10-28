package handlers

import (
	"encoding/json"
	"math"
	"net/http"
	"testing"
	"time"

	"cafeore-pos/api/internal/models"
	"cafeore-pos/api/internal/testdb"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

func TestCaosBrewEstimate(t *testing.T) {
	now := time.Date(2026, 10, 28, 3, 0, 0, 0, time.UTC)
	for _, kind := range caosBrewKinds {
		got := estimateCaosBrew(nil, kind, "", "", now)
		if got.Seconds != initialBrewSeconds(kind) || got.Coefficient != 1 {
			t.Fatalf("initial %s: %+v", kind, got)
		}
	}
	actual := 240.0
	finish := now.Add(-time.Minute)
	sample := models.CaosBrewRecord{Kind: "hot1", Name: "山田", Grade: "B2", FinishedAt: &finish, ActualSeconds: &actual, StandardSeconds: 300, Coefficient: 1}
	got := estimateCaosBrew([]models.CaosBrewRecord{sample}, "ice2", "山田", "B2", now)
	if got.StandardSeconds != 360 || got.PersonSamples != 1 || math.Abs(got.Coefficient-(1+(0.8-1)/6)) > 1e-8 {
		t.Fatalf("shared personal ratio: %+v", got)
	}
	if estimateCaosBrew([]models.CaosBrewRecord{sample}, "hot1", "", "", now).Seconds != 240 {
		t.Fatal("first sample should affect store standard")
	}
	sample.Coefficient = .8
	if estimateCaosBrew([]models.CaosBrewRecord{sample}, "hot1", "", "", now).StandardSeconds != 300 {
		t.Fatal("known personal effect should be removed from store standard")
	}
	sample.ExcludedReason = "late_merge"
	if estimateCaosBrew([]models.CaosBrewRecord{sample}, "hot1", "山田", "B2", now).StandardSamples != 0 {
		t.Fatal("excluded sample used")
	}
	sample.ExcludedReason = ""
	sample.FinishedAt = &now
	if estimateCaosBrew([]models.CaosBrewRecord{sample}, "hot1", "山田", "B2", now).PersonSamples != 0 {
		t.Fatal("simultaneous/future sample used")
	}
}

func TestCaosBrewLifecycleOnDB(t *testing.T) {
	db := testdb.New(t)
	f := newCaosFixture(t, db)
	clock := time.Now().Truncate(time.Millisecond)
	f.caos.now = func() time.Time { return clock }
	grade := "B2"
	if err := saveCaosLane(db, models.DripperAssignee{Day: caosDayString(clock), Dripper: 1, Name: "山田", Grade: grade, UpdatedAt: clock.Add(-time.Minute)}, ""); err != nil {
		t.Fatal(err)
	}
	a := f.createOrderAt(t, 1, clock.Add(-time.Minute), line(f.blend))
	b := f.createOrderAt(t, 2, clock.Add(-time.Minute), line(f.blend))
	drip := uuid.New()
	// 別注文の1杯ずつをまとめてから抽出。2杯を1件として数える。
	f.mustPut(t, write([]uuid.UUID{a.OrderCups[0].ID, b.OrderCups[0].ID}, unassigned, placed(1, drip, true)))
	var record models.CaosBrewRecord
	if err := db.First(&record, "drip_id = ?", drip).Error; err != nil {
		t.Fatal(err)
	}
	if record.Kind != "hot2" || record.Name != "山田" || record.Grade != "B2" || record.PredictedSeconds != 360 {
		t.Fatalf("start: %+v", record)
	}
	clock = clock.Add(240 * time.Second)
	if code := f.finish(t, 1, &drip); code != http.StatusNoContent {
		t.Fatalf("finish: %d", code)
	}
	if err := db.First(&record, "drip_id = ?", drip).Error; err != nil {
		t.Fatal(err)
	}
	if record.ActualSeconds == nil || math.Abs(*record.ActualSeconds-240) > .01 || record.ExcludedReason != "" {
		t.Fatalf("finish record: %+v", record)
	}
	// 再送をサーバーが断っても件数は増えない。
	f.finish(t, 1, &drip)
	var count int64
	db.Model(&models.CaosBrewRecord{}).Where("drip_id = ?", drip).Count(&count)
	if count != 1 {
		t.Fatalf("duplicate records: %d", count)
	}
	clock = clock.Add(time.Second)
	w := callHandler(t, f.caos.GetCaosBrewModel, http.MethodGet, "")
	if w.Code != 200 {
		t.Fatalf("model: %d %s", w.Code, w.Body.String())
	}
	var model brewModelResponse
	if err := json.Unmarshal(w.Body.Bytes(), &model); err != nil {
		t.Fatal(err)
	}
	if model.Standards["hot2"].Seconds != 288 || model.Lanes[0].Estimates["hot2"].Seconds >= 288 {
		t.Fatalf("learned model: %+v", model)
	}
	// 次の抽出では補正された値を保存し、その後モデルが変わっても記録は変わらない。
	c := f.createOrderAt(t, 3, clock.Add(-time.Second), line(f.blend, f.blend))
	drip2 := uuid.New()
	f.mustPut(t, write([]uuid.UUID{c.OrderCups[0].ID, c.OrderCups[1].ID}, unassigned, placed(1, drip2, true)))
	var current models.CaosBrewRecord
	if err := db.First(&current, "drip_id = ?", drip2).Error; err != nil {
		t.Fatal(err)
	}
	if current.PredictedSeconds != model.Lanes[0].Estimates["hot2"].Seconds {
		t.Fatalf("saved prediction: %+v", current)
	}
	w = callWithParams(t, f.caos.GetCaosBrewRecords, http.MethodGet, "", gin.Params{})
	if w.Code != 200 {
		t.Fatalf("records: %d %s", w.Code, w.Body.String())
	}
}

func TestCaosBrewExclusionsOnDB(t *testing.T) {
	db := testdb.New(t)
	f := newCaosFixture(t, db)
	clock := time.Now().Truncate(time.Millisecond)
	f.caos.now = func() time.Time { return clock }
	a := f.createOrderAt(t, 1, clock.Add(-time.Minute), line(f.blend))
	drip := uuid.New()
	f.mustPut(t, write([]uuid.UUID{a.OrderCups[0].ID}, unassigned, placed(1, drip, true)))
	clock = clock.Add(30 * time.Second)
	if code := f.finish(t, 1, &drip); code != 204 {
		t.Fatal(code)
	}
	var record models.CaosBrewRecord
	db.First(&record, "drip_id = ?", drip)
	if record.ExcludedReason != "duration_outlier" {
		t.Fatalf("outlier: %+v", record)
	}
	b := f.createOrderAt(t, 2, clock.Add(-time.Second), line(f.blend))
	drip2 := uuid.New()
	f.mustPut(t, write([]uuid.UUID{b.OrderCups[0].ID}, unassigned, placed(1, drip2, true)))
	clock = clock.Add(time.Minute)
	if err := saveCaosLane(db, models.DripperAssignee{Day: caosDayString(clock), Dripper: 1, Name: "佐藤", Grade: "B1", UpdatedAt: clock}, ""); err != nil {
		t.Fatal(err)
	}
	clock = clock.Add(3 * time.Minute)
	if code := f.finish(t, 1, &drip2); code != 204 {
		t.Fatal(code)
	}
	var switched models.CaosBrewRecord
	db.First(&switched, "drip_id = ?", drip2)
	if switched.ExcludedReason != "assignee_changed" {
		t.Fatalf("assignee change: %+v", switched)
	}
}

func TestCaosBrewKinds(t *testing.T) {
	for _, iced := range []bool{false, true} {
		for cups := 1; cups <= 2; cups++ {
			rows := []models.CaosOperationCup{}
			for i := 0; i < cups; i++ {
				id := uuid.New()
				rows = append(rows, models.CaosOperationCup{UnitID: id, CupID: id, IcedBrew: &iced})
			}
			want := "hot1"
			if iced {
				want = "ice1"
			}
			if cups == 2 {
				want = want[:3] + "2"
			}
			kind, reason := brewGroupKind(rows)
			if kind != want || reason != "" {
				t.Fatalf("classification: %s %s, want %s", kind, reason, want)
			}
			rows[0].UnitID = uuid.New()
			if k, r := brewGroupKind(rows); k != want || r != "rebrew" {
				t.Fatalf("rebrew: %s %s", k, r)
			}
		}
	}
	hot, ice := false, true
	a, b := uuid.New(), uuid.New()
	rows := []models.CaosOperationCup{{UnitID: a, CupID: a, IcedBrew: &hot}, {UnitID: b, CupID: b, IcedBrew: &ice}}
	if k, r := brewGroupKind(rows); k != "" || r != "mixed_type" {
		t.Fatalf("mixed: %s %s", k, r)
	}
}

func TestCaosBrewPriorDayAndBounds(t *testing.T) {
	now := time.Date(2026, 10, 29, 1, 0, 0, 0, time.UTC)
	finish := now.Add(-24 * time.Hour)
	actual := 600.0
	sample := models.CaosBrewRecord{Kind: "ice1", Name: "山田", Grade: "B2", FinishedAt: &finish, ActualSeconds: &actual, StandardSeconds: 300, Coefficient: 1}
	got := estimateCaosBrew([]models.CaosBrewRecord{sample}, "ice1", "山田", "B2", now)
	if got.StandardSeconds != 360 || got.PersonSamples != 1 {
		t.Fatalf("previous day/bound: %+v", got)
	}
	other := estimateCaosBrew([]models.CaosBrewRecord{sample}, "ice1", "山田", "B1", now)
	if other.PersonSamples != 0 || other.Coefficient != 1 {
		t.Fatalf("grade identity: %+v", other)
	}
	finish = now.Add(-8 * 24 * time.Hour)
	if estimateCaosBrew([]models.CaosBrewRecord{sample}, "ice1", "山田", "B2", now).StandardSamples != 0 {
		t.Fatal("expired history used")
	}
}

func TestCaosBrewInvalidationOnDB(t *testing.T) {
	db := testdb.New(t)
	start := time.Now().Truncate(time.Millisecond)
	drip, unit := uuid.New(), uuid.New()
	dripper, hot := 1, false
	row := models.CaosOperationCup{UnitID: unit, CupID: unit, IcedBrew: &hot, Changed: true, AfterDripID: &drip, AfterDripper: &dripper, AfterBrewStartedAt: &start}
	op := models.CaosOperation{ID: uuid.New(), Kind: "cups", OccurredAt: start, RecordedAt: start}
	if err := recordCaosBrews(db, op, []models.CaosOperationCup{row}); err != nil {
		t.Fatal(err)
	}
	// 開始後の統合は、同じ開始記録を学習から外す。
	merged := start.Add(time.Minute)
	row.Changed = false
	row.MergedAt = &merged
	if err := recordCaosBrews(db, op, []models.CaosOperationCup{row}); err != nil {
		t.Fatal(err)
	}
	var record models.CaosBrewRecord
	if err := db.First(&record, "drip_id = ?", drip).Error; err != nil {
		t.Fatal(err)
	}
	if record.ExcludedReason != "late_merge" {
		t.Fatalf("late merge: %+v", record)
	}
	// 開始のやり直しでは古い記録を無効化し、開始時刻の異なる新記録を残す。
	drip2, unit2 := uuid.New(), uuid.New()
	row = models.CaosOperationCup{UnitID: unit2, CupID: unit2, IcedBrew: &hot, Changed: true, AfterDripID: &drip2, AfterDripper: &dripper, AfterBrewStartedAt: &start}
	if err := recordCaosBrews(db, op, []models.CaosOperationCup{row}); err != nil {
		t.Fatal(err)
	}
	restart := start.Add(2 * time.Minute)
	row.BeforeDripID = &drip2
	row.BeforeBrewStartedAt = &start
	row.AfterBrewStartedAt = &restart
	op.ID = uuid.New()
	op.OccurredAt = restart
	op.RecordedAt = restart
	if err := recordCaosBrews(db, op, []models.CaosOperationCup{row}); err != nil {
		t.Fatal(err)
	}
	var records []models.CaosBrewRecord
	if err := db.Where("drip_id = ?", drip2).Order("started_at").Find(&records).Error; err != nil {
		t.Fatal(err)
	}
	if len(records) != 2 || records[0].ExcludedReason != "restarted_or_moved" || records[1].ExcludedReason != "" {
		t.Fatalf("restart: %+v", records)
	}
	// オフライン等で遅延した開始は担当を推測せず除外する。
	drip3 := uuid.New()
	row.AfterDripID = &drip3
	row.BeforeDripID = nil
	row.BeforeBrewStartedAt = nil
	op.RecordedAt = restart.Add(10 * time.Second)
	if err := recordCaosBrews(db, op, []models.CaosOperationCup{row}); err != nil {
		t.Fatal(err)
	}
	var delayed models.CaosBrewRecord
	if err := db.First(&delayed, "drip_id = ?", drip3).Error; err != nil {
		t.Fatal(err)
	}
	if delayed.ExcludedReason != "delayed_operation" || delayed.Name != "" {
		t.Fatalf("delayed: %+v", delayed)
	}
}
