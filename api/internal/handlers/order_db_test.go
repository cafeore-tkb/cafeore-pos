package handlers

import (
	"net/http"
	"sync"
	"testing"
	"time"

	"cafeore-pos/api/internal/models"

	"github.com/google/uuid"
	openapi_types "github.com/oapi-codegen/runtime/types"
)

// 注文の作成・取得・編集・削除と、状態の変更の結合テスト（Postgres を使う）

func TestCreateOrderSavesMenusCupsAndComments(t *testing.T) {
	api := newTestAPI(t)
	m := api.seedMaster()

	discount := 12
	var resp models.OrderResponse
	api.do(http.MethodPost, "/api/orders", models.OrderCreateRequest{
		OrderId:         7,
		BillingAmount:   1300,
		Received:        2000,
		DiscountOrderId: &discount,
		MenuIds:         []models.MenuInfoCreate{menuLine(m.pairMenu), menuLine(m.blendMenu)},
		Comments:        &[]models.CommentCreateRequest{{Author: "cashier", Text: "氷少なめ"}},
	}).expect(http.StatusCreated).decode(&resp)

	if resp.OrderId != 7 || resp.BillingAmount != 1300 || resp.Received != 2000 || *resp.DiscountOrderId != 12 {
		t.Fatalf("order fields not saved: %+v", resp)
	}
	// 明細は注文した時点の名前と価格を持つ
	if len(resp.Menus) != 2 || resp.Menus[0].MenuName != "ペアセット" || resp.Menus[0].UnitPrice != 900 || resp.Menus[1].MenuName != "ブレンド" {
		t.Fatalf("menus: %+v", resp.Menus)
	}
	// ペアセットのブレンド 2 杯とブレンド 1 杯。ステッカー（グッズ）はカップにしない
	if len(resp.Cups) != 3 {
		t.Fatalf("cups: %+v", resp.Cups)
	}
	for i, cup := range resp.Cups {
		if cup.Item.Name != "ブレンド" || cup.ReadyAt != nil || cup.ServedAt != nil {
			t.Errorf("cups[%d]: %+v", i, cup)
		}
	}
	if resp.Cups[0].OrderMenuId != resp.Menus[0].Id || resp.Cups[2].OrderMenuId != resp.Menus[1].Id {
		t.Errorf("cups must belong to their menu lines: %+v", resp.Cups)
	}
	if resp.Comments == nil || len(*resp.Comments) != 1 || (*resp.Comments)[0].Text != "氷少なめ" {
		t.Errorf("comments: %+v", resp.Comments)
	}

	// 作った注文だけを配信する
	msg := api.nextBroadcast()
	if msg.Type != WSMessageTypeOrder || msg.Order == nil || msg.Order.Id != resp.Id || len(msg.Order.Cups) != 3 {
		t.Fatalf("broadcast: %+v", msg)
	}

	// DB にも入っている
	order := api.loadOrder(uuid.UUID(resp.Id))
	if len(order.OrderMenus) != 2 || len(order.OrderCups) != 3 || len(order.Comments) != 1 {
		t.Fatalf("saved order: %+v", order)
	}
	for i, cup := range order.OrderCups {
		if cup.Position != i {
			t.Errorf("cup positions must start from 0: %+v", order.OrderCups)
		}
	}
}

func TestCreateOrderRejectsInvalidMenus(t *testing.T) {
	api := newTestAPI(t)
	m := api.seedMaster()
	// 販売終了（論理削除）したメニュー
	if err := api.db.Delete(&m.iceMenu).Error; err != nil {
		t.Fatal(err)
	}

	cases := map[string]any{
		"no menus":     models.OrderCreateRequest{OrderId: 1, MenuIds: []models.MenuInfoCreate{}},
		"unknown menu": models.OrderCreateRequest{OrderId: 1, MenuIds: []models.MenuInfoCreate{{MenuId: uuid.New()}}},
		"deleted menu": models.OrderCreateRequest{OrderId: 1, MenuIds: []models.MenuInfoCreate{menuLine(m.iceMenu)}},
		// 新しい注文で既存の明細は指定できない
		"existing line": models.OrderCreateRequest{OrderId: 1, MenuIds: []models.MenuInfoCreate{
			{MenuId: m.blendMenu.ID, OrderMenuId: (*openapi_types.UUID)(&m.blendMenu.ID)},
		}},
		"broken json": `{"order_id": "1"`,
	}
	for name, body := range cases {
		if res := api.do(http.MethodPost, "/api/orders", body); res.Code != http.StatusBadRequest {
			t.Errorf("%s: status = %d, want 400: %s", name, res.Code, res.Body)
		}
	}

	// 途中まで作られたものも残らない
	if n := api.count(&models.Order{}, ""); n != 0 {
		t.Errorf("%d orders saved", n)
	}
	if n := api.count(&models.OrderMenu{}, ""); n != 0 {
		t.Errorf("%d order menus saved", n)
	}
	api.noBroadcast()
}

func TestGetOrders(t *testing.T) {
	api := newTestAPI(t)
	m := api.seedMaster()
	first := api.createOrder(1, m.blendMenu)
	second := api.createOrder(2, m.pairMenu)

	var all []models.OrderResponse
	api.do(http.MethodGet, "/api/orders", nil).expect(http.StatusOK).decode(&all)
	if len(all) != 2 {
		t.Fatalf("orders: %+v", all)
	}

	var got models.OrderResponse
	api.do(http.MethodGet, "/api/orders/"+second.Id.String(), nil).expect(http.StatusOK).decode(&got)
	if got.Id != second.Id || got.OrderId != 2 || len(got.Cups) != 2 {
		t.Fatalf("order: %+v", got)
	}

	// 販売終了したメニューの注文も、履歴として読める
	if err := api.db.Delete(&m.blendMenu).Error; err != nil {
		t.Fatal(err)
	}
	api.do(http.MethodGet, "/api/orders/"+first.Id.String(), nil).expect(http.StatusOK).decode(&got)
	if len(got.Menus) != 1 || got.Menus[0].Menu.Name != "ブレンド" {
		t.Fatalf("deleted menu must be loaded: %+v", got.Menus)
	}

	api.do(http.MethodGet, "/api/orders/"+uuid.NewString(), nil).expect(http.StatusNotFound)
	api.do(http.MethodGet, "/api/orders/abc", nil).expect(http.StatusBadRequest)
}

func TestUpdateOrderKeepsExistingLinesAndCups(t *testing.T) {
	api := newTestAPI(t)
	m := api.seedMaster()
	created := api.createOrder(1, m.pairMenu, m.blendMenu)

	// 1 杯目を提供してから、マスタの価格を変える
	api.do(http.MethodPatch, "/api/orders/"+created.Id.String()+"/cups/"+created.Cups[0].Id.String()+"/served", nil).expect(http.StatusOK)
	api.nextBroadcast()
	if err := api.db.Model(&m.pairMenu).Update("price", 1000).Error; err != nil {
		t.Fatal(err)
	}

	// ペアセットは残し、ブレンドをアイスコーヒーに替える
	pairLine := created.Menus[0].Id
	assignee := "たくみ"
	var resp models.OrderResponse
	api.do(http.MethodPut, "/api/orders/"+created.Id.String(), models.OrderUpdateRequest{
		Id: created.Id, OrderId: 1, BillingAmount: 1350, Received: 1350,
		MenuIds: []models.MenuInfoCreate{
			{MenuId: m.pairMenu.ID, OrderMenuId: &pairLine, Assignee: &assignee},
			menuLine(m.iceMenu),
		},
	}).expect(http.StatusOK).decode(&resp)

	if resp.BillingAmount != 1350 || len(resp.Menus) != 2 {
		t.Fatalf("order: %+v", resp)
	}
	// 既存の明細は ID と注文時の価格を引き継ぎ、担当者だけ変わる
	if resp.Menus[0].Id != pairLine || resp.Menus[0].UnitPrice != 900 || resp.Menus[0].Assignee == nil || *resp.Menus[0].Assignee != "たくみ" {
		t.Errorf("kept line: %+v", resp.Menus[0])
	}
	if resp.Menus[1].MenuName != "アイスコーヒー" || resp.Menus[1].UnitPrice != 450 {
		t.Errorf("new line: %+v", resp.Menus[1])
	}
	// ペアセットのカップは ID も状態もそのまま。消したブレンドのカップは無くなり、アイスが増える
	if len(resp.Cups) != 3 {
		t.Fatalf("cups: %+v", resp.Cups)
	}
	if resp.Cups[0].Id != created.Cups[0].Id || resp.Cups[0].ServedAt == nil || resp.Cups[1].Id != created.Cups[1].Id || resp.Cups[1].ServedAt != nil {
		t.Errorf("kept cups: %+v", resp.Cups[:2])
	}
	if resp.Cups[2].Item.Name != "アイスコーヒー" || resp.Cups[2].ReadyAt != nil {
		t.Errorf("new cup: %+v", resp.Cups[2])
	}

	msg := api.nextBroadcast()
	if msg.Type != WSMessageTypeOrder || msg.Order.Id != created.Id || len(msg.Order.Cups) != 3 {
		t.Fatalf("broadcast: %+v", msg)
	}
	// 古い明細とカップは DB からも消える
	if n := api.count(&models.OrderCup{}, "order_id = ?", created.Id); n != 3 {
		t.Errorf("%d cups in db", n)
	}
	if n := api.count(&models.OrderMenu{}, "order_id = ?", created.Id); n != 2 {
		t.Errorf("%d menus in db", n)
	}
}

// カップのある注文は、リクエストの ready_at / served_at ではなくカップから状態を決める
func TestUpdateOrderIgnoresStaleStatusOfCupOrder(t *testing.T) {
	api := newTestAPI(t)
	m := api.seedMaster()
	created := api.createOrder(1, m.blendMenu)
	line := created.Menus[0].Id

	// 編集画面を開いたあとに、別の端末で提供した
	api.do(http.MethodPatch, "/api/orders/"+created.Id.String()+"/served", nil).expect(http.StatusOK)
	api.nextBroadcast()

	// 編集画面は開いたときの（未提供の）状態のまま保存する
	var resp models.OrderResponse
	api.do(http.MethodPut, "/api/orders/"+created.Id.String(), models.OrderUpdateRequest{
		Id: created.Id, OrderId: 1, BillingAmount: 400, Received: 500,
		MenuIds: []models.MenuInfoCreate{{MenuId: m.blendMenu.ID, OrderMenuId: &line}},
	}).expect(http.StatusOK).decode(&resp)
	if resp.ServedAt == nil || resp.ReadyAt == nil || resp.Cups[0].ServedAt == nil {
		t.Fatalf("serving must not be reverted: %+v", resp)
	}
	if resp.Received != 500 {
		t.Errorf("received: %d", resp.Received)
	}
}

// グッズだけの注文はカップが無いので、リクエストの状態をそのまま使う
func TestUpdateOrderUsesRequestStatusWithoutCups(t *testing.T) {
	api := newTestAPI(t)
	m := api.seedMaster()
	goodsMenu := api.seedMenu("ステッカー", "sticker", 200, models.MenuItem{ItemID: m.sticker.ID, Quantity: 1})
	items := goodsMenu.MenuItems
	goodsMenu.MenuItems = nil
	api.create(&goodsMenu, &items)

	created := api.createOrder(1, goodsMenu)
	if len(created.Cups) != 0 {
		t.Fatalf("goods must not have cups: %+v", created.Cups)
	}
	line := created.Menus[0].Id
	servedAt := time.Now().Truncate(time.Microsecond)
	var resp models.OrderResponse
	api.do(http.MethodPut, "/api/orders/"+created.Id.String(), models.OrderUpdateRequest{
		Id: created.Id, OrderId: 1, BillingAmount: 200, Received: 200, ReadyAt: &servedAt, ServedAt: &servedAt,
		MenuIds: []models.MenuInfoCreate{{MenuId: goodsMenu.ID, OrderMenuId: &line}},
	}).expect(http.StatusOK).decode(&resp)
	if resp.ServedAt == nil || !resp.ServedAt.Equal(servedAt) {
		t.Fatalf("served_at: %+v", resp.ServedAt)
	}
}

func TestUpdateOrderRejectsInvalidRequests(t *testing.T) {
	api := newTestAPI(t)
	m := api.seedMaster()
	created := api.createOrder(1, m.blendMenu)
	other := api.createOrder(2, m.blendMenu)
	otherLine := other.Menus[0].Id

	api.do(http.MethodPut, "/api/orders/abc", models.OrderUpdateRequest{}).expect(http.StatusBadRequest)
	api.do(http.MethodPut, "/api/orders/"+created.Id.String(), `{`).expect(http.StatusBadRequest)
	api.do(http.MethodPut, "/api/orders/"+uuid.NewString(), models.OrderUpdateRequest{
		MenuIds: []models.MenuInfoCreate{menuLine(m.blendMenu)},
	}).expect(http.StatusNotFound)
	// 別の注文の明細は引き継げない
	api.do(http.MethodPut, "/api/orders/"+created.Id.String(), models.OrderUpdateRequest{
		OrderId: 1, MenuIds: []models.MenuInfoCreate{{MenuId: m.blendMenu.ID, OrderMenuId: &otherLine}},
	}).expect(http.StatusBadRequest)

	// 失敗した編集は何も変えない
	order := api.loadOrder(uuid.UUID(created.Id))
	if len(order.OrderMenus) != 1 || order.OrderMenus[0].ID != uuid.UUID(created.Menus[0].Id) || len(order.OrderCups) != 1 {
		t.Fatalf("order changed: %+v", order)
	}
	api.noBroadcast()
}

func TestDeleteOrder(t *testing.T) {
	api := newTestAPI(t)
	m := api.seedMaster()
	created := api.createOrder(1, m.pairMenu)
	kept := api.createOrder(2, m.blendMenu)

	api.do(http.MethodDelete, "/api/orders/"+created.Id.String(), nil).expect(http.StatusOK)

	msg := api.nextBroadcast()
	if msg.Type != WSMessageTypeOrderDeleted || msg.OrderID == nil || *msg.OrderID != uuid.UUID(created.Id) {
		t.Fatalf("broadcast: %+v", msg)
	}
	// 明細とカップもまとめて消え、他の注文は残る
	if n := api.count(&models.Order{}, ""); n != 1 {
		t.Errorf("%d orders left", n)
	}
	if n := api.count(&models.OrderMenu{}, "order_id = ?", created.Id); n != 0 {
		t.Errorf("%d order menus left", n)
	}
	if n := api.count(&models.OrderCup{}, "order_id = ?", created.Id); n != 0 {
		t.Errorf("%d order cups left", n)
	}
	if n := api.count(&models.OrderCup{}, "order_id = ?", kept.Id); n != 1 {
		t.Errorf("cups of other order: %d", n)
	}

	api.do(http.MethodDelete, "/api/orders/"+created.Id.String(), nil).expect(http.StatusNotFound)
	api.do(http.MethodDelete, "/api/orders/abc", nil).expect(http.StatusBadRequest)
	api.noBroadcast()
}

// -------------------------------------------------------------------
// 状態の変更

func cupStatesOf(resp models.OrderResponse) string {
	s := ""
	for _, cup := range resp.Cups {
		switch {
		case cup.ServedAt != nil:
			s += "s"
		case cup.ReadyAt != nil:
			s += "r"
		default:
			s += "p"
		}
	}
	return s
}

func (a *testAPI) patchStatus(url string) models.OrderResponse {
	a.t.Helper()
	var resp models.OrderResponse
	a.do(http.MethodPatch, url, nil).expect(http.StatusOK).decode(&resp)
	msg := a.nextBroadcast()
	if msg.Type != WSMessageTypeOrder || msg.Order.Id != resp.Id || cupStatesOf(*msg.Order) != cupStatesOf(resp) {
		a.t.Fatalf("broadcast must carry the changed order: %+v", msg)
	}
	return resp
}

func TestMarkOrderReadyAndServed(t *testing.T) {
	api := newTestAPI(t)
	m := api.seedMaster()
	created := api.createOrder(1, m.pairMenu)
	base := "/api/orders/" + created.Id.String()

	resp := api.patchStatus(base + "/ready")
	if resp.ReadyAt == nil || resp.ServedAt != nil || cupStatesOf(resp) != "rr" {
		t.Fatalf("ready: %+v", resp)
	}
	resp = api.patchStatus(base + "/served")
	if resp.ServedAt == nil || cupStatesOf(resp) != "ss" {
		t.Fatalf("served: %+v", resp)
	}
	// 提供の取消で呼び出し済みに戻る
	resp = api.patchStatus(base + "/served")
	if resp.ServedAt != nil || resp.ReadyAt == nil || cupStatesOf(resp) != "rr" {
		t.Fatalf("unserve: %+v", resp)
	}
	resp = api.patchStatus(base + "/ready")
	if resp.ReadyAt != nil || cupStatesOf(resp) != "pp" {
		t.Fatalf("unready: %+v", resp)
	}

	// DB にも保存されている
	order := api.loadOrder(uuid.UUID(created.Id))
	if order.ReadyAt != nil || order.OrderCups[0].ReadyAt != nil {
		t.Fatalf("saved order: %+v", order)
	}
}

func TestMarkOrderCupReadyAndServed(t *testing.T) {
	api := newTestAPI(t)
	m := api.seedMaster()
	created := api.createOrder(1, m.pairMenu)
	cup := func(i int) string {
		return "/api/orders/" + created.Id.String() + "/cups/" + created.Cups[i].Id.String()
	}

	resp := api.patchStatus(cup(0) + "/ready")
	if cupStatesOf(resp) != "rp" || resp.ReadyAt != nil {
		t.Fatalf("first cup ready: %+v", resp)
	}
	resp = api.patchStatus(cup(1) + "/served")
	if cupStatesOf(resp) != "rs" || resp.ReadyAt == nil || resp.ServedAt != nil {
		t.Fatalf("second cup served: %+v", resp)
	}
	// 全カップがそろうと注文も提供済みになる
	resp = api.patchStatus(cup(0) + "/served")
	if cupStatesOf(resp) != "ss" || resp.ServedAt == nil {
		t.Fatalf("all cups served: %+v", resp)
	}

	order := api.loadOrder(uuid.UUID(created.Id))
	if order.ServedAt == nil || order.OrderCups[0].ServedAt == nil || order.OrderCups[1].ServedAt == nil {
		t.Fatalf("saved order: %+v", order)
	}
}

func TestMarkOrderStatusRejectsInvalidTargets(t *testing.T) {
	api := newTestAPI(t)
	m := api.seedMaster()
	created := api.createOrder(1, m.blendMenu)
	other := api.createOrder(2, m.blendMenu)
	base := "/api/orders/" + created.Id.String()

	api.do(http.MethodPatch, "/api/orders/abc/ready", nil).expect(http.StatusBadRequest)
	api.do(http.MethodPatch, "/api/orders/"+uuid.NewString()+"/served", nil).expect(http.StatusNotFound)
	api.do(http.MethodPatch, base+"/cups/abc/ready", nil).expect(http.StatusBadRequest)
	api.do(http.MethodPatch, base+"/cups/"+uuid.NewString()+"/ready", nil).expect(http.StatusNotFound)
	// 別の注文のカップは操作できない
	api.do(http.MethodPatch, base+"/cups/"+other.Cups[0].Id.String()+"/served", nil).expect(http.StatusNotFound)

	if order := api.loadOrder(uuid.UUID(other.Id)); order.OrderCups[0].ServedAt != nil {
		t.Fatal("cup of other order must not change")
	}
	api.noBroadcast()
}

// 同じ注文のカップを別々の端末から同時に提供しても、どの操作も消えない（注文の行ロック）
func TestConcurrentCupOperationsAreNotLost(t *testing.T) {
	api := newTestAPI(t)
	m := api.seedMaster()
	created := api.createOrder(1, m.pairMenu, m.pairMenu, m.blendMenu, m.iceMenu)
	if len(created.Cups) != 6 {
		t.Fatalf("cups: %+v", created.Cups)
	}

	var wg sync.WaitGroup
	codes := make([]int, len(created.Cups))
	for i, cup := range created.Cups {
		wg.Add(1)
		go func() {
			defer wg.Done()
			// t を使う do は別の goroutine から Fatal できないので、ステータスだけ集める
			res := api.do(http.MethodPatch, "/api/orders/"+created.Id.String()+"/cups/"+cup.Id.String()+"/served", nil)
			codes[i] = res.Code
		}()
	}
	wg.Wait()
	for i, code := range codes {
		if code != http.StatusOK {
			t.Fatalf("request %d: status %d", i, code)
		}
	}

	order := api.loadOrder(uuid.UUID(created.Id))
	for i, cup := range order.OrderCups {
		if cup.ServedAt == nil {
			t.Errorf("cup %d lost its serving", i)
		}
	}
	// 最後の 1 杯を提供した操作が、注文も提供済みにしている
	if order.ServedAt == nil {
		t.Error("order must be served when all cups are served")
	}
}

// -------------------------------------------------------------------
// コメント

func TestOrderComments(t *testing.T) {
	api := newTestAPI(t)
	m := api.seedMaster()
	created := api.createOrder(1, m.blendMenu)
	base := "/api/orders/" + created.Id.String() + "/comments"

	var comments []models.CommentResponse
	api.do(http.MethodGet, base, nil).expect(http.StatusOK).decode(&comments)
	if len(comments) != 0 {
		t.Fatalf("comments: %+v", comments)
	}

	var comment models.CommentResponse
	api.do(http.MethodPost, base, models.CommentCreateRequest{Author: "master", Text: "豆を切らした"}).
		expect(http.StatusCreated).decode(&comment)
	if comment.OrderId != created.Id || comment.Author != "master" || comment.Text != "豆を切らした" {
		t.Fatalf("comment: %+v", comment)
	}
	// コメントの付いた注文を配信する
	msg := api.nextBroadcast()
	if msg.Type != WSMessageTypeOrder || msg.Order.Comments == nil || len(*msg.Order.Comments) != 1 {
		t.Fatalf("broadcast: %+v", msg)
	}

	api.do(http.MethodPost, base, models.CommentCreateRequest{Author: "serve", Text: "提供口で待ってもらう"}).expect(http.StatusCreated)
	api.nextBroadcast()

	// 新しい順に返す
	api.do(http.MethodGet, base, nil).expect(http.StatusOK).decode(&comments)
	if len(comments) != 2 || comments[0].Author != "serve" || comments[1].Author != "master" {
		t.Fatalf("comments must be newest first: %+v", comments)
	}

	api.do(http.MethodGet, "/api/orders/abc/comments", nil).expect(http.StatusBadRequest)
	api.do(http.MethodGet, "/api/orders/"+uuid.NewString()+"/comments", nil).expect(http.StatusNotFound)
	api.do(http.MethodPost, "/api/orders/abc/comments", models.CommentCreateRequest{}).expect(http.StatusBadRequest)
	api.do(http.MethodPost, base, `{`).expect(http.StatusBadRequest)
	api.do(http.MethodPost, "/api/orders/"+uuid.NewString()+"/comments", models.CommentCreateRequest{Author: "cashier", Text: "x"}).
		expect(http.StatusNotFound)
	api.noBroadcast()
}
