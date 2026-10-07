package handlers

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/google/uuid"

	"cafeore-pos/api/internal/caos"
	"cafeore-pos/api/internal/models"
)

// 列の担当者の保存（CaosStore。本物の Postgres。CAOS_TEST_DATABASE_URL を渡したときだけ動く）。

func storeLanes(t *testing.T, s *CaosStore) []caos.Lane {
	t.Helper()
	l, err := s.Lanes(testDay)
	must(t, err)
	return l
}

func laneNames(t *testing.T, s *CaosStore) string {
	t.Helper()
	out := ""
	for _, l := range storeLanes(t, s) {
		mark := ""
		if l.Senior {
			mark = "*"
		}
		out += "[" + l.Name + mark + "]"
	}
	return out
}

// 交代・入れ替えは保存され、全部の画面が同じ担当者を読む。「1つ戻す」で戻る（一度も替えていない列は行が消える）
func TestCaosStoreLanesFlow(t *testing.T) {
	db := testDB(t)
	s := newStore(db)

	if got := laneNames(t, s); got != "[][][][][][]" {
		t.Fatalf("最初は 6 列とも担当者なし：%s", got)
	}
	set, err := s.Apply(caos.Op{Name: "set_lane", Dripper: ptr(1), Person: " 山田 ", Senior: true})
	must(t, err)
	if set.OpID == "" || len(set.Lanes) != 1 || set.Lanes[0].Name != "山田" || !set.Lanes[0].Senior || len(set.Changed) != 0 {
		t.Fatalf("交代の結果：%+v", set)
	}
	_, err = s.Apply(caos.Op{Name: "set_lane", Dripper: ptr(3), Person: "佐藤"})
	must(t, err)
	if got := laneNames(t, s); got != "[山田*][][佐藤][][][]" {
		t.Fatalf("交代を保存する：%s", got)
	}
	swap, err := s.Apply(caos.Op{Name: "swap_lanes", Dripper: ptr(1), OtherDripper: ptr(3)})
	must(t, err)
	if got := laneNames(t, s); got != "[佐藤][][山田*][][][]" {
		t.Fatalf("入れ替え：%s", got)
	}
	if len(swap.Lanes) != 2 {
		t.Fatalf("入れ替えの結果は 2 列：%+v", swap.Lanes)
	}

	undo, err := s.Apply(caos.Op{Name: "undo", OpID: swap.OpID})
	must(t, err)
	if got := laneNames(t, s); got != "[山田*][][佐藤][][][]" || len(undo.Lanes) != 2 {
		t.Fatalf("入れ替えを戻す：%s %+v", got, undo)
	}
	if _, err := s.Apply(caos.Op{Name: "undo", OpID: swap.OpID}); !caos.IsInvalid(err) {
		t.Fatalf("同じ操作は 2 回戻せない：%v", err)
	}
	// 一度も替えていなかった列に戻すと、行が消える
	_, err = s.Apply(caos.Op{Name: "undo", OpID: set.OpID})
	must(t, err)
	var rows int64
	must(t, db.Model(&models.CaosLaneRow{}).Where("dripper = 1").Count(&rows).Error)
	if got := laneNames(t, s); got != "[][][佐藤][][][]" || rows != 0 {
		t.Fatalf("最初の交代を戻す：%s（行 %d）", got, rows)
	}
	if l := storeLanes(t, s)[0]; l.UpdatedAt != nil {
		t.Fatalf("替えていない列の updated_at は null：%+v", l)
	}
	if _, err := s.Apply(caos.Op{Name: "set_lane", Dripper: ptr(0), Person: "x"}); !caos.IsInvalid(err) {
		t.Fatalf("範囲外の列は断る：%v", err)
	}
}

// 記録のあとほかの端末で担当者を替えていたら、戻すのを断り、何も変えない
func TestCaosStoreLanesUndoRejectsWhenTouched(t *testing.T) {
	db := testDB(t)
	s := newStore(db)
	first, err := s.Apply(caos.Op{Name: "set_lane", Dripper: ptr(2), Person: "山田"})
	must(t, err)
	_, err = s.Apply(caos.Op{Name: "set_lane", Dripper: ptr(2), Person: "鈴木"})
	must(t, err)
	before := laneNames(t, s)
	if _, err := s.Apply(caos.Op{Name: "undo", OpID: first.OpID}); !caos.IsInvalid(err) {
		t.Fatalf("断るはず：%v", err)
	}
	var undone int64
	must(t, db.Model(&models.CaosOpRow{}).Where("undone_at IS NOT NULL").Count(&undone).Error)
	if after := laneNames(t, s); after != before || undone != 0 {
		t.Fatalf("断ったのに変わった：%s → %s（戻した記録 %d）", before, after, undone)
	}
}

// カードの操作と列の担当者の操作は別々に戻せる（カードの「1つ戻す」は担当者に触らない）
func TestCaosStoreLanesAndCardsUndoSeparately(t *testing.T) {
	db := testDB(t)
	cat := seedCatalog(t, db)
	s := newStore(db)
	createOrder(t, s, db, 1, dayStart.Add(10*time.Hour), cat.champ)
	assigned, err := s.Apply(caos.Op{Name: "assign", DripID: drips(t, s)[0].ID, Dripper: ptr(1)})
	must(t, err)
	_, err = s.Apply(caos.Op{Name: "set_lane", Dripper: ptr(1), Person: "山田"})
	must(t, err)
	if _, err := s.Apply(caos.Op{Name: "undo", OpID: assigned.OpID}); err != nil {
		t.Fatalf("交代のあとでも、カードの割当は戻せる：%v", err)
	}
	if got := laneNames(t, s); got != "[山田][][][][][]" || drips(t, s)[0].Status != caos.StatusUnassigned {
		t.Fatalf("カードだけ戻る：%s %+v", got, drips(t, s))
	}
	var rec models.CaosOpRow
	must(t, db.First(&rec, "id = ?", uuid.MustParse(assigned.OpID)).Error)
	if len(rec.LanesBefore) != 0 || len(rec.LanesAfter) != 0 {
		t.Fatalf("カードの操作の記録に担当者は入らない：%+v", rec)
	}
}

// 担当者は営業日ごと（日が変わると全部の列が担当者なしから始まる）
func TestCaosStoreLanesSeparateDays(t *testing.T) {
	db := testDB(t)
	s := newStore(db)
	_, err := s.Apply(caos.Op{Name: "set_lane", Dripper: ptr(1), Person: "山田"})
	must(t, err)
	next, err := s.Lanes("2026-11-02")
	must(t, err)
	if next[0].Name != "" {
		t.Fatalf("次の日は担当者なし：%+v", next)
	}
	s.today = func() string { return "2026-11-02" }
	_, err = s.Apply(caos.Op{Name: "set_lane", Dripper: ptr(1), Person: "鈴木"})
	must(t, err)
	s.today = func() string { return testDay }
	if got := laneNames(t, s); got != "[山田][][][][][]" {
		t.Fatalf("前の日の担当者はそのまま：%s", got)
	}
}

// 既にある caos_ops（担当者の列が無い表と記録）にも、起動時の AutoMigrate で列が足され、前の記録も戻せる
func TestCaosStoreLanesMigratesOldOps(t *testing.T) {
	db := testDB(t)
	cat := seedCatalog(t, db)
	s := newStore(db)
	createOrder(t, s, db, 1, dayStart.Add(10*time.Hour), cat.champ)
	assigned, err := s.Apply(caos.Op{Name: "assign", DripID: drips(t, s)[0].ID, Dripper: ptr(1)})
	must(t, err)
	must(t, db.Exec("DROP TABLE caos_lanes").Error)
	must(t, db.Exec("ALTER TABLE caos_ops DROP COLUMN lanes_before, DROP COLUMN lanes_after").Error)
	must(t, db.AutoMigrate(&models.CaosLaneRow{}, &models.CaosOpRow{}))
	var raw string
	must(t, db.Raw("SELECT lanes_before::text FROM caos_ops WHERE id = ?", assigned.OpID).Scan(&raw).Error)
	var v []caos.Lane
	must(t, json.Unmarshal([]byte(raw), &v))
	if len(v) != 0 {
		t.Fatalf("前の記録は空の配列になる：%s", raw)
	}
	if _, err := s.Apply(caos.Op{Name: "undo", OpID: assigned.OpID}); err != nil {
		t.Fatalf("前の記録も戻せる：%v", err)
	}
	if got := laneNames(t, s); got != "[][][][][][]" {
		t.Fatalf("担当者は無いまま：%s", got)
	}
}

// 表の制約：列の番号は 1〜6、同じ日の同じ列は 1 行
func TestCaosStoreLanesSchemaConstraints(t *testing.T) {
	db := testDB(t)
	now := time.Now()
	must(t, db.Create(&models.CaosLaneRow{Day: testDay, Dripper: 1, Name: "山田", UpdatedAt: now}).Error)
	for name, r := range map[string]models.CaosLaneRow{
		"列の番号が範囲外": {Day: testDay, Dripper: 7, Name: "x", UpdatedAt: now},
		"同じ日の同じ列":  {Day: testDay, Dripper: 1, Name: "y", UpdatedAt: now},
	} {
		if err := db.Create(&r).Error; err == nil {
			t.Errorf("%s は DB で止まる", name)
		}
	}
}
