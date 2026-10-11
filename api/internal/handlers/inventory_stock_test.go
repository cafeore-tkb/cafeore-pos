package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	openapi_types "github.com/oapi-codegen/runtime/types"
	"gorm.io/gorm"

	"cafeore-pos/api/internal/models"
	"cafeore-pos/api/internal/notify"
	"cafeore-pos/api/internal/testdb"
)

// アイテムの在庫とカップが、注文を受けたときの設定で減ることを本物の Postgres で確かめる。
func TestItemStockAndCupsCountOrdersWithSettingsAtOrderTime(t *testing.T) {
	db := testdb.New(t)
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	inv := NewInventory(db, notify.NewSlack(""), RemindAuth{}, "")
	hub := NewHub()
	go hub.Run()
	gin.SetMode(gin.TestMode)
	router := gin.New()
	inventory := NewInventoryHandler(inv)
	router.POST("/resources", inventory.CreateStockResource)
	router.PUT("/resources/:id", inventory.UpdateStockResource)
	router.DELETE("/resources/:id", inventory.DeleteStockResource)
	router.POST("/items", NewItemHandler(db).CreateItem)
	router.DELETE("/items/:id", NewItemHandler(db).DeleteItem)
	// 通知の判定は下で直接呼ぶので、注文からは呼ばない（nil）
	orders := NewOrderHandler(db, hub, nil)
	router.POST("/orders", orders.CreateOrder)
	router.PUT("/orders/:id", orders.UpdateOrder)
	call := func(method, path string, body any, want int, out any) {
		t.Helper()
		b, _ := json.Marshal(body)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, httptest.NewRequest(method, path, bytes.NewReader(b)))
		if w.Code != want {
			t.Fatalf("%s %s: %d %s", method, path, w.Code, w.Body.String())
		}
		if out != nil {
			must(json.Unmarshal(w.Body.Bytes(), out))
		}
	}

	hot := models.ItemType{Name: "hot", DisplayName: "ホット"}
	noCup := false
	goods := models.ItemType{Name: "others", DisplayName: "グッズ", MakesCup: &noCup, NeedsBrew: &noCup}
	must(db.Create(&hot).Error)
	must(db.Create(&goods).Error)

	// アイテムを作ると、そのアイテムの在庫ができる
	newItem := func(name string, itemType models.ItemType) (models.ItemResponse, models.StockResource) {
		t.Helper()
		var item models.ItemResponse
		call(http.MethodPost, "/items", models.ItemCreateRequest{Name: name, Abbr: name, ItemTypeId: itemType.ID}, http.StatusCreated, &item)
		var stock models.StockResource
		must(db.Preload("Item").First(&stock, "item_id = ?", item.Id).Error)
		if stock.Kind != string(models.StockResourceKindItem) || stock.DisplayName() != name || stock.PerServing != 1 {
			t.Fatalf("アイテムの在庫 = %+v", stock)
		}
		return item, stock
	}
	blend, blendStock := newItem("ブレンド", hot)
	coaster, coasterStock := newItem("コースター", goods)

	stockRequest := func(name *string, perServing float64, itemTypes ...uuid.UUID) models.StockResourceRequest {
		// 種類が無いときも空の配列で送る（省略すると今のまま）
		itemTypes = append([]uuid.UUID{}, itemTypes...)
		return models.StockResourceRequest{Name: name, ItemTypeIds: &itemTypes, Unit: "g", PerServing: perServing, NotifyFrom: 10, NotifyStep: 2, Buffer: 3}
	}
	// アイテムの在庫は名前と使う種類を送らない
	itemStockRequest := func(perServing float64) models.StockResourceRequest {
		req := stockRequest(nil, perServing)
		req.ItemTypeIds = nil
		return req
	}
	cupName := "ホットカップ"
	var cup models.StockResourceResponse
	// グッズの種類を選んでも、グッズはカップを作らないので減らない
	call(http.MethodPost, "/resources", stockRequest(&cupName, 1, hot.ID, goods.ID), http.StatusCreated, &cup)
	if cup.Kind != models.StockResourceKindCup || cup.ItemId != nil || len(cup.ItemTypeIds) != 2 {
		t.Fatalf("カップ = %+v", cup)
	}
	call(http.MethodPost, "/resources", stockRequest(nil, 1), http.StatusBadRequest, nil)
	call(http.MethodPost, "/resources", stockRequest(&cupName, 1, hot.ID, hot.ID), http.StatusBadRequest, nil)
	call(http.MethodPost, "/resources", stockRequest(&cupName, 1, uuid.New()), http.StatusBadRequest, nil)
	// アイテムの在庫は量と通知の段階だけ変える。名前・種類を送ると 400、消すのはアイテムを消すとき
	rename := "別の名前"
	call(http.MethodPut, "/resources/"+blendStock.ID.String(), stockRequest(&rename, 15), http.StatusBadRequest, nil)
	call(http.MethodPut, "/resources/"+blendStock.ID.String(), stockRequest(nil, 15, hot.ID), http.StatusBadRequest, nil)
	var updated models.StockResourceResponse
	call(http.MethodPut, "/resources/"+blendStock.ID.String(), itemStockRequest(15), http.StatusOK, &updated)
	if updated.Name != "ブレンド" || len(updated.ItemTypeIds) != 0 || updated.PerServing != 15 || uuid.UUID(*updated.ItemId) != uuid.UUID(blend.Id) {
		t.Fatalf("アイテムの在庫の更新 = %+v", updated)
	}
	call(http.MethodDelete, "/resources/"+blendStock.ID.String(), nil, http.StatusBadRequest, nil)

	// 3 つの在庫それぞれ 1000 から数える
	cupID := uuid.UUID(cup.Id)
	for _, id := range []uuid.UUID{blendStock.ID, coasterStock.ID, cupID} {
		must(db.Create(&models.StockEvent{ResourceID: id, Kind: string(models.StockEventKindCount), Quantity: 1000, CreatedAt: time.Now().Add(-time.Hour)}).Error)
	}
	// ブレンド 2 杯とコースター 1 個のセット
	set := models.Menu{Name: "セット", Abbr: "セ", Price: 1000, Key: "s", MenuItems: []models.MenuItem{
		{ItemID: uuid.UUID(blend.Id), Quantity: 2}, {ItemID: uuid.UUID(coaster.Id), Quantity: 1},
	}}
	must(db.Create(&set).Error)
	order := func(lines ...models.MenuInfoCreate) models.OrderResponse {
		t.Helper()
		var resp models.OrderResponse
		call(http.MethodPost, "/orders", models.OrderCreateRequest{OrderId: 1, BillingAmount: 1000, Received: 1000, MenuIds: lines}, http.StatusCreated, &resp)
		return resp
	}
	newLine := models.MenuInfoCreate{MenuId: set.ID}
	expect := func(label string, want map[uuid.UUID][2]float64) {
		t.Helper()
		snapshots, err := inv.snapshots(context.Background(), nil)
		must(err)
		if len(snapshots) != len(want) {
			t.Fatalf("%s: 在庫対象 %d 個, want %d", label, len(snapshots), len(want))
		}
		for _, s := range snapshots {
			if w := want[s.Resource.ID]; s.Consumed != w[0] || float64(s.Servings) != w[1] {
				t.Errorf("%s: %s consumed=%v servings=%d, want %v", label, s.Resource.DisplayName(), s.Consumed, s.Servings, w)
			}
		}
	}

	// 注文で、アイテムの在庫は per_serving × 数、カップはカップを作るアイテムの数だけ減る
	first := order(newLine)
	expect("1 つめ", map[uuid.UUID][2]float64{blendStock.ID: {30, 2}, coasterStock.ID: {1, 1}, cupID: {2, 2}})
	if got := inv.ResourceIDsForOrder(uuid.UUID(first.Id)); len(got) != 3 {
		t.Errorf("1 つめの注文の在庫対象 = %v, want 3 つ", got)
	}

	// あとで per_serving とカップの種類を変えても、前の注文の消費は変わらない
	call(http.MethodPut, "/resources/"+blendStock.ID.String(), itemStockRequest(20), http.StatusOK, nil)
	// 使う種類を省略した PUT では種類は今のまま
	omitted := stockRequest(&cupName, 1)
	omitted.ItemTypeIds = nil
	var unchanged models.StockResourceResponse
	call(http.MethodPut, "/resources/"+cupID.String(), omitted, http.StatusOK, &unchanged)
	if len(unchanged.ItemTypeIds) != 2 {
		t.Fatalf("種類を省略した PUT の後の種類 = %v, want 2 つ", unchanged.ItemTypeIds)
	}
	call(http.MethodPut, "/resources/"+cupID.String(), stockRequest(&cupName, 1), http.StatusOK, nil)
	order(newLine)
	expect("変えた後", map[uuid.UUID][2]float64{blendStock.ID: {30 + 40, 4}, coasterStock.ID: {2, 2}, cupID: {2, 2}})

	// 前の注文を編集しても、残した明細はその時点の量のまま。足した明細は今の設定で減る
	kept := openapi_types.UUID(first.Menus[0].Id)
	call(http.MethodPut, "/orders/"+first.Id.String(), models.OrderUpdateRequest{
		Id: first.Id, OrderId: 1, BillingAmount: 2000, Received: 2000,
		MenuIds: []models.MenuInfoCreate{{MenuId: set.ID, OrderMenuId: &kept}, newLine},
	}, http.StatusOK, nil)
	expect("編集した後", map[uuid.UUID][2]float64{blendStock.ID: {30 + 40 + 40, 6}, coasterStock.ID: {3, 3}, cupID: {2, 2}})

	// 棚卸し・入荷・残り何回・通知の段階は今までどおり
	must(db.Create(&models.StockEvent{ResourceID: cupID, Kind: string(models.StockEventKindReceipt), Quantity: 5, CreatedAt: time.Now()}).Error)
	must(db.Model(&models.StockResource{}).Where("id = ?", blendStock.ID).Update("notify_from", 50).Error)
	snapshots, err := inv.snapshots(context.Background(), nil)
	must(err)
	for _, s := range snapshots {
		switch s.Resource.ID {
		case cupID:
			if *s.Remaining() != 1000+5-2 || *s.CountedQuantity != 1000 || s.Received != 5 {
				t.Errorf("カップの残り = %v（数えた %v・入荷 %v）", *s.Remaining(), *s.CountedQuantity, s.Received)
			}
		case blendStock.ID:
			// 残り 890g ÷ 20g = 44.5 回。通知を始める 50 回を切ったので warning
			if *s.RemainingServings() != 44.5 || s.Level() != models.InventoryLevelWarning {
				t.Errorf("ブレンドの残り = %v 回（%v）", *s.RemainingServings(), s.Level())
			}
		}
	}
	must(inv.checkAlerts(context.Background(), []uuid.UUID{blendStock.ID}))
	var notified models.StockResource
	must(db.First(&notified, "id = ?", blendStock.ID).Error)
	if notified.LastAlertThreshold == nil || *notified.LastAlertThreshold != 46 {
		t.Errorf("通知した段階 = %v, want 46", notified.LastAlertThreshold)
	}

	// アイテムを消すと在庫も消える。消す前の注文の消費は注文の側に残る
	call(http.MethodDelete, "/items/"+blend.Id.String(), nil, http.StatusOK, nil)
	expect("消した後", map[uuid.UUID][2]float64{coasterStock.ID: {3, 3}, cupID: {2, 2}})
	var deleted models.StockResource
	must(db.Unscoped().First(&deleted, "id = ?", blendStock.ID).Error)
	if !deleted.DeletedAt.Valid {
		t.Error("アイテムを消しても在庫が残っている")
	}
	var usages int64
	must(db.Model(&models.OrderStockUsage{}).Where("resource_id = ?", blendStock.ID).Count(&usages).Error)
	if usages != 3 {
		t.Errorf("消したアイテムの在庫の注文の行 = %d, want 3", usages)
	}

	// カップは消せる。使う種類の行も消す
	call(http.MethodDelete, "/resources/"+cupID.String(), nil, http.StatusNoContent, nil)
	var links int64
	must(db.Model(&models.StockResourceItemType{}).Where("resource_id = ?", cupID).Count(&links).Error)
	if err := db.First(&models.StockResource{}, "id = ?", cupID).Error; err != gorm.ErrRecordNotFound || links != 0 {
		t.Errorf("消したカップ: err=%v 種類の行=%d", err, links)
	}
}
