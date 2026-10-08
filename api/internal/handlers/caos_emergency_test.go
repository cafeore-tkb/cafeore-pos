package handlers

import (
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"cafeore-pos/api/internal/models"
)

// 緊急（入れ直し）と緊急のシールの DB のテスト。CaOS のテストと同じく LISTEN_TEST_DATABASE_URL を渡したときだけ走る。

// emergency は POST /api/caos/emergency を呼ぶ。
func (f *caosFixture) emergency(t *testing.T, interrupt bool, cups ...uuid.UUID) (int, models.CaosEmergencyResult, string) {
	t.Helper()
	body, _ := json.Marshal(map[string]any{"cup_ids": cups, "interrupt": interrupt})
	w := callHandler(t, f.caos.MarkCaosEmergency, http.MethodPost, string(body))
	var res models.CaosEmergencyResult
	if w.Code == http.StatusOK {
		if err := json.Unmarshal(w.Body.Bytes(), &res); err != nil {
			t.Fatal(err)
		}
	}
	return w.Code, res, w.Body.String()
}

func (f *caosFixture) mustEmergency(t *testing.T, interrupt bool, cups ...uuid.UUID) models.CaosEmergencyResult {
	t.Helper()
	code, res, body := f.emergency(t, interrupt, cups...)
	if code != http.StatusOK {
		t.Fatalf("POST /api/caos/emergency = %d: %s", code, body)
	}
	return res
}

func cupParams(order models.Order, cup uuid.UUID) gin.Params {
	return gin.Params{{Key: "id", Value: order.ID.String()}, {Key: "cupId", Value: cup.String()}}
}

func (f *caosFixture) claim(t *testing.T, order models.Order, cup uuid.UUID) (int, models.EmergencyLabelClaim) {
	t.Helper()
	w := callWithParams(t, f.caos.ClaimEmergencyLabel, http.MethodPost, "", cupParams(order, cup))
	var res models.EmergencyLabelClaim
	if w.Code == http.StatusOK {
		if err := json.Unmarshal(w.Body.Bytes(), &res); err != nil {
			t.Fatal(err)
		}
	}
	return w.Code, res
}

func (f *caosFixture) release(t *testing.T, order models.Order, cup uuid.UUID, at time.Time) int {
	t.Helper()
	body, _ := json.Marshal(map[string]any{"emergency_printed_at": at})
	return callWithParams(t, f.caos.ReleaseEmergencyLabel, http.MethodPost, string(body), cupParams(order, cup)).Code
}

func sameIDs(got []uuid.UUID, want ...uuid.UUID) bool {
	if len(got) != len(want) {
		return false
	}
	for i := range got {
		if got[i] != want[i] {
			return false
		}
	}
	return true
}

func toIDs[T ~[16]byte](v []T) []uuid.UUID {
	out := make([]uuid.UUID, len(v))
	for i, id := range v {
		out[i] = uuid.UUID(id)
	}
	return out
}

func TestCaosEmergencyOnDB(t *testing.T) {
	db, _ := openListenTestDB(t)
	f := newCaosFixture(t, db)
	o1 := f.createOrder(t, 1, line(f.blend, f.blend), line(f.milk))
	o2 := f.createOrder(t, 2, line(f.blend))
	card1, card2 := uuid.New(), uuid.New()
	f.mustPut(t,
		write(ids(o1.OrderCups[:2]...), unassigned, placed(1, 1, card1, true)),
		write(ids(o2.OrderCups[0]), unassigned, placed(1, 2, card2, false)),
	)

	// 抽出中のカードの 1 杯だけを緊急にする（中断しない）：そのカップは CaOS の列が空になり、最初のカード（drip_id）は残る。
	// カードは残りの 1 杯で抽出を続ける
	res := f.mustEmergency(t, false, o1.OrderCups[0].ID)
	if !sameIDs(toIDs(res.MarkedCupIds), o1.OrderCups[0].ID) || len(res.InterruptedDripIds) != 0 || len(res.StartedDripIds) != 0 {
		t.Fatalf("emergency = %+v", res)
	}
	cup := f.cup(t, o1.OrderCups[0].ID)
	if cup.EmergencyAt == nil || cup.EmergencyDripID != nil || cup.EmergencyPrintedAt != nil ||
		cup.Dripper != nil || cup.DripperPosition != nil || cup.BrewStartedAt != nil || cup.BrewFinishedAt != nil ||
		cup.DripID == nil || *cup.DripID != card1 || cup.ReadyAt != nil {
		t.Fatalf("emergency cup = %+v", cup)
	}
	if rest := f.cup(t, o1.OrderCups[1].ID); rest.EmergencyAt != nil || rest.BrewStartedAt == nil || *rest.DripID != card1 {
		t.Fatalf("the other cup of the card = %+v", rest)
	}
	// 注文の応答に載る
	var order models.Order
	if err := preloadOrder(db).First(&order, "id = ?", o1.ID).Error; err != nil {
		t.Fatal(err)
	}
	if resp := toOrderResponse(&order); resp.Cups[0].EmergencyAt == nil || resp.Cups[0].EmergencyPrintedAt != nil || resp.Cups[1].EmergencyAt != nil {
		t.Fatalf("cups in the response = %+v", resp.Cups)
	}

	// 同じカップは 2 回緊急にしない（何もしない）。抽出の要らないカップは緊急にできない
	if res := f.mustEmergency(t, false, o1.OrderCups[0].ID); len(res.MarkedCupIds) != 0 {
		t.Fatalf("second emergency = %+v", res)
	}
	if code, _, _ := f.emergency(t, false, o1.OrderCups[2].ID); code != http.StatusUnprocessableEntity {
		t.Fatalf("emergency on milk = %d, want 422", code)
	}
	if code, _, _ := f.emergency(t, false, uuid.New()); code != http.StatusConflict {
		t.Fatalf("emergency on a missing cup = %d, want 409", code)
	}
	// 中断できるのは抽出中のカードだけ（待機のカードは中断できない）
	if code, _, _ := f.emergency(t, true, o2.OrderCups[0].ID); code != http.StatusUnprocessableEntity {
		t.Fatalf("interrupt a queued card = %d, want 422", code)
	}

	// 入れ直しのカードはふつうに割り当てる。カードの印は emergency_drip_id に書き、最初の drip_id は残す
	rebrew := uuid.New()
	f.mustPut(t, write(ids(o1.OrderCups[0]), unassigned, placed(2, 1, rebrew, true)))
	cup = f.cup(t, o1.OrderCups[0].ID)
	if cup.EmergencyDripID == nil || *cup.EmergencyDripID != rebrew || *cup.DripID != card1 || *cup.Dripper != 2 || cup.BrewStartedAt == nil {
		t.Fatalf("assigned rebrew cup = %+v", cup)
	}
	// 書き込みの before の drip_id は入れ直しのカード（最初の drip_id では 409）
	if code, _ := f.put(t, write(ids(o1.OrderCups[0]), stateJSON(caosState{Dripper: cup.Dripper, DripperPosition: cup.DripperPosition, DripID: &card1, BrewStartedAt: cup.BrewStartedAt}), toUnassigned)); code != http.StatusConflict {
		t.Fatalf("before with the first drip_id = %d, want 409", code)
	}
	// 入れ直しのカードとふつうのカードは統合できない
	o3 := f.createOrder(t, 3, line(f.blend))
	if code, _ := f.put(t, write(ids(o3.OrderCups[0]), unassigned, placed(2, 1, rebrew, false))); code != http.StatusUnprocessableEntity {
		t.Fatalf("merge a rebrew card with another = %d, want 422", code)
	}

	// もとのカードの「次へ」は、残りの 1 杯だけを準備完了にする（入れ直すカップは準備完了にしない）
	if code, res := f.next(t, 1, &card1); code != http.StatusOK || res.StartedDripId == nil || uuid.UUID(*res.StartedDripId) != card2 {
		t.Fatalf("next of the first card = %d %+v", code, res)
	}
	if c := f.cup(t, o1.OrderCups[0].ID); c.ReadyAt != nil || c.BrewFinishedAt != nil {
		t.Fatalf("rebrew cup after the first card's next = %+v", c)
	}
	// 入れ直しのカードの「次へ」で、カップを準備完了にする
	if code, res := f.next(t, 2, &rebrew); code != http.StatusOK || res.FinishedDripId == nil || uuid.UUID(*res.FinishedDripId) != rebrew {
		t.Fatalf("next of the rebrew card = %d %+v", code, res)
	}
	if c := f.cup(t, o1.OrderCups[0].ID); c.ReadyAt == nil || c.BrewFinishedAt == nil || *c.DripID != card1 {
		t.Fatalf("rebrew cup after its next = %+v", c)
	}

	// 中断：抽出中のカード（card2）のカップを全部緊急にし、ドリッパーの待機の先頭を始める
	o4 := f.createOrder(t, 4, line(f.blend))
	card4 := uuid.New()
	f.mustPut(t, write(ids(o4.OrderCups[0]), unassigned, placed(1, 4, card4, false)))
	res = f.mustEmergency(t, true, o2.OrderCups[0].ID)
	if !sameIDs(toIDs(res.MarkedCupIds), o2.OrderCups[0].ID) || !sameIDs(toIDs(res.InterruptedDripIds), card2) || !sameIDs(toIDs(res.StartedDripIds), card4) {
		t.Fatalf("interrupt = %+v", res)
	}
	if c := f.cup(t, o4.OrderCups[0].ID); c.BrewStartedAt == nil {
		t.Fatal("the next card did not start after the interrupt")
	}
	if c := f.cup(t, o2.OrderCups[0].ID); c.EmergencyAt == nil || c.BrewStartedAt != nil || c.ReadyAt != nil {
		t.Fatalf("interrupted cup = %+v", c)
	}

	// 中断しなくても、抽出中のカードのカップが全部緊急になれば中断になる（待機が無ければ始めない）
	res = f.mustEmergency(t, false, o4.OrderCups[0].ID)
	if !sameIDs(toIDs(res.InterruptedDripIds), card4) || len(res.StartedDripIds) != 0 {
		t.Fatalf("emergency on the whole brewing card = %+v", res)
	}
	if n, err := countBrewing(db, 1, time.Now().Add(-time.Hour), time.Now().Add(time.Hour)); err != nil || n != 0 {
		t.Fatalf("brewing on dripper 1 = %d %v, want 0", n, err)
	}

	// 準備完了のカップも緊急にでき、準備完了のまま。入れ直しのカードは準備完了でも抽出中として数え、「次へ」で終える
	if err := db.Model(&models.OrderCup{}).Where("id = ?", o3.OrderCups[0].ID).Update("ready_at", time.Now()).Error; err != nil {
		t.Fatal(err)
	}
	f.mustEmergency(t, false, o3.OrderCups[0].ID)
	if c := f.cup(t, o3.OrderCups[0].ID); c.ReadyAt == nil {
		t.Fatal("emergency made a ready cup not ready")
	}
	rebrew3 := uuid.New()
	f.mustPut(t, write(ids(o3.OrderCups[0]), unassigned, placed(3, 3, rebrew3, true)))
	o5 := f.createOrder(t, 5, line(f.blend))
	if code, _ := f.put(t, write(ids(o5.OrderCups[0]), unassigned, placed(3, 5, uuid.New(), true))); code != http.StatusUnprocessableEntity {
		t.Fatalf("second brewing card next to a ready rebrew card = %d, want 422", code)
	}
	if code, res := f.next(t, 3, &rebrew3); code != http.StatusOK || res.FinishedDripId == nil || uuid.UUID(*res.FinishedDripId) != rebrew3 {
		t.Fatalf("next of a ready rebrew card = %d %+v", code, res)
	}

	// 前の日の注文のカップは緊急にできない
	old := f.createOrderAt(t, 9, time.Now().Add(-48*time.Hour), line(f.blend))
	if code, _, _ := f.emergency(t, false, old.OrderCups[0].ID); code != http.StatusUnprocessableEntity {
		t.Fatalf("emergency on yesterday's cup = %d, want 422", code)
	}
	if code, _, _ := f.emergency(t, false); code != http.StatusBadRequest {
		t.Fatalf("emergency without cups = %d, want 400", code)
	}

	// 注文の編集では、引き継いだカップの緊急の印はそのまま
	saved := f.cup(t, o1.OrderCups[0].ID)
	var edited models.Order
	if err := preloadOrder(db).First(&edited, "id = ?", o1.ID).Error; err != nil {
		t.Fatal(err)
	}
	cups := buildOrderCups(o1.ID, edited.OrderMenus, &edited, nil)
	if !timeEqual(cups[0].EmergencyAt, saved.EmergencyAt) || !ptrEqual(cups[0].EmergencyDripID, saved.EmergencyDripID) {
		t.Fatalf("edited cup = %+v, want the emergency kept", cups[0])
	}
}

// 入れ直しのカードを置くときも、指名（明細の dripper）と限定（上級生のドリッパーだけ）の決まりはふつうのカードと同じ
func TestCaosEmergencyCardRulesOnDB(t *testing.T) {
	db, _ := openListenTestDB(t)
	f := newCaosFixture(t, db)
	special := models.ItemType{Name: "special-" + uuid.NewString(), DisplayName: "特別", SeniorOnly: true}
	geisha := models.Item{Name: "ゲイシャ", Abbr: "ゲ", ItemType: special}
	if err := db.Create(&geisha).Error; err != nil {
		t.Fatal(err)
	}
	f.mustPutLane(t, 2, "高橋", false)
	f.mustPutLane(t, 3, "山田", true)
	f.mustPutLane(t, 4, "佐藤", false)
	// 指名（2nd）のカップと、限定のカップと、指名なしのカップを淹れ終える
	nominated := f.createOrder(t, 1, caosLine{items: []models.Item{f.blend}, dripper: intPtr(2)})
	limited := f.createOrder(t, 2, line(geisha))
	plain := f.createOrder(t, 3, line(f.blend))
	card1, card2, card3 := uuid.New(), uuid.New(), uuid.New()
	f.mustPut(t,
		write(ids(nominated.OrderCups[0]), unassigned, placed(2, 1, card1, true)),
		write(ids(limited.OrderCups[0]), unassigned, placed(3, 2, card2, true)),
		write(ids(plain.OrderCups[0]), unassigned, placed(4, 3, card3, true)),
	)
	// 中断は 1 枚ずつ（1 枚の抽出中のカードのカップだけ）
	for _, o := range []models.Order{nominated, limited, plain} {
		f.mustEmergency(t, true, o.OrderCups[0].ID)
	}

	// 指名の入れ直しのカードは、指名のドリッパーにしか置けない
	rebrew1 := uuid.New()
	if code, body := f.put(t, write(ids(nominated.OrderCups[0]), unassigned, placed(3, 1, rebrew1, false))); code != http.StatusUnprocessableEntity || !strings.Contains(body, "指名のあるカップは 2 番") {
		t.Fatalf("nominated rebrew card to 3 = %d: %s", code, body)
	}
	// 指名の違う入れ直しのカップは同じカードにできない（カードは emergency_drip_id で見る）
	if code, body := f.put(t,
		write(ids(nominated.OrderCups[0]), unassigned, placed(2, 1, rebrew1, false)),
		write(ids(plain.OrderCups[0]), unassigned, placed(2, 1, rebrew1, false)),
	); code != http.StatusUnprocessableEntity || !strings.Contains(body, "指名の違うカップ") {
		t.Fatalf("rebrew card with different nominations = %d: %s", code, body)
	}
	f.mustPut(t, write(ids(nominated.OrderCups[0]), unassigned, placed(2, 1, rebrew1, false)))

	// 限定の入れ直しのカードは、担当者が上級生のドリッパーにしか置けない
	rebrew2 := uuid.New()
	if code, body := f.put(t, write(ids(limited.OrderCups[0]), unassigned, placed(4, 2, rebrew2, false))); code != http.StatusUnprocessableEntity || !strings.Contains(body, "上級生") {
		t.Fatalf("limited rebrew card to a non-senior = %d: %s", code, body)
	}
	f.mustPut(t, write(ids(limited.OrderCups[0]), unassigned, placed(3, 2, rebrew2, false)))
	if c := f.cup(t, limited.OrderCups[0].ID); c.EmergencyDripID == nil || *c.EmergencyDripID != rebrew2 || *c.DripID != card2 {
		t.Fatalf("limited rebrew cup = %+v", c)
	}
}

func TestEmergencyLabelClaim(t *testing.T) {
	db, _ := openListenTestDB(t)
	f := newCaosFixture(t, db)
	o1 := f.createOrder(t, 1, line(f.blend, f.blend))
	cupID := o1.OrderCups[0].ID

	// 緊急でないカップは付けられない
	if code, res := f.claim(t, o1, cupID); code != http.StatusOK || res.Claimed {
		t.Fatalf("claim a cup without emergency = %d %+v", code, res)
	}
	if code, _ := f.claim(t, o1, uuid.New()); code != http.StatusNotFound {
		t.Fatalf("claim a missing cup = %d, want 404", code)
	}
	f.mustEmergency(t, false, cupID)

	// レジが何台あっても、付けられるのは 1 台だけ
	const n = 12
	var wg sync.WaitGroup
	results := make([]models.EmergencyLabelClaim, n)
	codes := make([]int, n)
	for i := range n {
		wg.Add(1)
		go func() {
			defer wg.Done()
			codes[i], results[i] = f.claim(t, o1, cupID)
		}()
	}
	wg.Wait()
	var claimedAt *time.Time
	claimed := 0
	for i := range n {
		if codes[i] != http.StatusOK {
			t.Fatalf("claim = %d", codes[i])
		}
		if results[i].Claimed {
			claimed++
			claimedAt = results[i].EmergencyPrintedAt
		}
	}
	if claimed != 1 || claimedAt == nil {
		t.Fatalf("claimed %d times, want once", claimed)
	}
	if c := f.cup(t, cupID); !msEqual(c.EmergencyPrintedAt, claimedAt) {
		t.Fatalf("emergency_printed_at = %v, want %v", c.EmergencyPrintedAt, claimedAt)
	}
	// 付けたあとはもう付けられない（つなぎ直して受け直しても印刷しない）
	if _, res := f.claim(t, o1, cupID); res.Claimed || res.EmergencyPrintedAt == nil {
		t.Fatalf("claim after printed = %+v", res)
	}

	// 失敗したら空に戻す。違う時刻では戻さない（409）
	if code := f.release(t, o1, cupID, claimedAt.Add(time.Second)); code != http.StatusConflict {
		t.Fatalf("release with another time = %d, want 409", code)
	}
	if code := f.release(t, o1, cupID, *claimedAt); code != http.StatusNoContent {
		t.Fatalf("release = %d, want 204", code)
	}
	if c := f.cup(t, cupID); c.EmergencyPrintedAt != nil || c.EmergencyAt == nil {
		t.Fatalf("cup after release = %+v", c)
	}
	// 戻したら、次の更新でまた付けられる
	if _, res := f.claim(t, o1, cupID); !res.Claimed {
		t.Fatal("could not claim again after the release")
	}
}

// 中断と「次へ」が同時でも、1 つのドリッパーで抽出中は 1 枚のまま
func TestCaosEmergencyConcurrentWithNext(t *testing.T) {
	db, _ := openListenTestDB(t)
	f := newCaosFixture(t, db)
	for round := range 5 {
		dripper := round%caosDrippers + 1
		o1 := f.createOrder(t, 100+round*3, line(f.blend))
		o2 := f.createOrder(t, 101+round*3, line(f.blend))
		o3 := f.createOrder(t, 102+round*3, line(f.blend))
		c1, c2, c3 := uuid.New(), uuid.New(), uuid.New()
		f.mustPut(t,
			write(ids(o1.OrderCups[0]), unassigned, placed(dripper, 1, c1, true)),
			write(ids(o2.OrderCups[0]), unassigned, placed(dripper, 2, c2, false)),
			write(ids(o3.OrderCups[0]), unassigned, placed(dripper, 3, c3, false)),
		)
		var wg sync.WaitGroup
		wg.Add(2)
		go func() {
			defer wg.Done()
			f.emergency(t, true, o1.OrderCups[0].ID)
		}()
		go func() {
			defer wg.Done()
			f.next(t, dripper, &c1)
		}()
		wg.Wait()
		start, end := caosToday(time.Now())
		if n, err := countBrewing(db, dripper, start, end); err != nil || n != 1 {
			t.Fatalf("round %d: brewing = %d %v, want 1", round, n, err)
		}
		if err := db.Exec("DELETE FROM order_cups WHERE dripper = ?", dripper).Error; err != nil {
			t.Fatal(err)
		}
	}
}
