package handlers

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"

	"cafeore-pos/api/internal/models"
)

// 注文のキャンセル・現金の返金（order_cancel.go）。TEST_DATABASE_URL が無ければスキップする。
//
//	TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5432/postgres go test ./internal/handlers/ -run Cancel

func TestCancelOrderKeepsOrderAndTakesItOffWork(t *testing.T) {
	api := newTestAPI(t)
	m := api.seedMaster()
	order := api.createOrder(12, m.blendMenu)
	id := uuid.UUID(order.Id)
	path := "/api/orders/" + id.String()

	// CaOS のドリッパーに置いたカップは、キャンセルするまでレーンに出る
	if err := api.db.Model(&models.OrderCup{}).Where("order_id = ?", id).
		Updates(map[string]any{"dripper": 1, "dripper_position": 1}).Error; err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	lane := func() int {
		t.Helper()
		rows, err := readCaosLane(api.db, 1, now.Add(-time.Hour), now.Add(time.Hour))
		if err != nil {
			t.Fatal(err)
		}
		return len(rows)
	}
	if got := lane(); got != 1 {
		t.Fatalf("lane before cancel = %d cups, want 1", got)
	}

	// キャンセルすると、注文は消さずに cancelled_at を付けて配る
	var cancelled models.OrderResponse
	api.do(http.MethodPost, path+"/cancel", nil).expect(http.StatusOK).decode(&cancelled)
	if cancelled.CancelledAt == nil || cancelled.CashRefundedAt != nil || cancelled.OrderId != 12 {
		t.Fatalf("cancelled order = %+v", cancelled)
	}
	if msg := api.nextBroadcast(); msg.Type != WSMessageTypeOrder || msg.Order == nil ||
		msg.Order.Id != order.Id || msg.Order.CancelledAt == nil {
		t.Fatalf("broadcast after cancel = %+v", msg)
	}
	if got := api.count(&models.Order{}, "id = ?", id); got != 1 {
		t.Fatalf("cancelled order must stay, %d left", got)
	}
	if got := lane(); got != 0 {
		t.Fatalf("lane after cancel = %d cups, want 0", got)
	}

	// もう一度キャンセルしても、時刻は変えない
	var again models.OrderResponse
	api.do(http.MethodPost, path+"/cancel", nil).expect(http.StatusOK).decode(&again)
	if again.CancelledAt == nil || !again.CancelledAt.Equal(*cancelled.CancelledAt) {
		t.Fatalf("cancel again = %v, want %v", again.CancelledAt, cancelled.CancelledAt)
	}
	api.nextBroadcast()

	// キャンセルした注文は、準備完了・提供・呼び出し催促・編集をしない
	api.do(http.MethodPatch, path+"/ready", nil).expect(http.StatusConflict)
	api.do(http.MethodPatch, path+"/served", nil).expect(http.StatusConflict)
	api.do(http.MethodPost, path+"/recall", nil).expect(http.StatusConflict)
	api.do(http.MethodPut, path, updateRequest(cancelled)).expect(http.StatusConflict)

	// 現金の返金は、キャンセルとは別に記録する。もう一度呼んでも時刻は変えない
	var refunded models.OrderResponse
	api.do(http.MethodPost, path+"/cash-refund", nil).expect(http.StatusOK).decode(&refunded)
	if refunded.CashRefundedAt == nil || refunded.CancelledAt == nil {
		t.Fatalf("cash refunded order = %+v", refunded)
	}
	api.nextBroadcast()
	var refundedAgain models.OrderResponse
	api.do(http.MethodPost, path+"/cash-refund", nil).expect(http.StatusOK).decode(&refundedAgain)
	if !refundedAgain.CashRefundedAt.Equal(*refunded.CashRefundedAt) {
		t.Fatalf("cash refund again = %v, want %v", refundedAgain.CashRefundedAt, refunded.CashRefundedAt)
	}
	api.nextBroadcast()

	// 無い注文は 404
	unknown := "/api/orders/" + uuid.NewString()
	api.do(http.MethodPost, unknown+"/cancel", nil).expect(http.StatusNotFound)
	api.do(http.MethodPost, unknown+"/cash-refund", nil).expect(http.StatusNotFound)
}

func TestRefundOrderCashNeedsCashPayment(t *testing.T) {
	api := newTestAPI(t)
	m := api.seedMaster()
	order := api.createOrder(1, m.blendMenu)
	// Square だけで払った注文（決済の結び付けは省く）
	if err := api.db.Model(&models.Order{}).Where("id = ?", order.Id).Update("payment_method", string(models.Square)).Error; err != nil {
		t.Fatal(err)
	}
	api.do(http.MethodPost, "/api/orders/"+order.Id.String()+"/cash-refund", nil).expect(http.StatusNotFound)
	api.noBroadcast()
	if got := api.loadOrder(uuid.UUID(order.Id)); got.CashRefundedAt != nil {
		t.Fatalf("cash refund must not be recorded: %v", got.CashRefundedAt)
	}
}

// キャンセルしても在庫は戻さない。抽出が要るのにまだ提供可能にしていないカップは、キャンセルした時刻に使ったことにする
func TestCancelledOrderStillUsesStock(t *testing.T) {
	api := newTestAPI(t)
	hot := models.ItemType{Name: "hot", DisplayName: "ホット"}
	api.create(&hot)
	var blend models.ItemResponse
	api.do(http.MethodPost, "/api/items", models.ItemCreateRequest{Name: "ブレンド", Abbr: "ブ", ItemTypeId: hot.ID}).
		expect(http.StatusCreated).decode(&blend)
	var stock models.StockResource
	if err := api.db.First(&stock, "item_id = ?", blend.Id).Error; err != nil {
		t.Fatal(err)
	}
	api.seedStockEvent(stock, models.StockEventKindCount, 1000, time.Now().Add(-time.Hour))
	menu := api.seedMenu("ブレンド", "b", 400, models.MenuItem{ItemID: uuid.UUID(blend.Id), Quantity: 1})
	consumed := func() float64 {
		t.Helper()
		snapshots, err := api.inv.snapshots(context.Background(), nil)
		if err != nil {
			t.Fatal(err)
		}
		for _, s := range snapshots {
			if s.Resource.ID == stock.ID {
				return s.Consumed
			}
		}
		t.Fatal("no snapshot of the blend stock")
		return 0
	}

	order := api.createOrder(1, menu)
	if got := consumed(); got != 0 {
		t.Fatalf("consumed before ready = %v, want 0", got)
	}
	api.do(http.MethodPost, "/api/orders/"+order.Id.String()+"/cancel", nil).expect(http.StatusOK)
	if got := consumed(); got != 1 {
		t.Fatalf("consumed after cancel = %v, want 1 (stock is not given back)", got)
	}
}
