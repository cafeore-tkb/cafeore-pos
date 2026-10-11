package handlers

import (
	"context"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"cafeore-pos/api/internal/models"

	"github.com/google/uuid"
	openapi_types "github.com/oapi-codegen/runtime/types"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// 在庫（残量の計算・通知・リマインド）の結合テスト（Postgres を使う）

// ブレンド豆。1 杯 15g、残り 60 杯から 20 杯ごとに通知し、10 杯を切ったら危険
func (a *testAPI) seedBeans(m testMaster) models.StockResource {
	a.t.Helper()
	beans := models.StockResource{ID: uuid.New(), Kind: "bean", Name: "ブレンド豆", Unit: "g", PerServing: 15, NotifyFrom: 60, NotifyStep: 20, Buffer: 10}
	a.create(&beans, &models.ItemStockUsage{ItemID: m.blend.ID, ResourceID: beans.ID, Amount: 15})
	return beans
}

func (a *testAPI) seedStockEvent(resource models.StockResource, kind models.StockEventKind, quantity float64, at time.Time) {
	a.t.Helper()
	a.create(&models.StockEvent{ResourceID: resource.ID, Kind: string(kind), Quantity: quantity, CreatedAt: at})
}

// 注文を直接 DB に入れる。API で作ると、応答のあとに在庫の通知の判定が走ってしまう
func (a *testAPI) seedOrder(menu models.Menu, createdAt time.Time, readyAt *time.Time) {
	a.t.Helper()
	order := models.Order{ID: uuid.New(), OrderId: 1, CreatedAt: createdAt, ReadyAt: readyAt, BillingAmount: menu.Price, Received: menu.Price}
	line := models.OrderMenu{ID: uuid.New(), OrderID: order.ID, MenuID: menu.ID, MenuName: menu.Name, UnitPrice: menu.Price}
	a.create(&order)
	if err := a.db.Omit(clause.Associations).Create(&line).Error; err != nil {
		a.t.Fatal(err)
	}
}

func (a *testAPI) inventory() map[string]models.InventoryStatus {
	a.t.Helper()
	var statuses []models.InventoryStatus
	a.do(http.MethodGet, "/api/inventory", nil).expect(http.StatusOK).decode(&statuses)
	byName := make(map[string]models.InventoryStatus, len(statuses))
	for _, s := range statuses {
		byName[s.Resource.Name] = s
	}
	return byName
}

func (a *testAPI) lastAlertThreshold(resource models.StockResource) *int {
	a.t.Helper()
	var r models.StockResource
	if err := a.db.First(&r, "id = ?", resource.ID).Error; err != nil {
		a.t.Fatal(err)
	}
	return r.LastAlertThreshold
}

func (a *testAPI) setLastAlertThreshold(resource models.StockResource, v *int) {
	a.t.Helper()
	if err := a.db.Model(&models.StockResource{}).Where("id = ?", resource.ID).Update("last_alert_threshold", v).Error; err != nil {
		a.t.Fatal(err)
	}
}

func floatPtrEq(p *float64, want float64) bool {
	const eps = 1e-6
	return p != nil && *p-want < eps && want-*p < eps
}

func TestStockResourceCRUD(t *testing.T) {
	api := newTestAPI(t)
	m := api.seedMaster()

	req := validStockResourceRequest()
	req.Name = "  ブレンド豆  "
	var created models.StockResourceResponse
	api.do(http.MethodPost, "/api/inventory/resources", req).expect(http.StatusCreated).decode(&created)
	if created.Name != "ブレンド豆" || created.Kind != models.StockResourceKindBean || created.PerServing != 15 {
		t.Fatalf("created: %+v", created)
	}
	invalid := validStockResourceRequest()
	invalid.PerServing = 0
	api.do(http.MethodPost, "/api/inventory/resources", invalid).expect(http.StatusBadRequest)
	api.do(http.MethodPost, "/api/inventory/resources", `{`).expect(http.StatusBadRequest)

	// まだ棚卸しも入荷も無いので、残量は出せない
	status := api.inventory()["ブレンド豆"]
	if status.Level != models.InventoryLevelUntracked || status.Remaining != nil {
		t.Fatalf("untracked: %+v", status)
	}

	resource := models.StockResource{ID: uuid.UUID(created.Id)}
	base := "/api/inventory/resources/" + created.Id.String()
	threshold := 60
	api.setLastAlertThreshold(resource, &threshold)

	// 名前だけの編集では通知の記録を残す（通知済みの警告を再送しない）
	req.Name = "ブレンド豆（深煎り）"
	var updated models.StockResourceResponse
	api.do(http.MethodPut, base, req).expect(http.StatusOK).decode(&updated)
	if updated.Name != "ブレンド豆（深煎り）" {
		t.Fatalf("updated: %+v", updated)
	}
	if got := api.lastAlertThreshold(resource); got == nil || *got != 60 {
		t.Fatalf("threshold must be kept: %v", got)
	}
	api.waitBackground()

	// 通知の区切りを変えたら、記録を消して数え直す
	req.NotifyFrom = 80
	api.do(http.MethodPut, base, req).expect(http.StatusOK)
	if got := api.lastAlertThreshold(resource); got != nil {
		t.Fatalf("threshold must be reset: %v", *got)
	}
	api.waitBackground()

	api.do(http.MethodPut, "/api/inventory/resources/abc", req).expect(http.StatusBadRequest)
	api.do(http.MethodPut, "/api/inventory/resources/"+uuid.NewString(), req).expect(http.StatusNotFound)
	api.do(http.MethodPut, base, invalid).expect(http.StatusBadRequest)
	api.do(http.MethodPut, base, `{`).expect(http.StatusBadRequest)

	// 削除すると、使用量の設定も消える
	api.create(&models.ItemStockUsage{ItemID: m.blend.ID, ResourceID: resource.ID, Amount: 15})
	api.do(http.MethodDelete, base, nil).expect(http.StatusNoContent)
	if n := api.count(&models.ItemStockUsage{}, "resource_id = ?", resource.ID); n != 0 {
		t.Errorf("%d usages left", n)
	}
	if _, ok := api.inventory()["ブレンド豆（深煎り）"]; ok {
		t.Error("deleted resource must not be listed")
	}
	api.do(http.MethodDelete, base, nil).expect(http.StatusNotFound)
	api.do(http.MethodDelete, "/api/inventory/resources/abc", nil).expect(http.StatusBadRequest)
}

// 残量は、基準点（最後の棚卸し、無ければ最初の入荷）からの入荷と注文での消費で決まる
func TestInventoryRemainingAndCount(t *testing.T) {
	api := newTestAPI(t)
	m := api.seedMaster()
	beans := api.seedBeans(m)
	now := time.Now()

	api.seedStockEvent(beans, models.StockEventKindReceipt, 1000, now.Add(-2*time.Hour))
	// 基準点より前で、遡る範囲（3 時間）からも外れた古い注文は数えない
	api.seedOrder(m.pairMenu, now.Add(-6*time.Hour), nil)
	// 作り終えたブレンド 1 杯と、まだ作っていないペアセット（ブレンド 2 杯）
	readyAt := now.Add(-80 * time.Minute)
	api.seedOrder(m.blendMenu, now.Add(-90*time.Minute), &readyAt)
	api.seedOrder(m.pairMenu, now.Add(-30*time.Minute), nil)
	// 豆を使わないメニューは数えない
	api.seedOrder(m.iceMenu, now.Add(-10*time.Minute), nil)

	status := api.inventory()["ブレンド豆"]
	if status.Received != 1000 || status.Consumed != 45 || status.Servings != 3 || status.ServingsLastHour != 2 {
		t.Fatalf("status: %+v", status)
	}
	if !floatPtrEq(status.Remaining, 955) || !floatPtrEq(status.RemainingServings, 955.0/15) || status.Level != models.InventoryLevelOk {
		t.Fatalf("remaining: %+v", status)
	}
	if status.CountedQuantity != nil || status.CountedAt == nil {
		t.Fatalf("baseline must be the receipt: %+v", status)
	}

	// 棚卸しで 900g あった。推定 955g とのずれから、実際の 1 杯あたりの使用量を出す
	note := "閉店後"
	var counted models.StockEventCreateResponse
	api.do(http.MethodPost, "/api/inventory/resources/"+beans.ID.String()+"/events",
		models.StockEventCreateRequest{Kind: models.StockEventKindCount, Quantity: 900, Note: &note}).
		expect(http.StatusCreated).decode(&counted)
	if !floatPtrEq(counted.Estimated, 955) || !floatPtrEq(counted.ActualPerServing, (955+45-900)/3.0) {
		t.Fatalf("count response: estimated=%v actual=%v", counted.Estimated, counted.ActualPerServing)
	}
	if counted.Event.Kind != models.StockEventKindCount || *counted.Event.Note != "閉店後" || counted.Event.ResourceId != openapi_types.UUID(beans.ID) {
		t.Fatalf("event: %+v", counted.Event)
	}
	api.waitBackground()

	// 棚卸しが新しい基準点になる。まだ作っていないペアセットは、棚卸しのあとに作るので消費に数える
	status = api.inventory()["ブレンド豆"]
	if !floatPtrEq(status.CountedQuantity, 900) || status.Consumed != 30 || !floatPtrEq(status.Remaining, 870) {
		t.Fatalf("after count: %+v", status)
	}

	// 入荷は基準点からの差分に足す
	var received models.StockEventCreateResponse
	api.do(http.MethodPost, "/api/inventory/resources/"+beans.ID.String()+"/events",
		models.StockEventCreateRequest{Kind: models.StockEventKindReceipt, Quantity: 500}).
		expect(http.StatusCreated).decode(&received)
	if received.Estimated != nil || received.ActualPerServing != nil {
		t.Fatalf("receipt must not estimate: %+v", received)
	}
	api.waitBackground()
	if status := api.inventory()["ブレンド豆"]; !floatPtrEq(status.Remaining, 1370) {
		t.Fatalf("after receipt: %+v", status)
	}
}

func TestCreateStockEventRejectsInvalidRequests(t *testing.T) {
	api := newTestAPI(t)
	beans := api.seedBeans(api.seedMaster())
	base := "/api/inventory/resources/" + beans.ID.String() + "/events"

	api.do(http.MethodPost, "/api/inventory/resources/abc/events", models.StockEventCreateRequest{Kind: models.StockEventKindCount}).expect(http.StatusBadRequest)
	api.do(http.MethodPost, base, `{`).expect(http.StatusBadRequest)
	api.do(http.MethodPost, base, models.StockEventCreateRequest{Kind: "other", Quantity: 1}).expect(http.StatusBadRequest)
	api.do(http.MethodPost, base, models.StockEventCreateRequest{Kind: models.StockEventKindReceipt, Quantity: -1}).expect(http.StatusBadRequest)
	api.do(http.MethodPost, "/api/inventory/resources/"+uuid.NewString()+"/events",
		models.StockEventCreateRequest{Kind: models.StockEventKindCount, Quantity: 1}).expect(http.StatusNotFound)

	if n := api.count(&models.StockEvent{}, ""); n != 0 {
		t.Fatalf("%d events saved", n)
	}
}

func TestReplaceStockUsages(t *testing.T) {
	api := newTestAPI(t)
	m := api.seedMaster()
	beans := api.seedBeans(m)
	cups := models.StockResource{ID: uuid.New(), Kind: "cup", Name: "カップ", Unit: "個", PerServing: 1}
	api.create(&cups)

	var usages []models.StockUsage
	api.do(http.MethodGet, "/api/inventory/usages", nil).expect(http.StatusOK).decode(&usages)
	if len(usages) != 1 || usages[0].ItemId != openapi_types.UUID(m.blend.ID) || usages[0].Amount != 15 {
		t.Fatalf("usages: %+v", usages)
	}

	// 丸ごと置き換える。ブレンドの豆の量を変え、カップを足す
	next := []models.StockUsage{
		{ItemId: openapi_types.UUID(m.blend.ID), ResourceId: openapi_types.UUID(beans.ID), Amount: 18},
		{ItemId: openapi_types.UUID(m.blend.ID), ResourceId: openapi_types.UUID(cups.ID), Amount: 1},
		{ItemId: openapi_types.UUID(m.iced.ID), ResourceId: openapi_types.UUID(cups.ID), Amount: 1},
	}
	api.do(http.MethodPut, "/api/inventory/usages", next).expect(http.StatusOK).decode(&usages)
	if len(usages) != 3 {
		t.Fatalf("replaced: %+v", usages)
	}
	api.waitBackground()
	api.do(http.MethodGet, "/api/inventory/usages", nil).expect(http.StatusOK).decode(&usages)
	if len(usages) != 3 {
		t.Fatalf("saved: %+v", usages)
	}
	var blendBeans models.ItemStockUsage
	if err := api.db.First(&blendBeans, "item_id = ? AND resource_id = ?", m.blend.ID, beans.ID).Error; err != nil || blendBeans.Amount != 18 {
		t.Fatalf("blend beans: %+v %v", blendBeans, err)
	}

	cases := map[string]any{
		"zero amount": []models.StockUsage{{ItemId: openapi_types.UUID(m.blend.ID), ResourceId: openapi_types.UUID(beans.ID), Amount: 0}},
		"duplicate pair": []models.StockUsage{
			{ItemId: openapi_types.UUID(m.blend.ID), ResourceId: openapi_types.UUID(beans.ID), Amount: 15},
			{ItemId: openapi_types.UUID(m.blend.ID), ResourceId: openapi_types.UUID(beans.ID), Amount: 16},
		},
		"broken json": `{`,
	}
	for name, body := range cases {
		if res := api.do(http.MethodPut, "/api/inventory/usages", body); res.Code != http.StatusBadRequest {
			t.Errorf("%s: status = %d, want 400: %s", name, res.Code, res.Body)
		}
	}
	// 失敗したら何も変えない
	if n := api.count(&models.ItemStockUsage{}, ""); n != 3 {
		t.Fatalf("%d usages", n)
	}

	// 空にすれば全部消える
	api.do(http.MethodPut, "/api/inventory/usages", []models.StockUsage{}).expect(http.StatusOK)
	if n := api.count(&models.ItemStockUsage{}, ""); n != 0 {
		t.Fatalf("%d usages left", n)
	}
}

// -------------------------------------------------------------------
// 通知

// 1000g 入荷したあと、ペアセット 4 つ（8 杯 = 120g）で残り 58.7 杯。60 杯の閾値を切っている
func (a *testAPI) seedBeansBelowThreshold() (testMaster, models.StockResource) {
	a.t.Helper()
	m := a.seedMaster()
	beans := a.seedBeans(m)
	now := time.Now()
	a.seedStockEvent(beans, models.StockEventKindReceipt, 1000, now.Add(-time.Hour))
	for range 4 {
		a.seedOrder(m.pairMenu, now.Add(-30*time.Minute), nil)
	}
	return m, beans
}

func TestCheckAlertsNotifiesOncePerThreshold(t *testing.T) {
	api := newTestAPI(t)
	m, beans := api.seedBeansBelowThreshold()
	ctx := context.Background()

	if err := api.inv.checkAlerts(ctx, nil); err != nil {
		t.Fatal(err)
	}
	sent := api.slack.sent()
	if len(sent) != 1 || !strings.Contains(sent[0], "*ブレンド豆* 残り約 58 杯（880 g）") {
		t.Fatalf("sent: %q", sent)
	}
	if got := api.lastAlertThreshold(beans); got == nil || *got != 60 {
		t.Fatalf("threshold: %v", got)
	}

	// 同じ閾値の中では送り直さない
	if err := api.inv.checkAlerts(ctx, nil); err != nil {
		t.Fatal(err)
	}
	if n := len(api.slack.sent()); n != 1 {
		t.Fatalf("sent %d messages", n)
	}

	// 次の閾値（40 杯）を切ったらまた送る。ペアセット 10 個（20 杯）で残り 38.7 杯
	for range 10 {
		api.seedOrder(m.pairMenu, time.Now().Add(-10*time.Minute), nil)
	}
	if err := api.inv.checkAlerts(ctx, []uuid.UUID{beans.ID}); err != nil {
		t.Fatal(err)
	}
	if sent := api.slack.sent(); len(sent) != 2 || !strings.Contains(sent[1], "残り約 38 杯") {
		t.Fatalf("sent: %q", sent)
	}
	if got := api.lastAlertThreshold(beans); got == nil || *got != 40 {
		t.Fatalf("threshold: %v", got)
	}

	// 入荷で残量が戻ったら、通知せずに記録を戻す
	api.seedStockEvent(beans, models.StockEventKindReceipt, 1000, time.Now())
	if err := api.inv.checkAlerts(ctx, nil); err != nil {
		t.Fatal(err)
	}
	if n := len(api.slack.sent()); n != 2 {
		t.Fatalf("sent %d messages", n)
	}
	if got := api.lastAlertThreshold(beans); got != nil {
		t.Fatalf("threshold must be reset: %v", *got)
	}
}

// 判定が残量を読んでから記録を書くまでの間に、別の判定（同時に来た注文）が記録を書き換える。
// stock_resources への最初の UPDATE の直前に、別の接続で last_alert_threshold を value にする
func interleaveAlertClaim(t *testing.T, api *testAPI, resource models.StockResource, value int) {
	t.Helper()
	var once sync.Once
	name := "test:interleave_alert_claim"
	if err := api.db.Callback().Update().Before("gorm:update").Register(name, func(tx *gorm.DB) {
		if tx.Statement.Table != "stock_resources" {
			return
		}
		once.Do(func() {
			if err := api.db.Exec("UPDATE stock_resources SET last_alert_threshold = ? WHERE id = ?", value, resource.ID).Error; err != nil {
				t.Error(err)
			}
		})
	}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = api.db.Callback().Update().Remove(name) })
}

// 同時に来た注文で判定が重なっても、通知は 1 回だけ（last_alert_threshold の条件付き UPDATE）。
// 先に記録を進めた方だけが送り、遅れた方は送らない
func TestCheckAlertsDoesNotNotifyWhenAnotherCheckClaimed(t *testing.T) {
	api := newTestAPI(t)
	_, beans := api.seedBeansBelowThreshold()
	interleaveAlertClaim(t, api, beans, 60)

	if err := api.inv.checkAlerts(context.Background(), nil); err != nil {
		t.Fatal(err)
	}
	if sent := api.slack.sent(); len(sent) != 0 {
		t.Fatalf("must not notify twice: %q", sent)
	}
	if got := api.lastAlertThreshold(beans); got == nil || *got != 60 {
		t.Fatalf("threshold: %v", got)
	}
}

// 残量が戻って記録を戻すときも、読んだ後に別の判定が記録を進めていたら古い残量で戻さない
func TestCheckAlertsDoesNotResetWhenAnotherCheckClaimed(t *testing.T) {
	api := newTestAPI(t)
	_, beans := api.seedBeansBelowThreshold()
	// 前は 40 杯で通知していたが、今は 58 杯（60 杯の閾値）に戻っている
	threshold := 40
	api.setLastAlertThreshold(beans, &threshold)
	interleaveAlertClaim(t, api, beans, 20)

	if err := api.inv.checkAlerts(context.Background(), nil); err != nil {
		t.Fatal(err)
	}
	if got := api.lastAlertThreshold(beans); got == nil || *got != 20 {
		t.Fatalf("newer threshold must be kept: %v", got)
	}
	if sent := api.slack.sent(); len(sent) != 0 {
		t.Fatalf("sent: %q", sent)
	}
}

// Slack に送れなかったら記録を戻し、次の判定で送り直す
func TestCheckAlertsRollsBackWhenSlackFails(t *testing.T) {
	api := newTestAPI(t)
	_, beans := api.seedBeansBelowThreshold()
	ctx := context.Background()

	api.slack.fail(http.StatusInternalServerError)
	if err := api.inv.checkAlerts(ctx, nil); err == nil {
		t.Fatal("expected slack error")
	}
	if got := api.lastAlertThreshold(beans); got != nil {
		t.Fatalf("threshold must be rolled back: %v", *got)
	}

	api.slack.fail(0)
	if err := api.inv.checkAlerts(ctx, nil); err != nil {
		t.Fatal(err)
	}
	if n := len(api.slack.sent()); n != 1 {
		t.Fatalf("must resend, sent %d", n)
	}
	if got := api.lastAlertThreshold(beans); got == nil || *got != 60 {
		t.Fatalf("threshold: %v", got)
	}
}

// 注文を作ると、その注文が使う在庫だけを判定して通知する
func TestCreateOrderTriggersStockAlert(t *testing.T) {
	api := newTestAPI(t)
	m, beans := api.seedBeansBelowThreshold()
	// 別の在庫対象（この注文では使わない）も閾値を切っている
	cups := models.StockResource{ID: uuid.New(), Kind: "cup", Name: "カップ", Unit: "個", PerServing: 1, NotifyFrom: 100, NotifyStep: 50}
	api.create(&cups, &models.ItemStockUsage{ItemID: m.iced.ID, ResourceID: cups.ID, Amount: 1})
	api.seedStockEvent(cups, models.StockEventKindCount, 10, time.Now())

	api.createOrder(1, m.blendMenu)

	select {
	case msg := <-api.slack.received:
		if !strings.Contains(msg, "ブレンド豆") || strings.Contains(msg, "カップ") {
			t.Fatalf("message: %q", msg)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("no alert")
	}
	api.waitBackground()
	if got := api.lastAlertThreshold(beans); got == nil || *got != 60 {
		t.Fatalf("threshold: %v", got)
	}
	if got := api.lastAlertThreshold(cups); got != nil {
		t.Fatalf("unrelated resource must not be checked: %v", *got)
	}
}

// -------------------------------------------------------------------
// リマインド

func TestRemindInventoryRequiresConfiguration(t *testing.T) {
	api := newTestAPI(t)
	api.do(http.MethodPost, "/api/inventory/remind", nil, "X-Cron-Secret", "").expect(http.StatusServiceUnavailable)
}

func TestRemindInventory(t *testing.T) {
	api := newTestAPI(t)
	api.inv.remindAuth.CronSecret = "s3cret"
	api.inv.posURL = "https://pos.example.com"
	m := api.seedMaster()
	beans := api.seedBeans(m)
	remind := func(headers ...string) testResponse {
		return api.do(http.MethodPost, "/api/inventory/remind", nil, headers...)
	}
	reason := func(res testResponse) string {
		var body models.InventoryRemindResponse
		res.expect(http.StatusOK).decode(&body)
		if body.Sent || body.Reason == nil {
			t.Fatalf("must skip: %s", res.Body)
		}
		return *body.Reason
	}

	remind().expect(http.StatusUnauthorized)
	remind("X-Cron-Secret", "wrong").expect(http.StatusUnauthorized)
	// ID トークンの検証先が無いので、Bearer では通らない
	remind("Authorization", "Bearer token").expect(http.StatusUnauthorized)

	// 営業していない（直近 3 時間に注文が無い）ときは送らない
	longAgo := time.Now().Add(-4 * time.Hour)
	api.seedOrder(m.blendMenu, longAgo, &longAgo)
	if got := reason(remind("X-Cron-Secret", "s3cret")); got != "no recent orders" {
		t.Fatalf("reason: %s", got)
	}

	// 1 時間以内に棚卸ししたものしか無ければ送らない
	api.seedOrder(m.blendMenu, time.Now().Add(-10*time.Minute), nil)
	api.seedStockEvent(beans, models.StockEventKindCount, 900, time.Now().Add(-30*time.Minute))
	if got := reason(remind("X-Cron-Secret", "s3cret")); got != "all resources counted recently" {
		t.Fatalf("reason: %s", got)
	}
	if n := len(api.slack.sent()); n != 0 {
		t.Fatalf("sent %d", n)
	}

	// 棚卸しから時間が経ったもの・一度も数えていないものを載せて送る
	if err := api.db.Model(&models.StockEvent{}).Where("resource_id = ?", beans.ID).
		Update("created_at", time.Now().Add(-2*time.Hour)).Error; err != nil {
		t.Fatal(err)
	}
	api.create(&models.StockResource{Kind: "cup", Name: "カップ", Unit: "個", PerServing: 1})
	var body models.InventoryRemindResponse
	remind("X-Cron-Secret", "s3cret").expect(http.StatusOK).decode(&body)
	if !body.Sent {
		t.Fatalf("must send: %+v", body)
	}
	sent := api.slack.sent()
	if len(sent) != 1 || !strings.Contains(sent[0], "• ブレンド豆: 残り約 59 杯（885 g）（最終確認 2 時間前）") ||
		!strings.Contains(sent[0], "• カップ: 未計測（最終確認 未実施）") ||
		!strings.HasSuffix(sent[0], "<https://pos.example.com/inventory|在庫ページを開く>") {
		t.Fatalf("sent: %q", sent)
	}

	// Slack に送れなければ 502
	api.slack.fail(http.StatusInternalServerError)
	remind("X-Cron-Secret", "s3cret").expect(http.StatusBadGateway)
}
