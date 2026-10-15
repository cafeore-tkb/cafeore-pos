package handlers

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"cafeore-pos/api/internal/models"
	"cafeore-pos/api/internal/notify"
)

// 抽出が要るカップの在庫は CaOS で抽出を始めたときに使い、そのとき在庫の通知を確かめることを本物の Postgres で確かめる。
// 同じ明細の抽出の要らないカップ（ミルク）は、注文を受けたときに使う。
func TestStockUsedWhenBrewStartsOnDB(t *testing.T) {
	db := openCaosTestDB(t)
	f := newCaosFixture(t, db)
	slack := newFakeSlack(t)
	inv := NewInventory(db, notify.NewSlack(slack.url), RemindAuth{}, "", nil)
	f.caos.inventory = inv
	// CaOS の書き込みの後の通知の判定を、schema を消す前に終わらせる
	t.Cleanup((&testAPI{t: t, db: db}).waitBackground)
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}

	// 豆は 1 回 15g で残り 61 回。60 回を切ったら通知する。カップはブレンドとミルクで使う
	beans := models.StockResource{Kind: string(models.StockResourceKindItem), ItemID: &f.blend.ID, Unit: "g", PerServing: 15, NotifyFrom: 60, NotifyStep: 20}
	cups := models.StockResource{Kind: string(models.StockResourceKindCup), Name: "カップ", Unit: "個", PerServing: 1,
		ItemTypes: []models.StockResourceItemType{{ItemTypeID: f.blend.ItemTypeID}, {ItemTypeID: f.milk.ItemTypeID}}}
	for _, r := range []*models.StockResource{&beans, &cups} {
		must(db.Create(r).Error)
	}
	countedAt := time.Now().Add(-time.Hour)
	must(db.Create(&models.StockEvent{ResourceID: beans.ID, Kind: string(models.StockEventKindCount), Quantity: 915, CreatedAt: countedAt}).Error)
	must(db.Create(&models.StockEvent{ResourceID: cups.ID, Kind: string(models.StockEventKindCount), Quantity: 100, CreatedAt: countedAt}).Error)

	// ブレンドとミルクの明細（カップ 2 杯）を受けた。明細で減る在庫は注文を受けたときに残す
	newOrder := func(no int) models.Order {
		t.Helper()
		o := f.createOrder(t, no, line(f.blend, f.milk))
		must(db.Create([]models.OrderStockUsage{
			{OrderMenuID: o.OrderMenus[0].ID, ResourceID: beans.ID, OrderID: o.ID, Servings: 1, Amount: 15},
			{OrderMenuID: o.OrderMenus[0].ID, ResourceID: cups.ID, OrderID: o.ID, Servings: 2, Amount: 2},
		}).Error)
		return o
	}
	o := newOrder(1)
	// want は在庫対象ごとの {使った量, 回数, 直近 1 時間の回数}
	expect := func(label string, want map[uuid.UUID][3]float64) {
		t.Helper()
		snapshots, err := inv.snapshots(context.Background(), nil)
		must(err)
		for _, s := range snapshots {
			w := want[s.Resource.ID]
			if s.Consumed != w[0] || float64(s.Servings) != w[1] || float64(s.ServingsLastHour) != w[2] {
				t.Errorf("%s: %s consumed=%v servings=%d last hour=%d, want %v", label, s.Resource.DisplayName(), s.Consumed, s.Servings, s.ServingsLastHour, w)
			}
		}
	}
	// まだ抽出を始めていないブレンドは使っていない。ミルクのカップは受けたときに使った
	expect("受けた", map[uuid.UUID][3]float64{cups.ID: {1, 1, 1}})
	must(inv.checkAlerts(context.Background(), nil))
	if sent := slack.sent(); len(sent) != 0 {
		t.Fatalf("sent before brewing: %q", sent)
	}

	// 抽出を始めずに準備完了・提供済みにしたカップ（CaOS を通さなかった）も、まだ使っていない
	other := newOrder(2)
	now := time.Now()
	must(db.Model(&models.OrderCup{}).Where("order_id = ?", other.ID).Updates(map[string]any{"ready_at": now, "served_at": now}).Error)
	expect("抽出を始めずに提供した", map[uuid.UUID][3]float64{cups.ID: {2, 2, 2}})

	// CaOS で抽出を始めると豆とカップを使い、豆が 60 回を切ったので通知する
	f.mustPut(t, write(ids(o.OrderCups[0]), unassigned, placed(1, uuid.New(), true)))
	select {
	case msg := <-slack.received:
		if !strings.Contains(msg, "*ブレンド* 残り約60回分（900g）") {
			t.Fatalf("message: %q", msg)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("no alert after starting to brew")
	}
	expect("抽出を始めた", map[uuid.UUID][3]float64{beans.ID: {15, 1, 1}, cups.ID: {3, 3, 3}})

	// 注文で減る在庫対象は、いくつかの注文をまとめても重ねない
	if got := inv.ResourceIDsForOrders(o.ID, other.ID); len(got) != 2 {
		t.Errorf("resources of the orders = %v, want beans and cups", got)
	}
}
