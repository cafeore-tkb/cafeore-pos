package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"cafeore-pos/api/internal/models"
)

// addEmergencies は POST /api/cup-emergencies を呼ぶ。
func (f *caosFixture) addEmergencies(t *testing.T, cupIDs ...uuid.UUID) (int, string) {
	t.Helper()
	body, _ := json.Marshal(map[string]any{"order_cup_ids": cupIDs})
	w := callWithParams(t, f.caos.CreateCupEmergencies, http.MethodPost, string(body), nil)
	return w.Code, w.Body.String()
}

// cancelEmergency は DELETE /api/cup-emergencies/{id} を呼ぶ。
func (f *caosFixture) cancelEmergency(t *testing.T, id uuid.UUID) (int, string) {
	t.Helper()
	w := callWithParams(t, f.caos.DeleteCupEmergency, http.MethodDelete, "", gin.Params{{Key: "id", Value: id.String()}})
	return w.Code, w.Body.String()
}

// emergencies はカップの入れ直し（足した順）。
func (f *caosFixture) emergencies(t *testing.T, cupID uuid.UUID) []models.CupEmergency {
	t.Helper()
	var rows []models.CupEmergency
	if err := f.db.Order("created_at, id").Find(&rows, "order_cup_id = ?", cupID).Error; err != nil {
		t.Fatal(err)
	}
	return rows
}

// emergencyState は入れ直しの今の値（before に送る）。
func (f *caosFixture) emergencyState(t *testing.T, id uuid.UUID) map[string]any {
	t.Helper()
	rows, err := readCaosUnits(f.db, "c.id = ?", id)
	if err != nil || len(rows) != 1 {
		t.Fatalf("emergency %s: %v %d", id, err, len(rows))
	}
	s := caosCupState(&rows[0].OrderCup)
	return map[string]any{"dripper": s.Dripper, "dripper_position": s.DripperPosition, "drip_id": s.DripId,
		"brew_started_at": s.BrewStartedAt, "brew_finished_at": s.BrewFinishedAt}
}

func TestCupEmergencyOnDB(t *testing.T) {
	db := openCaosTestDB(t)
	f := newCaosFixture(t, db)
	o1 := f.createOrder(t, 1, line(f.blend, f.blend), line(f.milk))
	o2 := f.createOrder(t, 2, line(f.blend))
	card1 := uuid.New()
	f.mustPut(t, write(ids(o1.OrderCups[0]), unassigned, placed(1, card1, true)))
	f.wait()
	if code := f.next(t, 1, &card1); code != http.StatusNoContent {
		t.Fatalf("next = %d", code)
	}
	first := f.cup(t, o1.OrderCups[0].ID)

	// 同じカップを何度でも入れ直せる。カップの列（最初の抽出の記録）は変えない
	for range 2 {
		if code, body := f.addEmergencies(t, o1.OrderCups[0].ID); code != http.StatusCreated {
			t.Fatalf("POST = %d: %s", code, body)
		}
	}
	rows := f.emergencies(t, o1.OrderCups[0].ID)
	if len(rows) != 2 || rows[0].Dripper != nil || rows[0].DripID != nil {
		t.Fatalf("emergencies = %+v", rows)
	}
	if cup := f.cup(t, o1.OrderCups[0].ID); !sameCaosState(&cup, caosCupState(&first)) || !timeEqual(cup.ReadyAt, first.ReadyAt) {
		t.Fatalf("cup = %+v, want unchanged %+v", cup, first)
	}

	// 注文の応答に載る（足した順）
	var order models.Order
	if err := preloadOrder(db).First(&order, "id = ?", o1.ID).Error; err != nil {
		t.Fatal(err)
	}
	if got := toOrderResponse(&order).Cups[0].Emergencies; len(got) != 2 || got[0].Id != rows[0].ID {
		t.Fatalf("response emergencies = %+v", got)
	}

	// 断るもの：抽出の要らないカップ・前の日の注文・消えたカップ・形の違うリクエスト
	old := f.createOrderAt(t, 9, time.Now().Add(-48*time.Hour), line(f.blend))
	for name, tc := range map[string]struct {
		ids  []uuid.UUID
		code int
	}{
		"milk":      {ids(o1.OrderCups[2]), http.StatusBadRequest},
		"yesterday": {ids(old.OrderCups[0]), http.StatusBadRequest},
		"missing":   {[]uuid.UUID{uuid.New()}, http.StatusConflict},
		"twice":     {ids(o2.OrderCups[0], o2.OrderCups[0]), http.StatusBadRequest},
		"empty":     {nil, http.StatusBadRequest},
	} {
		if code, body := f.addEmergencies(t, tc.ids...); code != tc.code {
			t.Fatalf("%s = %d, want %d: %s", name, code, tc.code, body)
		}
	}
	if rows := f.emergencies(t, o2.OrderCups[0].ID); len(rows) != 0 {
		t.Fatalf("a rejected request added %d", len(rows))
	}

	// 入れ直しの割当・「次へ」はカップと同じ書き込みで、入れ直しの行の列を書く
	e1 := rows[0].ID
	emergencyCard := uuid.New()
	f.mustPut(t, write([]uuid.UUID{e1}, unassigned, placed(2, emergencyCard, true)))
	if brewing, _ := f.lane(t, 2); len(brewing) != 1 || brewing[0] != emergencyCard {
		t.Fatalf("lane 2 = %v, want the emergency card", brewing)
	}
	if cup := f.cup(t, o1.OrderCups[0].ID); !sameCaosState(&cup, caosCupState(&first)) {
		t.Fatalf("placing the emergency changed the cup: %+v", cup)
	}
	f.wait()
	if code := f.next(t, 2, &emergencyCard); code != http.StatusNoContent {
		t.Fatalf("next of the emergency = %d", code)
	}
	if got := f.emergencies(t, o1.OrderCups[0].ID)[0]; got.BrewStartedAt == nil || got.BrewFinishedAt == nil {
		t.Fatalf("emergency after next = %+v", got)
	}
	// 準備完了のカップを入れ直しても、準備完了の時刻はそのまま
	if cup := f.cup(t, o1.OrderCups[0].ID); !timeEqual(cup.ReadyAt, first.ReadyAt) {
		t.Fatalf("ready_at = %v, want %v", cup.ReadyAt, first.ReadyAt)
	}

	// 準備中のカップの入れ直しの「次へ」は、カップを準備完了にする（注文の状態もカップから決め直す）
	f.mustPut(t, write(ids(o2.OrderCups[0]), unassigned, placed(3, uuid.New(), false)))
	if code, body := f.addEmergencies(t, o2.OrderCups[0].ID); code != http.StatusCreated {
		t.Fatalf("POST = %d: %s", code, body)
	}
	e2 := f.emergencies(t, o2.OrderCups[0].ID)[0].ID
	card3 := uuid.New()
	f.mustPut(t, write([]uuid.UUID{e2}, unassigned, placed(4, card3, true)))
	f.wait()
	if code := f.next(t, 4, &card3); code != http.StatusNoContent {
		t.Fatalf("next = %d", code)
	}
	var after models.Order
	if err := db.First(&after, "id = ?", o2.ID).Error; err != nil || after.ReadyAt == nil {
		t.Fatalf("order = %+v, want ready", after)
	}
	// 入れ直したカップの最初のカード（3 番の待機）はそのまま残る（準備完了なので終わりとみなす）
	if cup := f.cup(t, o2.OrderCups[0].ID); cup.Dripper == nil || *cup.Dripper != 3 || cup.ReadyAt == nil {
		t.Fatalf("cup = %+v", cup)
	}
}

// 入れ直しのカードも、順番・統合・指名・上級生のみはカップと同じ決まり
func TestCupEmergencyCardRulesOnDB(t *testing.T) {
	db := openCaosTestDB(t)
	f := newCaosFixture(t, db)
	o1 := f.createOrder(t, 1, line(f.blend), line(f.blend))
	o2 := f.createOrder(t, 2, line(f.blend))
	if code, body := f.addEmergencies(t, o1.OrderCups[0].ID, o1.OrderCups[1].ID); code != http.StatusCreated {
		t.Fatalf("POST = %d: %s", code, body)
	}
	e1 := f.emergencies(t, o1.OrderCups[0].ID)[0].ID
	e2 := f.emergencies(t, o1.OrderCups[1].ID)[0].ID

	// 待機の途中に入れると、後ろのカード（カップも入れ直しも）の番号をずらす
	cardA, cardB, cardE := uuid.New(), uuid.New(), uuid.New()
	f.mustPut(t,
		write(ids(o2.OrderCups[0]), unassigned, placed(1, cardA, true)),
		write([]uuid.UUID{e1}, unassigned, placed(1, cardB, false)),
	)
	f.mustPut(t, write([]uuid.UUID{e2}, unassigned, placedBefore(1, cardE, cardB)))
	if _, queued := f.lane(t, 1); len(queued) != 2 || queued[0] != cardE || queued[1] != cardB {
		t.Fatalf("queued = %v, want [%v %v]", queued, cardE, cardB)
	}

	// 入れ直しは入れ直しどうしでだけ 1 枚のカードにできる（緊急でないカップと同じカードにすると、緊急の取り消しと食い違う）。最大 2 杯
	o3 := f.createOrder(t, 3, line(f.blend))
	o4 := f.createOrder(t, 4, line(f.blend))
	if code, body := f.put(t, write(ids(o3.OrderCups[0]), unassigned, placed(1, cardE, false))); code != http.StatusBadRequest || !strings.Contains(body, "緊急") {
		t.Fatalf("a cup on an emergency card = %d: %s", code, body)
	}
	if code, body := f.addEmergencies(t, o3.OrderCups[0].ID); code != http.StatusCreated {
		t.Fatalf("POST = %d: %s", code, body)
	}
	f.mustPut(t, write([]uuid.UUID{f.emergencies(t, o3.OrderCups[0].ID)[0].ID}, unassigned, placed(1, cardE, false)))
	if code, _ := f.put(t, write(ids(o4.OrderCups[0]), unassigned, placed(1, cardE, false))); code != http.StatusBadRequest {
		t.Fatalf("third cup on a card = %d, want 400", code)
	}

	// 指名のあるカップの入れ直しは、その番号のドリッパーにしか置けない
	f.nominate(t, o4.OrderMenus[0], intPtr(5), nil)
	if code, body := f.addEmergencies(t, o4.OrderCups[0].ID); code != http.StatusCreated {
		t.Fatalf("POST = %d: %s", code, body)
	}
	e4 := f.emergencies(t, o4.OrderCups[0].ID)[0].ID
	if code, body := f.put(t, write([]uuid.UUID{e4}, unassigned, placed(6, uuid.New(), false))); code != http.StatusBadRequest || !strings.Contains(body, "指名") {
		t.Fatalf("nominated emergency on another dripper = %d: %s", code, body)
	}
	f.mustPut(t, write([]uuid.UUID{e4}, unassigned, placed(5, uuid.New(), false)))

	// 上級生のみのカップの入れ直しは、上級生のドリッパーにしか置けない
	special := models.ItemType{Name: "special-" + uuid.NewString(), DisplayName: "特別", SeniorOnly: true}
	geisha := models.Item{Name: "ゲイシャ", Abbr: "ゲ", ItemType: special}
	if err := db.Create(&geisha).Error; err != nil {
		t.Fatal(err)
	}
	o5 := f.createOrder(t, 5, line(geisha))
	if code, body := f.addEmergencies(t, o5.OrderCups[0].ID); code != http.StatusCreated {
		t.Fatalf("POST = %d: %s", code, body)
	}
	e5 := f.emergencies(t, o5.OrderCups[0].ID)[0].ID
	if code, body := f.put(t, write([]uuid.UUID{e5}, unassigned, placed(2, uuid.New(), false))); code != http.StatusBadRequest || !strings.Contains(body, "上級生") {
		t.Fatalf("limited emergency without a senior = %d: %s", code, body)
	}
	f.mustPutLane(t, 2, "山田", true)
	f.mustPut(t, write([]uuid.UUID{e5}, unassigned, placed(2, uuid.New(), false)))
	// 指名のあるカップの入れ直しは指名を優先し、指名のドリッパー（担当者のいない 3rd）に置ける
	o6 := f.createOrder(t, 6, line(geisha))
	f.nominate(t, o6.OrderMenus[0], intPtr(3), nil)
	if code, body := f.addEmergencies(t, o6.OrderCups[0].ID); code != http.StatusCreated {
		t.Fatalf("POST = %d: %s", code, body)
	}
	f.mustPut(t, write([]uuid.UUID{f.emergencies(t, o6.OrderCups[0].ID)[0].ID}, unassigned, placed(3, uuid.New(), false)))

	// 未割当に戻す（before は入れ直しの列）
	f.mustPut(t, write([]uuid.UUID{e5}, f.emergencyState(t, e5), toUnassigned))
	if state := f.emergencyState(t, e5); state["dripper"] != (*int)(nil) {
		t.Fatalf("emergency = %v, want unassigned", state)
	}
}

// 注文を編集して外したカップ・消した注文のカップの入れ直しも消える。引き継いだカップの入れ直しは残る
func TestCupEmergencyFollowsOrderOnDB(t *testing.T) {
	db := openCaosTestDB(t)
	f := newCaosFixture(t, db)
	o := f.createOrder(t, 1, line(f.blend), line(f.blend))
	if code, body := f.addEmergencies(t, ids(o.OrderCups...)...); code != http.StatusCreated {
		t.Fatalf("POST = %d: %s", code, body)
	}
	edit := models.OrderUpdateRequest{OrderId: 1, BillingAmount: 500, Received: 500, MenuIds: []models.MenuInfoCreate{
		{MenuId: f.menu.ID, OrderMenuId: &o.OrderMenus[0].ID},
	}}
	body, _ := json.Marshal(edit)
	if w := callWithParams(t, f.orders.UpdateOrder, http.MethodPut, string(body), gin.Params{{Key: "id", Value: o.ID.String()}}); w.Code != http.StatusOK {
		t.Fatalf("PUT order = %d: %s", w.Code, w.Body)
	}
	if kept, removed := f.emergencies(t, o.OrderCups[0].ID), f.emergencies(t, o.OrderCups[1].ID); len(kept) != 1 || len(removed) != 0 {
		t.Fatalf("after edit: kept %d, removed %d", len(kept), len(removed))
	}

	if err := f.orders.deleteOrder(o.ID); err != nil {
		t.Fatal(err)
	}
	var left int64
	if err := db.Model(&models.CupEmergency{}).Count(&left).Error; err != nil || left != 0 {
		t.Fatalf("emergencies after delete = %d (%v)", left, err)
	}
}

// 取り消せるのは、まだ抽出を始めていない（未割当か待機の）入れ直しだけ
func TestCupEmergencyCancelOnDB(t *testing.T) {
	db := openCaosTestDB(t)
	f := newCaosFixture(t, db)
	o := f.createOrder(t, 1, line(f.blend))
	cupID := o.OrderCups[0].ID
	add := func() uuid.UUID {
		t.Helper()
		code, body := f.addEmergencies(t, cupID)
		var res models.CupEmergencyCreateResponse
		if code != http.StatusCreated || json.Unmarshal([]byte(body), &res) != nil || len(res.Ids) != 1 {
			t.Fatalf("POST = %d: %s", code, body)
		}
		return res.Ids[0]
	}

	// 未割当
	unassignedID := add()
	if code, body := f.cancelEmergency(t, unassignedID); code != http.StatusNoContent {
		t.Fatalf("cancel unassigned = %d: %s", code, body)
	}
	if rows := f.emergencies(t, cupID); len(rows) != 0 {
		t.Fatalf("emergencies after cancel = %+v", rows)
	}
	// 2 回目（ほかの端末で取り消した）・無い入れ直し・カップの ID は 409
	for name, id := range map[string]uuid.UUID{"again": unassignedID, "missing": uuid.New(), "cup": cupID} {
		if code, _ := f.cancelEmergency(t, id); code != http.StatusConflict {
			t.Fatalf("cancel %s = %d, want 409", name, code)
		}
	}

	// 待機（統合したカップは残る）
	queuedID := add()
	card := uuid.New()
	other := f.createOrder(t, 2, line(f.blend))
	f.mustPut(t, write(ids(other.OrderCups[0]), unassigned, placed(1, uuid.New(), true)))
	f.mustPut(t, write([]uuid.UUID{queuedID}, unassigned, placed(1, card, false)))
	if code, body := f.cancelEmergency(t, queuedID); code != http.StatusNoContent {
		t.Fatalf("cancel queued = %d: %s", code, body)
	}
	if _, queued := f.lane(t, 1); len(queued) != 0 {
		t.Fatalf("queued after cancel = %v", queued)
	}

	// 抽出を始めたら取り消せない（何も消さない）
	brewingID := add()
	f.mustPut(t, write([]uuid.UUID{brewingID}, unassigned, placed(2, uuid.New(), true)))
	if code, body := f.cancelEmergency(t, brewingID); code != http.StatusBadRequest || !strings.Contains(body, "抽出") {
		t.Fatalf("cancel brewing = %d: %s", code, body)
	}
	if rows := f.emergencies(t, cupID); len(rows) != 1 || rows[0].ID != brewingID {
		t.Fatalf("emergencies = %+v, want the brewing one", rows)
	}

	// 前の日の注文の入れ直しは取り消せない
	old := f.createOrderAt(t, 9, time.Now().Add(-48*time.Hour), line(f.blend))
	oldID := uuid.New()
	if err := db.Create(&models.CupEmergency{ID: oldID, OrderCupID: old.OrderCups[0].ID, CreatedAt: old.CreatedAt}).Error; err != nil {
		t.Fatal(err)
	}
	if code, _ := f.cancelEmergency(t, oldID); code != http.StatusBadRequest {
		t.Fatalf("cancel yesterday = %d, want 400", code)
	}
}

// 入れ直しで使うアイテムの在庫とカップは、足したときの設定で減り、取り消すと戻る
func TestCupEmergencyStockOnDB(t *testing.T) {
	db := openCaosTestDB(t)
	f := newCaosFixture(t, db)
	inv := &Inventory{db: db}
	itemStock := models.StockResource{Kind: string(models.StockResourceKindItem), ItemID: &f.blend.ID, Unit: "g", PerServing: 15}
	cupStock := models.StockResource{Kind: string(models.StockResourceKindCup), Name: "カップ", Unit: "個", PerServing: 1,
		ItemTypes: []models.StockResourceItemType{{ItemTypeID: f.blend.ItemTypeID}}}
	// ミルクはカップを作るが、カップの種類に入れていないので減らない
	milkStock := models.StockResource{Kind: string(models.StockResourceKindItem), ItemID: &f.milk.ID, Unit: "ml", PerServing: 100}
	for _, r := range []*models.StockResource{&itemStock, &cupStock, &milkStock} {
		if err := db.Create(r).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&models.StockEvent{ResourceID: r.ID, Kind: string(models.StockEventKindCount), Quantity: 1000, CreatedAt: time.Now().Add(-time.Hour)}).Error; err != nil {
			t.Fatal(err)
		}
	}
	// want は在庫対象ごとの {減った量, 回数, 直近 1 時間の回数}
	expect := func(label string, want map[uuid.UUID][3]float64) {
		t.Helper()
		snapshots, err := inv.snapshots(context.Background(), nil)
		if err != nil {
			t.Fatal(err)
		}
		for _, s := range snapshots {
			w := want[s.Resource.ID]
			if s.Consumed != w[0] || float64(s.Servings) != w[1] || float64(s.ServingsLastHour) != w[2] {
				t.Errorf("%s: %s consumed=%v servings=%d last hour=%d, want %v", label, s.Resource.DisplayName(), s.Consumed, s.Servings, s.ServingsLastHour, w)
			}
		}
	}
	o := f.createOrder(t, 1, line(f.blend), line(f.milk))
	add := func() uuid.UUID {
		t.Helper()
		code, body := f.addEmergencies(t, o.OrderCups[0].ID)
		var res models.CupEmergencyCreateResponse
		if code != http.StatusCreated || json.Unmarshal([]byte(body), &res) != nil {
			t.Fatalf("POST = %d: %s", code, body)
		}
		return res.Ids[0]
	}

	first := add()
	expect("1 つめ", map[uuid.UUID][3]float64{itemStock.ID: {15, 1, 1}, cupStock.ID: {1, 1, 1}})

	// あとで per_serving を変えても、前の入れ直しの消費は変わらない。次の入れ直しは今の設定で減る
	if err := db.Model(&itemStock).Update("per_serving", 20).Error; err != nil {
		t.Fatal(err)
	}
	expect("設定を変えた後", map[uuid.UUID][3]float64{itemStock.ID: {15, 1, 1}, cupStock.ID: {1, 1, 1}})
	second := add()
	expect("2 つめ", map[uuid.UUID][3]float64{itemStock.ID: {35, 2, 2}, cupStock.ID: {2, 2, 2}})

	// 取り消すと、その入れ直しの分だけ戻る
	if code, body := f.cancelEmergency(t, first); code != http.StatusNoContent {
		t.Fatalf("cancel = %d: %s", code, body)
	}
	expect("取り消した後", map[uuid.UUID][3]float64{itemStock.ID: {20, 1, 1}, cupStock.ID: {1, 1, 1}})

	// 棚卸しより前に足して、まだ入れ直していないものは、棚卸しの後に使う分として数える。入れ直し終えたものは数えない
	if err := db.Create(&models.StockEvent{ResourceID: itemStock.ID, Kind: string(models.StockEventKindCount), Quantity: 500, CreatedAt: time.Now().Add(time.Second)}).Error; err != nil {
		t.Fatal(err)
	}
	pending := func() float64 {
		t.Helper()
		snapshots, err := inv.snapshots(context.Background(), []uuid.UUID{itemStock.ID})
		if err != nil {
			t.Fatal(err)
		}
		return snapshots[0].Consumed
	}
	if got := pending(); got != 20 {
		t.Fatalf("consumed after a count before brewing = %v, want 20", got)
	}
	if err := db.Model(&models.CupEmergency{}).Where("id = ?", second).Update("brew_finished_at", time.Now()).Error; err != nil {
		t.Fatal(err)
	}
	if got := pending(); got != 0 {
		t.Fatalf("consumed after a count after brewing = %v, want 0", got)
	}

	// 注文を消すと入れ直しの消費も消える
	if err := f.orders.deleteOrder(o.ID); err != nil {
		t.Fatal(err)
	}
	var left int64
	if err := db.Model(&models.CupEmergencyStockUsage{}).Count(&left).Error; err != nil || left != 0 {
		t.Fatalf("stock usages after deleting the order = %d (%v)", left, err)
	}
}

// 理由は前後の空白を除いて足す全部の入れ直しに付け、応答に載る。長すぎれば何も足さない
func TestCupEmergencyReasonOnDB(t *testing.T) {
	db := openCaosTestDB(t)
	f := newCaosFixture(t, db)
	o := f.createOrder(t, 1, line(f.blend, f.blend))
	post := func(reason string) int {
		t.Helper()
		body, _ := json.Marshal(map[string]any{"order_cup_ids": ids(o.OrderCups...), "reason": reason})
		return callWithParams(t, f.caos.CreateCupEmergencies, http.MethodPost, string(body), nil).Code
	}
	if code := post(strings.Repeat("あ", cupEmergencyReasonMax+1)); code != http.StatusBadRequest {
		t.Fatalf("too long = %d, want 400", code)
	}
	if code := post("  こぼした "); code != http.StatusCreated {
		t.Fatalf("POST = %d", code)
	}
	var order models.Order
	if err := preloadOrder(db).First(&order, "id = ?", o.ID).Error; err != nil {
		t.Fatal(err)
	}
	for _, cup := range toOrderResponse(&order).Cups {
		if len(cup.Emergencies) != 1 || cup.Emergencies[0].Reason != "こぼした" {
			t.Fatalf("emergencies = %+v", cup.Emergencies)
		}
	}
}
