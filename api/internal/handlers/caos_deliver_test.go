package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"cafeore-pos/api/internal/models"
)

// deliver はドリップ完了の報告（POST /api/caos/drippers/{dripper}/deliver）を呼ぶ。
func (f *caosFixture) deliver(t *testing.T, dripper int, dripID uuid.UUID) (int, models.CaosDeliverResponse, string) {
	t.Helper()
	body, _ := json.Marshal(map[string]any{"drip_id": dripID})
	w := callWithParams(t, f.caos.DeliverCaosDrip, http.MethodPost, string(body), gin.Params{{Key: "dripper", Value: fmt.Sprint(dripper)}})
	var resp models.CaosDeliverResponse
	if w.Code == http.StatusOK {
		if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
			t.Fatal(err)
		}
	}
	return w.Code, resp, w.Body.String()
}

func (f *caosFixture) mustDeliver(t *testing.T, dripper int, dripID uuid.UUID) map[int]models.CaosDeliverCall {
	t.Helper()
	code, resp, body := f.deliver(t, dripper, dripID)
	if code != http.StatusOK {
		t.Fatalf("deliver = %d: %s", code, body)
	}
	calls := map[int]models.CaosDeliverCall{}
	for _, o := range resp.Orders {
		calls[o.OrderId] = o.Call
	}
	return calls
}

func (f *caosFixture) order(t *testing.T, id uuid.UUID) models.Order {
	t.Helper()
	var order models.Order
	if err := f.db.Preload("OrderCups").First(&order, "id = ?", id).Error; err != nil {
		t.Fatal(err)
	}
	return order
}

// start はカップを 1 枚のカードにしてドリッパーの最後に置き、抽出を始めて「次へ」を押せるまで時計を進める。
func (f *caosFixture) start(t *testing.T, dripper int, cups ...models.OrderCup) uuid.UUID {
	t.Helper()
	card := uuid.New()
	f.mustPut(t, write(ids(cups...), unassigned, placed(dripper, card, true)))
	f.wait()
	return card
}

func TestDeliverCall(t *testing.T) {
	brewed := models.ItemType{Name: "hot"}
	ore := models.ItemType{Name: "hotOre", NeedsFinishing: true}
	milk := models.ItemType{Name: "milk", NeedsBrew: boolPtr(false)}
	now := time.Now()
	cup := func(itemType models.ItemType, delivered bool, emergencies ...bool) models.OrderCup {
		c := models.OrderCup{ID: uuid.New(), Item: models.Item{ItemType: itemType}}
		if delivered {
			c.DeliveredAt = &now
		}
		for _, d := range emergencies {
			e := models.CupEmergency{}
			if d {
				e.DeliveredAt = &now
			}
			c.Emergencies = append(c.Emergencies, e)
		}
		return c
	}
	ready := func(c models.OrderCup) models.OrderCup {
		c.ReadyAt = &now
		return c
	}
	for _, tc := range []struct {
		name  string
		order models.Order
		want  models.CaosDeliverCall
	}{
		{name: "all delivered", order: models.Order{OrderCups: []models.OrderCup{cup(brewed, true), cup(brewed, true)}}, want: models.CaosDeliverCalled},
		{name: "another cup is still brewing", order: models.Order{OrderCups: []models.OrderCup{cup(brewed, true), cup(brewed, false)}}, want: models.CaosDeliverWaiting},
		{name: "au lait is finished at serve", order: models.Order{OrderCups: []models.OrderCup{cup(ore, true)}}, want: models.CaosDeliverFinishing},
		{name: "milk is made at serve", order: models.Order{OrderCups: []models.OrderCup{cup(brewed, true), cup(milk, false)}}, want: models.CaosDeliverFinishing},
		{name: "finishing wins over waiting", order: models.Order{OrderCups: []models.OrderCup{cup(brewed, false), cup(milk, false)}}, want: models.CaosDeliverFinishing},
		{name: "milk already made at serve", order: models.Order{OrderCups: []models.OrderCup{cup(brewed, true), ready(cup(milk, false))}}, want: models.CaosDeliverCalled},
		{name: "a cup readied at serve counts", order: models.Order{OrderCups: []models.OrderCup{cup(brewed, true), ready(cup(brewed, false))}}, want: models.CaosDeliverCalled},
		{name: "re-brew not delivered yet", order: models.Order{OrderCups: []models.OrderCup{cup(brewed, true, false)}}, want: models.CaosDeliverWaiting},
		{name: "re-brew delivered", order: models.Order{OrderCups: []models.OrderCup{cup(brewed, false, true)}}, want: models.CaosDeliverCalled},
		{name: "already calling", order: models.Order{ReadyAt: &now, OrderCups: []models.OrderCup{cup(brewed, true)}}, want: models.CaosDeliverAlready},
		{name: "already served", order: models.Order{ServedAt: &now, OrderCups: []models.OrderCup{cup(brewed, true)}}, want: models.CaosDeliverAlready},
	} {
		cups := map[uuid.UUID]*models.OrderCup{}
		for i := range tc.order.OrderCups {
			cups[tc.order.OrderCups[i].ID] = &tc.order.OrderCups[i]
		}
		if got := deliverCall(&tc.order, cups); got != tc.want {
			t.Errorf("%s: got %s, want %s", tc.name, got, tc.want)
		}
	}
}

func TestCaosDeliverOnDB(t *testing.T) {
	db := openCaosTestDB(t)
	f := newCaosFixture(t, db)
	o1 := f.createOrder(t, 1, line(f.blend, f.blend))
	o2 := f.createOrder(t, 2, line(f.blend))
	card1 := f.start(t, 1, o1.OrderCups...)
	card2 := uuid.New()
	f.mustPut(t, write(ids(o2.OrderCups...), unassigned, placed(1, card2, false)))

	// 抽出中のカードを届けると、抽出を終え、届けた時刻を付け、注文のカップがそろうので準備完了（呼び出し）にする
	if calls := f.mustDeliver(t, 1, card1); calls[1] != models.CaosDeliverCalled || len(calls) != 1 {
		t.Fatalf("calls = %v", calls)
	}
	order := f.order(t, o1.ID)
	if order.ReadyAt == nil {
		t.Fatal("order 1 should be ready (called)")
	}
	for _, c := range order.OrderCups {
		if c.BrewFinishedAt == nil || c.DeliveredAt == nil || c.ReadyAt == nil || !c.ReadyAt.Equal(*order.ReadyAt) {
			t.Fatalf("cup = %+v", c)
		}
	}
	// 待機の先頭は始めない（始めるのは CaOS の ▶）
	if brewing, queued := f.lane(t, 1); len(brewing) != 0 || len(queued) != 1 || queued[0] != card2 {
		t.Fatalf("lane = %v %v", brewing, queued)
	}

	// 二度押しは何も変えない
	if calls := f.mustDeliver(t, 1, card1); calls[1] != models.CaosDeliverAlready {
		t.Fatalf("calls = %v", calls)
	}
	// 提供が呼び出しを取り消した注文は、二度押しでも呼び直さない
	if w := callWithParams(t, f.orders.MarkOrderReady, http.MethodPatch, "", gin.Params{{Key: "id", Value: o1.ID.String()}}); w.Code != http.StatusOK {
		t.Fatalf("toggle ready = %d", w.Code)
	}
	if calls := f.mustDeliver(t, 1, card1); calls[1] != models.CaosDeliverAlready {
		t.Fatalf("calls = %v", calls)
	}
	if f.order(t, o1.ID).ReadyAt != nil {
		t.Fatal("a call cancelled at serve must not be made again")
	}

	// 始めていないカードは届けられない（409）。ほかのドリッパー・無いカードも 409
	if code, _, _ := f.deliver(t, 1, card2); code != http.StatusConflict {
		t.Fatalf("queued card = %d", code)
	}
	if code, _, _ := f.deliver(t, 2, card1); code != http.StatusConflict {
		t.Fatalf("another dripper = %d", code)
	}
	if code, _, _ := f.deliver(t, 1, uuid.New()); code != http.StatusConflict {
		t.Fatalf("unknown card = %d", code)
	}
	// 始めてから 10 秒は届けられない（400）
	if code := f.next(t, 1, nil); code != http.StatusNoContent {
		t.Fatalf("start = %d", code)
	}
	if code, _, _ := f.deliver(t, 1, card2); code != http.StatusBadRequest {
		t.Fatalf("within the cooldown = %d", code)
	}
	if f.order(t, o2.ID).OrderCups[0].DeliveredAt != nil {
		t.Fatal("a refused report must not write")
	}
}

// 「次へ」で終えたカードも届けられる（抽出の終わりは変えない）
func TestCaosDeliverFinishedCardOnDB(t *testing.T) {
	db := openCaosTestDB(t)
	f := newCaosFixture(t, db)
	o1 := f.createOrder(t, 1, line(f.blend))
	card := f.start(t, 3, o1.OrderCups...)
	if code := f.finish(t, 3, &card); code != http.StatusNoContent {
		t.Fatalf("finish = %d", code)
	}
	finished := f.cup(t, o1.OrderCups[0].ID).BrewFinishedAt
	f.wait()
	if calls := f.mustDeliver(t, 3, card); calls[1] != models.CaosDeliverCalled {
		t.Fatalf("calls = %v", calls)
	}
	cup := f.cup(t, o1.OrderCups[0].ID)
	if !timeEqual(cup.BrewFinishedAt, finished) || cup.DeliveredAt == nil || cup.ReadyAt == nil {
		t.Fatalf("cup = %+v", cup)
	}
}

// 提供で仕上げるカップ（抽出が要らないミルク・提供で仕上げる種類）のある注文は呼び出さず、提供が呼び出す。
// ほかのカードのカップがまだ届いていなければ待ち、最後のカードが届いたら呼び出す
func TestCaosDeliverWaitsForServeOnDB(t *testing.T) {
	db := openCaosTestDB(t)
	f := newCaosFixture(t, db)
	ore := models.Item{Name: "ホットオレ", Abbr: "オ", ItemType: models.ItemType{Name: "hotOre", DisplayName: "ホットオレ", NeedsFinishing: true}}
	if err := db.Create(&ore).Error; err != nil {
		t.Fatal(err)
	}
	withMilk := f.createOrder(t, 1, line(f.blend), line(f.milk))
	auLait := f.createOrder(t, 2, line(ore))
	three := f.createOrder(t, 3, line(f.blend, f.blend, f.blend))

	if calls := f.mustDeliver(t, 1, f.start(t, 1, withMilk.OrderCups[0])); calls[1] != models.CaosDeliverFinishing {
		t.Fatalf("calls = %v", calls)
	}
	if calls := f.mustDeliver(t, 2, f.start(t, 2, auLait.OrderCups...)); calls[2] != models.CaosDeliverFinishing {
		t.Fatalf("calls = %v", calls)
	}
	for _, id := range []uuid.UUID{withMilk.ID, auLait.ID} {
		if order := f.order(t, id); order.ReadyAt != nil {
			t.Fatalf("order %d must wait for serve", order.OrderId)
		}
	}
	// 呼び出すのは今までどおり提供の画面（届けたカップは準備完了ではないので、ミルクの 1 杯だけ準備完了にしても呼ばない）
	milk := withMilk.OrderCups[1]
	params := gin.Params{{Key: "id", Value: withMilk.ID.String()}, {Key: "cupId", Value: milk.ID.String()}}
	if w := callWithParams(t, f.orders.MarkOrderCupReady, http.MethodPatch, "", params); w.Code != http.StatusOK {
		t.Fatalf("milk ready = %d", w.Code)
	}
	if f.order(t, withMilk.ID).ReadyAt != nil {
		t.Fatal("readying the milk alone must not call order 1")
	}
	if w := callWithParams(t, f.orders.MarkOrderReady, http.MethodPatch, "", gin.Params{{Key: "id", Value: withMilk.ID.String()}}); w.Code != http.StatusOK {
		t.Fatalf("call = %d", w.Code)
	}
	if f.order(t, withMilk.ID).ReadyAt == nil {
		t.Fatal("order 1 should be called from the serve screen")
	}

	cardA := f.start(t, 4, three.OrderCups[:2]...)
	cardB := f.start(t, 5, three.OrderCups[2])
	if calls := f.mustDeliver(t, 4, cardA); calls[3] != models.CaosDeliverWaiting {
		t.Fatalf("calls = %v", calls)
	}
	if f.order(t, three.ID).ReadyAt != nil {
		t.Fatal("order 3 must wait for the last card")
	}
	if calls := f.mustDeliver(t, 5, cardB); calls[3] != models.CaosDeliverCalled {
		t.Fatalf("calls = %v", calls)
	}
	if f.order(t, three.ID).ReadyAt == nil {
		t.Fatal("order 3 should be called with the last card")
	}
}

// 統合したカード（2 つの注文）は注文ごとに決める。入れ直しを足したカップは、入れ直しを届けるまでそろわない
func TestCaosDeliverMergedAndEmergencyOnDB(t *testing.T) {
	db := openCaosTestDB(t)
	f := newCaosFixture(t, db)
	o1 := f.createOrder(t, 1, line(f.blend))
	o2 := f.createOrder(t, 2, line(f.blend))
	o3 := f.createOrder(t, 3, line(f.blend))

	code, resp, body := f.deliver(t, 1, f.start(t, 1, o2.OrderCups[0], o1.OrderCups[0]))
	if code != http.StatusOK || len(resp.Orders) != 2 || resp.Orders[0].OrderId != 1 || resp.Orders[1].OrderId != 2 {
		t.Fatalf("deliver = %d: %s", code, body)
	}
	for _, o := range resp.Orders {
		if o.Call != models.CaosDeliverCalled {
			t.Fatalf("order %d: %s", o.OrderId, o.Call)
		}
	}

	card := f.start(t, 2, o3.OrderCups[0])
	if code := f.finish(t, 2, &card); code != http.StatusNoContent {
		t.Fatalf("finish = %d", code)
	}
	if code, body := f.addEmergencies(t, o3.OrderCups[0].ID); code != http.StatusCreated {
		t.Fatalf("emergency = %d: %s", code, body)
	}
	emergency := f.emergencies(t, o3.OrderCups[0].ID)[0]
	reBrew := uuid.New()
	f.mustPut(t, write([]uuid.UUID{emergency.ID}, f.emergencyState(t, emergency.ID), placed(2, reBrew, true)))
	f.wait()
	// 最初の抽出を届けても、入れ直しを待つ
	if calls := f.mustDeliver(t, 2, card); calls[3] != models.CaosDeliverWaiting {
		t.Fatalf("calls = %v", calls)
	}
	if calls := f.mustDeliver(t, 2, reBrew); calls[3] != models.CaosDeliverCalled {
		t.Fatalf("calls = %v", calls)
	}
	if e := f.emergencies(t, o3.OrderCups[0].ID)[0]; e.BrewFinishedAt == nil || e.DeliveredAt == nil {
		t.Fatalf("emergency = %+v", e)
	}
	if f.order(t, o3.ID).ReadyAt == nil {
		t.Fatal("order 3 should be called with the re-brew")
	}
}
