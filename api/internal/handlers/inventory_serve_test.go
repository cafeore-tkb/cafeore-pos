package handlers

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"cafeore-pos/api/internal/models"
)

// 抽出が要るカップの在庫は、提供の画面でカップを提供可能にしたときに使い、そのとき在庫の通知を確かめることを本物の Postgres で確かめる。
// CaOS の抽出の時刻には依らない。同じ明細の抽出の要らないカップ（ミルク）は、注文を受けたときに使う。
func TestStockUsedWhenServedOnDB(t *testing.T) {
	api := newTestAPI(t)
	m := api.seedMaster()
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	milkType := models.ItemType{ID: uuid.New(), Name: "milk", DisplayName: "ミルク", NeedsBrew: boolPtr(false)}
	milk := models.Item{ID: uuid.New(), Name: "ミルク", Abbr: "ミ", ItemTypeID: milkType.ID}
	api.create(&milkType, &milk)
	set := api.seedMenu("オレのセット", "set", 800, models.MenuItem{ItemID: m.blend.ID, Quantity: 1}, models.MenuItem{ItemID: milk.ID, Quantity: 1})

	// 豆は残り 61 回。60 回を切ったら通知する。カップはブレンドとミルクで使う
	beans := api.seedBeans(m)
	cups := models.StockResource{ID: uuid.New(), Kind: string(models.StockResourceKindCup), Name: "カップ", Unit: "個", PerServing: 1}
	api.create(&cups, &models.StockResourceItemType{ResourceID: cups.ID, ItemTypeID: m.hotType.ID}, &models.StockResourceItemType{ResourceID: cups.ID, ItemTypeID: milkType.ID})
	api.seedStockEvent(beans, models.StockEventKindCount, 915, time.Now().Add(-time.Hour))
	api.seedStockEvent(cups, models.StockEventKindCount, 100, time.Now().Add(-time.Hour))

	// want は在庫対象ごとの {使った量, 回数, 直近 1 時間の回数}
	expect := func(label string, want map[uuid.UUID][3]float64) {
		t.Helper()
		snapshots, err := api.inv.snapshots(context.Background(), nil)
		must(err)
		for _, s := range snapshots {
			w := want[s.Resource.ID]
			if s.Consumed != w[0] || float64(s.Servings) != w[1] || float64(s.ServingsLastHour) != w[2] {
				t.Errorf("%s: %s consumed=%v servings=%d last hour=%d, want %v", label, s.Resource.DisplayName(), s.Consumed, s.Servings, s.ServingsLastHour, w)
			}
		}
	}

	o := api.createOrder(1, set)
	api.waitBackground()
	// まだ提供可能にしていないブレンドは使っていない。ミルクのカップは受けたときに使った
	expect("受けた", map[uuid.UUID][3]float64{cups.ID: {1, 1, 1}})
	// CaOS で抽出を始め・終えても、在庫は変わらない
	now := time.Now()
	must(api.db.Model(&models.OrderCup{}).Where("order_id = ?", o.Id).
		Updates(map[string]any{"dripper": 1, "dripper_position": 1, "drip_id": uuid.New(), "brew_started_at": now, "brew_finished_at": now}).Error)
	expect("抽出した", map[uuid.UUID][3]float64{cups.ID: {1, 1, 1}})
	if sent := api.slack.sent(); len(sent) != 0 {
		t.Fatalf("sent before serving: %q", sent)
	}

	// 提供の画面でブレンドのカップを提供可能にすると豆とカップを使い、豆が 60 回を切ったので通知する
	var blendCup models.OrderCupResponse
	for _, c := range o.Cups {
		if uuid.UUID(c.Item.Id) == m.blend.ID {
			blendCup = c
		}
	}
	readyPath := "/api/orders/" + o.Id.String() + "/cups/" + blendCup.Id.String() + "/ready"
	api.do(http.MethodPatch, readyPath, nil).expect(http.StatusOK)
	select {
	case msg := <-api.slack.received:
		if !strings.Contains(msg, "*ブレンド* 残り約60回分（900g）") {
			t.Fatalf("message: %q", msg)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("no alert after marking the cup ready")
	}
	api.waitBackground()
	expect("提供可能にした", map[uuid.UUID][3]float64{beans.ID: {15, 1, 1}, cups.ID: {2, 2, 2}})

	// 提供可能を取り消すと、まだ使っていないことに戻り、通知の記録も戻す
	api.do(http.MethodPatch, readyPath, nil).expect(http.StatusOK)
	api.waitBackground()
	expect("提供可能を取り消した", map[uuid.UUID][3]float64{cups.ID: {1, 1, 1}})
	if got := api.lastAlertThreshold(beans); got != nil {
		t.Errorf("threshold after undoing ready = %v, want reset", *got)
	}
}
