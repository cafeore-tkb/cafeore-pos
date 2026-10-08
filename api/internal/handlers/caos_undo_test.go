package handlers

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"cafeore-pos/api/internal/models"
)

// 「1つ戻す」（POST /api/caos/undo）の DB のテスト。LISTEN_TEST_DATABASE_URL を渡したときだけ走る。

// undoState は DB の今のカップの値（CaOS の列・準備完了・提供済み）。画面が覚える「その操作で書いた値」「操作の前の値」と同じ形
func (f *caosFixture) undoState(t *testing.T, id uuid.UUID) map[string]any {
	t.Helper()
	cup := f.cup(t, id)
	s := stateJSON(cupCaosState(&cup))
	s["ready_at"], s["served_at"], s["emergency_at"] = cup.ReadyAt, cup.ServedAt, cup.EmergencyAt
	return s
}

func (f *caosFixture) undoStates(t *testing.T, cups []uuid.UUID) map[uuid.UUID]map[string]any {
	t.Helper()
	out := map[uuid.UUID]map[string]any{}
	for _, id := range cups {
		out[id] = f.undoState(t, id)
	}
	return out
}

// undo は current（その操作で書いた値）から restore（操作の前の値）に書き戻す。
func (f *caosFixture) undo(t *testing.T, current, restore map[uuid.UUID]map[string]any) (int, string) {
	t.Helper()
	var cups []map[string]any
	for id, cur := range current {
		cups = append(cups, map[string]any{"cup_id": id, "current": cur, "restore": restore[id]})
	}
	body, _ := json.Marshal(map[string]any{"cups": cups})
	w := callHandler(t, f.caos.UndoCaosCups, http.MethodPost, string(body))
	return w.Code, w.Body.String()
}

func (f *caosFixture) markCup(t *testing.T, handler gin.HandlerFunc, order models.Order, cup models.OrderCup) {
	t.Helper()
	if w := callWithParams(t, handler, http.MethodPatch, "", gin.Params{{Key: "id", Value: order.ID.String()}, {Key: "cupId", Value: cup.ID.String()}}); w.Code != http.StatusOK {
		t.Fatalf("PATCH cup = %d: %s", w.Code, w.Body.String())
	}
}

func TestCaosUndoWritesOnDB(t *testing.T) {
	db, _ := openListenTestDB(t)
	f := newCaosFixture(t, db)
	o1 := f.createOrder(t, 1, line(f.blend))
	o2 := f.createOrder(t, 2, line(f.blend))
	cup1, cup2 := ids(o1.OrderCups[0]), ids(o2.OrderCups[0])

	// 空いているドリッパーに置いて始めた割当を戻す（抽出中のカードも、自分が書いた値のままなら戻せる）
	before := f.undoStates(t, cup1)
	card1 := uuid.New()
	f.mustPut(t, write(cup1, unassigned, placed(1, 1, card1, true)))
	wrote := f.undoStates(t, cup1)
	if code, body := f.undo(t, wrote, before); code != http.StatusNoContent {
		t.Fatalf("undo assign = %d: %s", code, body)
	}
	if cup := f.cup(t, cup1[0]); cup.Dripper != nil || cup.DripID != nil || cup.BrewStartedAt != nil {
		t.Fatalf("cup = %+v, want unassigned", cup)
	}
	// 同じものをもう一度戻そうとしても、今の値が書いた値と違うので断る
	if code, _ := f.undo(t, wrote, before); code != http.StatusConflict {
		t.Fatalf("second undo = %d, want 409", code)
	}

	// 割当のあと、ほかの画面が同じカードを動かしていたら断る（ほかの画面の操作を消さない）
	f.mustPut(t, write(cup2, unassigned, placed(2, 2, uuid.New(), true)))
	before = f.undoStates(t, cup1)
	f.mustPut(t, write(cup1, unassigned, placed(2, 3, card1, false)))
	wrote = f.undoStates(t, cup1)
	f.mustPut(t, write(cup1, f.state(t, cup1[0]), placed(3, 3, card1, true))) // ほかの iPad が 3 番へ
	code, body := f.undo(t, wrote, before)
	if code != http.StatusConflict || !strings.Contains(body, "ほかの画面") {
		t.Fatalf("undo after another screen = %d %s, want 409", code, body)
	}
	if cup := f.cup(t, cup1[0]); cup.Dripper == nil || *cup.Dripper != 3 {
		t.Fatalf("cup = %+v, want left on dripper 3", cup)
	}

	// 割当のあと、マスターで準備完了にされていたら断る
	o3 := f.createOrder(t, 3, line(f.blend))
	cup3 := ids(o3.OrderCups[0])
	before = f.undoStates(t, cup3)
	f.mustPut(t, write(cup3, unassigned, placed(2, 4, uuid.New(), false)))
	wrote = f.undoStates(t, cup3)
	f.markCup(t, f.orders.MarkOrderCupReady, o3, o3.OrderCups[0])
	if code, body := f.undo(t, wrote, before); code != http.StatusConflict || !strings.Contains(body, "準備完了") {
		t.Fatalf("undo after ready = %d %s, want 409", code, body)
	}

	// 提供済みは書き戻せない（形の違うリクエスト）
	served := f.undoState(t, cup3[0])
	served["served_at"] = served["ready_at"]
	if code, _ := f.undo(t, map[uuid.UUID]map[string]any{cup3[0]: f.undoState(t, cup3[0])}, map[uuid.UUID]map[string]any{cup3[0]: served}); code != http.StatusBadRequest {
		t.Fatalf("undo to served = %d, want 400", code)
	}
}

func TestCaosUndoNextOnDB(t *testing.T) {
	db, _ := openListenTestDB(t)
	f := newCaosFixture(t, db)
	o1 := f.createOrder(t, 1, line(f.blend, f.blend))
	o2 := f.createOrder(t, 2, line(f.blend))
	card1, card2 := uuid.New(), uuid.New()
	f.mustPut(t,
		write(ids(o1.OrderCups...), unassigned, placed(1, 1, card1, true)),
		write(ids(o2.OrderCups[0]), unassigned, placed(1, 2, card2, false)),
	)
	all := append(ids(o1.OrderCups...), o2.OrderCups[0].ID)

	// 「次へ」を戻す：終えたカードを抽出中に戻して準備完了を外し、始めたカードを待機に戻す
	before := f.undoStates(t, all)
	if code, _ := f.next(t, 1, &card1); code != http.StatusOK {
		t.Fatalf("next = %d", code)
	}
	wrote := f.undoStates(t, all)
	var order models.Order
	if err := db.First(&order, "id = ?", o1.ID).Error; err != nil || order.ReadyAt == nil {
		t.Fatalf("order = %+v, want ready after next", order)
	}
	if code, body := f.undo(t, wrote, before); code != http.StatusNoContent {
		t.Fatalf("undo next = %d: %s", code, body)
	}
	for _, id := range ids(o1.OrderCups...) {
		if cup := f.cup(t, id); cup.ReadyAt != nil || cup.BrewFinishedAt != nil || cup.BrewStartedAt == nil {
			t.Fatalf("cup = %+v, want brewing again", cup)
		}
	}
	if cup := f.cup(t, o2.OrderCups[0].ID); cup.BrewStartedAt != nil {
		t.Fatalf("cup = %+v, want queued again", cup)
	}
	var undone models.Order
	if err := db.First(&undone, "id = ?", o1.ID).Error; err != nil || undone.ReadyAt != nil {
		t.Fatalf("order = %+v, want not ready after undo", undone)
	}
	// 戻したあとも「次へ」は今までどおり押せる
	if code, _ := f.next(t, 1, &card1); code != http.StatusOK {
		t.Fatalf("next after undo = %d", code)
	}

	// 「次へ」のあと提供済みにされていたら断る（提供の操作を消さない）
	wrote = f.undoStates(t, all)
	f.markCup(t, f.orders.MarkOrderCupServed, o1, o1.OrderCups[0])
	code, body := f.undo(t, wrote, before)
	if code != http.StatusConflict || !strings.Contains(body, "提供済み") {
		t.Fatalf("undo after served = %d %s, want 409", code, body)
	}
	if cup := f.cup(t, o1.OrderCups[1].ID); cup.ReadyAt == nil || cup.BrewFinishedAt == nil {
		t.Fatalf("cup = %+v, want left finished", cup)
	}

	// 「次へ」のあと、ほかの画面がもう一度「次へ」を押していたら断る
	o3 := f.createOrder(t, 3, line(f.blend))
	card3 := uuid.New()
	f.mustPut(t, write(ids(o3.OrderCups[0]), unassigned, placed(2, 1, card3, true)))
	before = f.undoStates(t, ids(o3.OrderCups[0]))
	if code, _ := f.next(t, 2, &card3); code != http.StatusOK {
		t.Fatalf("next = %d", code)
	}
	wrote = f.undoStates(t, ids(o3.OrderCups[0]))
	// 空いたドリッパーにほかの画面が置いて始めたら、終えたカードを抽出中に戻すと 2 枚になるので断る
	o4 := f.createOrder(t, 4, line(f.blend))
	f.mustPut(t, write(ids(o4.OrderCups[0]), unassigned, placed(2, 2, uuid.New(), true)))
	if code, body := f.undo(t, wrote, before); code != http.StatusConflict || !strings.Contains(body, "抽出中") {
		t.Fatalf("undo with another brewing card = %d %s, want 409", code, body)
	}
	if cup := f.cup(t, o3.OrderCups[0].ID); cup.BrewFinishedAt == nil || cup.ReadyAt == nil {
		t.Fatalf("cup = %+v, want left finished", cup)
	}
}

// 戻した結果が指名（CaOS7）・限定（CaOS8）の決まりに反するなら断る。緊急（CaOS10）のカップは入れ直しのカードで戻す
func TestCaosUndoRulesOnDB(t *testing.T) {
	db, _ := openListenTestDB(t)
	f := newCaosFixture(t, db)
	special := models.ItemType{Name: "special-" + uuid.NewString(), DisplayName: "特別", SeniorOnly: true}
	geisha := models.Item{Name: "ゲイシャ", Abbr: "ゲ", ItemType: special}
	if err := db.Create(&geisha).Error; err != nil {
		t.Fatal(err)
	}
	f.mustPutLane(t, 1, "山田", true)
	f.mustPutLane(t, 2, "高橋", true)

	// 限定：1 番から 2 番へ移したあと、1 番の担当者が上級生でない人に替わっていたら、1 番へは戻せない
	limited := f.createOrder(t, 1, line(geisha))
	cupL := ids(limited.OrderCups[0])
	cardL := uuid.New()
	f.mustPut(t, write(cupL, unassigned, placed(1, 1, cardL, false)))
	before := f.undoStates(t, cupL)
	f.mustPut(t, write(cupL, f.state(t, cupL[0]), placed(2, 1, cardL, false)))
	wrote := f.undoStates(t, cupL)
	f.mustPutLane(t, 1, "佐藤", false)
	if code, body := f.undo(t, wrote, before); code != http.StatusUnprocessableEntity || !strings.Contains(body, "上級生") {
		t.Fatalf("undo a limited cup to a non-senior = %d %s, want 422", code, body)
	}
	if cup := f.cup(t, cupL[0]); *cup.Dripper != 2 {
		t.Fatalf("cup = %+v, want left on 2", cup)
	}
	// 担当者を上級生に戻せば戻せる
	f.mustPutLane(t, 1, "山田", true)
	if code, body := f.undo(t, wrote, before); code != http.StatusNoContent {
		t.Fatalf("undo a limited cup to a senior = %d %s", code, body)
	}
	// 同じドリッパーの中の順番を戻すのは、担当者が上級生でなくてもできる（PUT /api/caos/cups と同じ）
	before = f.undoStates(t, cupL)
	f.mustPut(t, write(cupL, f.state(t, cupL[0]), placed(1, 0.5, cardL, false)))
	wrote = f.undoStates(t, cupL)
	f.mustPutLane(t, 1, "佐藤", false)
	if code, body := f.undo(t, wrote, before); code != http.StatusNoContent {
		t.Fatalf("undo a reorder in the same dripper = %d %s", code, body)
	}

	// 指名：未割当に戻したあと、注文の明細の指名が替わっていたら、元のドリッパーへは戻せない
	nominated := f.createOrder(t, 2, line(f.blend))
	cupN := ids(nominated.OrderCups[0])
	f.mustPut(t, write(cupN, unassigned, placed(2, 2, uuid.New(), false)))
	before = f.undoStates(t, cupN)
	f.mustPut(t, write(cupN, f.state(t, cupN[0]), toUnassigned))
	wrote = f.undoStates(t, cupN)
	if err := db.Model(&models.OrderMenu{}).Where("id = ?", nominated.OrderMenus[0].ID).Update("dripper", 3).Error; err != nil {
		t.Fatal(err)
	}
	if code, body := f.undo(t, wrote, before); code != http.StatusUnprocessableEntity || !strings.Contains(body, "指名のあるカップは 3 番") {
		t.Fatalf("undo a nominated cup to another dripper = %d %s, want 422", code, body)
	}

	// 緊急：操作のあとで緊急にされたカップは戻さない
	plain := f.createOrder(t, 3, line(f.blend))
	cupP := ids(plain.OrderCups[0])
	cardP := uuid.New()
	f.mustPut(t, write(cupP, unassigned, placed(4, 1, cardP, true)))
	before = f.undoStates(t, cupP)
	if code, _ := f.next(t, 4, &cardP); code != http.StatusOK {
		t.Fatalf("next = %d", code)
	}
	wrote = f.undoStates(t, cupP)
	f.mustEmergency(t, false, cupP[0])
	if code, body := f.undo(t, wrote, before); code != http.StatusConflict || !strings.Contains(body, "緊急") {
		t.Fatalf("undo after emergency = %d %s, want 409", code, body)
	}
	// 入れ直しのカードの割当は戻せる（カードは emergency_drip_id に書き戻し、最初に淹れたカードの drip_id は残す）
	before = f.undoStates(t, cupP)
	rebrew := uuid.New()
	f.mustPut(t, write(cupP, f.state(t, cupP[0]), placed(4, 2, rebrew, true)))
	wrote = f.undoStates(t, cupP)
	if code, body := f.undo(t, wrote, before); code != http.StatusNoContent {
		t.Fatalf("undo a rebrew assign = %d %s", code, body)
	}
	if cup := f.cup(t, cupP[0]); cup.EmergencyAt == nil || cup.EmergencyDripID != nil || cup.Dripper != nil || cup.DripID == nil || *cup.DripID != cardP {
		t.Fatalf("rebrew cup after undo = %+v", cup)
	}
	// 緊急を書き戻すのは形の違うリクエスト
	notEmergency := f.undoState(t, cupP[0])
	notEmergency["emergency_at"] = nil
	if code, _ := f.undo(t, map[uuid.UUID]map[string]any{cupP[0]: f.undoState(t, cupP[0])}, map[uuid.UUID]map[string]any{cupP[0]: notEmergency}); code != http.StatusBadRequest {
		t.Fatalf("undo an emergency = %d, want 400", code)
	}
}
