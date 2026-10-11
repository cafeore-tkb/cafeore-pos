package handlers

import (
	"encoding/json"
	"net/http"
	"slices"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"cafeore-pos/api/internal/models"
)

// undoState は DB の今のカップ（入れ直しも）の値と準備完了（「1つ戻す」の current・restore に送る形）。
func (f *caosFixture) undoState(t *testing.T, id uuid.UUID) map[string]any {
	t.Helper()
	rows, err := readCaosUnits(f.db, "c.id = ?", id)
	if err != nil || len(rows) != 1 {
		t.Fatalf("cup %s: %v %d", id, err, len(rows))
	}
	return map[string]any{"state": f.emergencyState(t, id), "ready_at": rows[0].ReadyAt}
}

// undo は POST /api/caos/undo を呼ぶ。restore はカップごとの操作の前の値（undoState）、current は DB の今の値
func (f *caosFixture) undo(t *testing.T, restore map[uuid.UUID]map[string]any) (int, string) {
	t.Helper()
	var cups []map[string]any
	for id, r := range restore {
		cups = append(cups, map[string]any{"cup_id": id, "current": f.undoState(t, id), "restore": r})
	}
	body, _ := json.Marshal(map[string]any{"cups": cups})
	w := callWithParams(t, f.caos.UndoCaosCups, http.MethodPost, string(body), nil)
	return w.Code, w.Body.String()
}

func TestCaosUndoOnDB(t *testing.T) {
	db := openCaosTestDB(t)
	f := newCaosFixture(t, db)
	o1 := f.createOrder(t, 1, line(f.blend, f.blend), line(f.milk))
	o2 := f.createOrder(t, 2, line(f.blend))
	o3 := f.createOrder(t, 3, line(f.blend))
	cup1, cup2, cup3 := o1.OrderCups[0].ID, o2.OrderCups[0].ID, o3.OrderCups[0].ID
	card1, card2, card3 := uuid.New(), uuid.New(), uuid.New()
	expectLane := func(dripper int, wantBrewing []uuid.UUID, wantQueued ...uuid.UUID) {
		t.Helper()
		if brewing, queued := f.lane(t, dripper); !slices.Equal(brewing, wantBrewing) || !slices.Equal(queued, wantQueued) {
			t.Fatalf("dripper %d = %v / %v, want %v / %v", dripper, brewing, queued, wantBrewing, wantQueued)
		}
	}

	// 割当（空いているドリッパーで始めた）を戻すと未割当に戻り、抽出の開始の時刻も消える
	before1 := map[uuid.UUID]map[string]any{o1.OrderCups[0].ID: f.undoState(t, o1.OrderCups[0].ID), o1.OrderCups[1].ID: f.undoState(t, o1.OrderCups[1].ID)}
	f.mustPut(t, write(ids(o1.OrderCups[:2]...), unassigned, placed(1, card1, true)))
	expectLane(1, []uuid.UUID{card1})
	if code, body := f.undo(t, before1); code != http.StatusNoContent {
		t.Fatalf("undo assign = %d: %s", code, body)
	}
	if cup := f.cup(t, cup1); cup.Dripper != nil || cup.DripID != nil || cup.BrewStartedAt != nil {
		t.Fatalf("cup = %+v, want unassigned", cup)
	}
	expectLane(1, nil)

	// 戻す時刻は今のままか消すだけ（新しい時刻は書けない）。ドリッパーの無いカップに順番は書けない
	f.mustPut(t, write(ids(o1.OrderCups[:2]...), unassigned, placed(1, card1, true)))
	forged := f.undoState(t, cup1)
	forged["ready_at"] = "2020-01-01T00:00:00Z"
	if code, _ := f.undo(t, map[uuid.UUID]map[string]any{cup1: forged}); code != http.StatusBadRequest {
		t.Fatalf("undo to a new time = %d, want 400", code)
	}
	if code, _ := f.undo(t, map[uuid.UUID]map[string]any{cup1: {"state": map[string]any{"dripper": nil, "dripper_position": 1, "drip_id": nil, "brew_started_at": nil, "brew_finished_at": nil}, "ready_at": nil}}); code != http.StatusBadRequest {
		t.Fatalf("undo to a position without a dripper = %d, want 400", code)
	}

	// 「次へ」を戻すと、終えたカードは抽出中に戻って準備完了が外れ、始めたカードは待機に戻る
	f.mustPut(t, write(ids(o2.OrderCups[0]), unassigned, placed(1, card2, false)))
	beforeNext := map[uuid.UUID]map[string]any{}
	for _, id := range []uuid.UUID{o1.OrderCups[0].ID, o1.OrderCups[1].ID, cup2} {
		beforeNext[id] = f.undoState(t, id)
	}
	f.wait()
	if code := f.next(t, 1, &card1); code != http.StatusNoContent {
		t.Fatalf("next = %d", code)
	}
	expectLane(1, []uuid.UUID{card2})
	var order models.Order
	if err := db.First(&order, "id = ?", o1.ID).Error; err != nil || order.ReadyAt != nil {
		t.Fatalf("order = %+v, want not ready (the milk is left)", order)
	}
	if code, body := f.undo(t, beforeNext); code != http.StatusNoContent {
		t.Fatalf("undo next = %d: %s", code, body)
	}
	expectLane(1, []uuid.UUID{card1}, card2)
	if cup := f.cup(t, cup1); cup.ReadyAt != nil || cup.BrewFinishedAt != nil || cup.BrewStartedAt == nil {
		t.Fatalf("cup = %+v, want brewing and not ready", cup)
	}
	// 戻したあとも「次へ」が押せる
	f.wait()
	if code := f.next(t, 1, &card1); code != http.StatusNoContent {
		t.Fatalf("next after undo = %d", code)
	}

	// ほかの端末があとで変えていたら断り、何も書かない（画面の見ている値が古い）
	f.mustPut(t, write(ids(o3.OrderCups[0]), unassigned, placed(2, card3, false)))
	stale := map[string]any{"cup_id": cup3, "current": f.undoState(t, cup3), "restore": map[string]any{"state": unassigned, "ready_at": nil}}
	f.mustPut(t, write(ids(o3.OrderCups[0]), f.state(t, cup3), placed(3, card3, false)))
	body, _ := json.Marshal(map[string]any{"cups": []any{stale}})
	if w := callWithParams(t, f.caos.UndoCaosCups, http.MethodPost, string(body), nil); w.Code != http.StatusConflict {
		t.Fatalf("undo after another write = %d, want 409", w.Code)
	}
	expectLane(3, nil, card3)

	// 提供済みになったカップは戻さない
	beforeServe := map[uuid.UUID]map[string]any{cup2: f.undoState(t, cup2)}
	f.wait()
	if code := f.next(t, 1, &card2); code != http.StatusNoContent {
		t.Fatalf("next = %d", code)
	}
	if w := callWithParams(t, f.orders.MarkOrderCupServed, http.MethodPatch, "", gin.Params{{Key: "id", Value: o2.ID.String()}, {Key: "cupId", Value: cup2.String()}}); w.Code != http.StatusOK {
		t.Fatalf("PATCH cup served = %d: %s", w.Code, w.Body.String())
	}
	if code, _ := f.undo(t, beforeServe); code != http.StatusConflict {
		t.Fatalf("undo after served = %d, want 409", code)
	}

	// 「次へ」で空いたドリッパーでほかのカードが始まっていたら、終えたカードを抽出中に戻せない
	beforeLast := map[uuid.UUID]map[string]any{cup3: f.undoState(t, cup3)}
	f.wait()
	if code := f.next(t, 3, nil); code != http.StatusNoContent {
		t.Fatalf("next = %d", code)
	}
	f.wait()
	if code := f.next(t, 3, &card3); code != http.StatusNoContent {
		t.Fatalf("next = %d", code)
	}
	o4 := f.createOrder(t, 4, line(f.blend))
	f.mustPut(t, write(ids(o4.OrderCups[0]), unassigned, placed(3, uuid.New(), true)))
	beforeLast[cup3]["state"].(map[string]any)["brew_started_at"] = f.cup(t, cup3).BrewStartedAt
	if code, _ := f.undo(t, beforeLast); code != http.StatusConflict {
		t.Fatalf("undo next onto a busy dripper = %d, want 409", code)
	}
}

// 並べ替えを戻す（ずらしたカードも前の番号に戻す）・ほかの画面があとで統合したカードは分けない・入れ直しのカードも戻せる
func TestCaosUndoCardsOnDB(t *testing.T) {
	db := openCaosTestDB(t)
	f := newCaosFixture(t, db)
	var o []models.Order
	for no := 1; no <= 5; no++ {
		o = append(o, f.createOrder(t, no, line(f.blend)))
	}
	cupOf := func(i int) uuid.UUID { return o[i].OrderCups[0].ID }
	a, b, c := uuid.New(), uuid.New(), uuid.New()
	f.mustPut(t,
		write(ids(o[0].OrderCups[0]), unassigned, placed(1, a, false)),
		write(ids(o[1].OrderCups[0]), unassigned, placed(1, b, false)),
		write(ids(o[2].OrderCups[0]), unassigned, placed(1, c, false)),
	)
	// c を先頭へ（a・b は +1 にずれる）。画面は列のカードを全部覚えて戻す
	before := map[uuid.UUID]map[string]any{}
	for i := range 3 {
		before[cupOf(i)] = f.undoState(t, cupOf(i))
	}
	f.mustPut(t, write(ids(o[2].OrderCups[0]), f.state(t, cupOf(2)), placedBefore(1, c, a)))
	if _, queued := f.lane(t, 1); !slices.Equal(queued, []uuid.UUID{c, a, b}) {
		t.Fatalf("queued = %v", queued)
	}
	if code, body := f.undo(t, before); code != http.StatusNoContent {
		t.Fatalf("undo front = %d: %s", code, body)
	}
	if _, queued := f.lane(t, 1); !slices.Equal(queued, []uuid.UUID{a, b, c}) {
		t.Fatalf("queued after undo = %v, want a b c", queued)
	}

	// 割当のあと、ほかの画面が同じカードに統合したら、戻すとカードが分かれるので断る
	d := uuid.New()
	beforeAssign := map[uuid.UUID]map[string]any{cupOf(3): f.undoState(t, cupOf(3))}
	f.mustPut(t, write(ids(o[3].OrderCups[0]), unassigned, placed(2, d, false)))
	f.mustPut(t, write(ids(o[4].OrderCups[0]), unassigned, placed(2, d, false)))
	if code, _ := f.undo(t, beforeAssign); code != http.StatusConflict {
		t.Fatalf("undo after another merge = %d, want 409", code)
	}

	// 入れ直しのカードの割当も戻せる（入れ直しの行の列を戻す）
	if code, body := f.addEmergencies(t, cupOf(0)); code != http.StatusCreated {
		t.Fatalf("add emergency = %d: %s", code, body)
	}
	e := f.emergencies(t, cupOf(0))[0].ID
	beforeEmergency := map[uuid.UUID]map[string]any{e: f.undoState(t, e)}
	f.mustPut(t, write([]uuid.UUID{e}, f.emergencyState(t, e), placed(3, uuid.New(), true)))
	if code, body := f.undo(t, beforeEmergency); code != http.StatusNoContent {
		t.Fatalf("undo emergency assign = %d: %s", code, body)
	}
	if row := f.emergencies(t, cupOf(0))[0]; row.Dripper != nil || row.BrewStartedAt != nil {
		t.Fatalf("emergency = %+v, want unassigned", row)
	}
}
