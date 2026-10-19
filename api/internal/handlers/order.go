// api/internal/handlers/orders.go
package handlers

import (
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	openapi_types "github.com/oapi-codegen/runtime/types"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"cafeore-pos/api/internal/models"
)

type OrderHandler struct {
	db        *gorm.DB
	hub       *Hub
	inventory *Inventory
}

func NewOrderHandler(db *gorm.DB, hub *Hub, inventory *Inventory) *OrderHandler {
	return &OrderHandler{db: db, hub: hub, inventory: inventory}
}

// 注文履歴では販売終了（論理削除）したメニューも参照する。
// 注文自体や販売用マスター一覧のスコープは変更しない。
func preloadOrder(db *gorm.DB) *gorm.DB {
	unscoped := func(db *gorm.DB) *gorm.DB { return db.Unscoped() }
	return db.
		Preload("OrderMenus.Menu", unscoped).
		Preload("OrderMenus.Menu.MenuItems.Item.ItemType").
		// カップは注文した順に並べ、後から削除した item・種類も表示できるようにする
		Preload("OrderCups", func(db *gorm.DB) *gorm.DB { return db.Order("order_cups.position") }).
		Preload("OrderCups.Item", unscoped).
		Preload("OrderCups.Item.ItemType", unscoped).
		Preload("OrderCups.Emergencies", func(db *gorm.DB) *gorm.DB { return db.Order("created_at, id") }).
		Preload("Payments", func(db *gorm.DB) *gorm.DB { return db.Order("order_payments.position") }).
		Preload("Comments")
}

var errInvalidOrderMenus = errors.New("invalid order menus")

// 空白だけの自由記述は指名なしとして扱う
func normalizeAssignee(assignee *string) *string {
	if assignee == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*assignee)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

// 指名はドリッパーの番号（1〜caosDrippers）が必須で、自由記述は番号に添えるだけ。
// 番号より前の注文の明細（番号が無く自由記述だけの指名）は、変えずに残すときだけ通す。
// 番号の付いた明細から番号だけを外して自由記述を残すことはできない。
func validateAssignment(dripper *int, assignee *string, old *models.OrderMenu) error {
	if dripper != nil {
		if *dripper < 1 || *dripper > caosDrippers {
			return errInvalidOrderMenus
		}
		return nil
	}
	if assignee != nil && (old == nil || old.Dripper != nil || !ptrEqual(assignee, normalizeAssignee(old.Assignee))) {
		return errInvalidOrderMenus
	}
	return nil
}

// 既存明細はIDで識別し、指名以外の保存値は引き継ぐ。
// 新規明細だけ販売中のマスターから価格・名称をスナップショットする。
func buildOrderMenus(orderID uuid.UUID, requests []models.MenuInfoCreate, existing []models.OrderMenu, menus []models.Menu) ([]models.OrderMenu, error) {
	byID := make(map[uuid.UUID]models.OrderMenu, len(existing))
	for _, line := range existing {
		byID[line.ID] = line
	}
	masters := make(map[uuid.UUID]models.Menu, len(menus))
	for _, menu := range menus {
		if !menu.DeletedAt.Valid {
			masters[menu.ID] = menu
		}
	}
	lines := make([]models.OrderMenu, 0, len(requests))
	for _, request := range requests {
		menuID := uuid.UUID(request.MenuId)
		assignee := normalizeAssignee(request.Assignee)
		line := models.OrderMenu{ID: uuid.New(), OrderID: orderID, MenuID: menuID, Assignee: assignee, Dripper: request.Dripper}
		var prev *models.OrderMenu // 残す既存の明細（新しい明細なら nil）
		if request.OrderMenuId != nil {
			old, ok := byID[uuid.UUID(*request.OrderMenuId)]
			if !ok || old.OrderID != orderID || old.MenuID != menuID {
				return nil, errInvalidOrderMenus
			}
			prev = &old
			line.ID, line.MenuName, line.UnitPrice, line.StockUsages = old.ID, old.MenuName, old.UnitPrice, old.StockUsages
			delete(byID, old.ID) // 同じ明細を二重に指定することはできない
		} else {
			menu, ok := masters[menuID]
			if !ok {
				return nil, errInvalidOrderMenus
			}
			line.MenuName, line.UnitPrice = menu.Name, menu.Price
		}
		if err := validateAssignment(request.Dripper, assignee, prev); err != nil {
			return nil, err
		}
		lines = append(lines, line)
	}
	return lines, nil
}

// 明細とカップを作る。existing は編集前の注文（新規作成では空の注文）。
func loadOrderMenus(db *gorm.DB, orderID uuid.UUID, requests []models.MenuInfoCreate, existing *models.Order) ([]models.OrderMenu, []models.OrderCup, error) {
	hasCups := make(map[uuid.UUID]bool, len(existing.OrderCups))
	for _, cup := range existing.OrderCups {
		hasCups[cup.OrderMenuID] = true
	}
	// ids は新しい明細のメニュー、legacyIDs はカップの無い既存の明細のメニュー
	var ids, legacyIDs []uuid.UUID
	for _, request := range requests {
		switch {
		case request.OrderMenuId == nil:
			ids = append(ids, uuid.UUID(request.MenuId))
		case !hasCups[uuid.UUID(*request.OrderMenuId)]:
			legacyIDs = append(legacyIDs, uuid.UUID(request.MenuId))
		}
	}
	var menus []models.Menu
	if len(ids) > 0 {
		if err := preloadMenu(db).Where("id IN ?", ids).Find(&menus).Error; err != nil {
			return nil, nil, err
		}
	}
	// 既存の明細のメニューは販売終了していてもカップに展開する
	if len(legacyIDs) > 0 {
		var legacyMenus []models.Menu
		if err := preloadMenu(db.Unscoped()).Where("id IN ?", legacyIDs).Find(&legacyMenus).Error; err != nil {
			return nil, nil, err
		}
		menus = append(menus, legacyMenus...)
	}
	lines, err := buildOrderMenus(orderID, requests, existing.OrderMenus, menus)
	if err != nil {
		return nil, nil, err
	}
	// 新しい明細で減る在庫を、今の在庫の設定で決めて残す。既存の明細は前に決めたものを引き継ぐ
	if len(ids) > 0 {
		var resources []models.StockResource
		if err := db.Preload("ItemTypes").Find(&resources).Error; err != nil {
			return nil, nil, err
		}
		menuByID := make(map[uuid.UUID]models.Menu, len(menus))
		for _, menu := range menus {
			menuByID[menu.ID] = menu
		}
		for i, request := range requests {
			if request.OrderMenuId == nil {
				lines[i].StockUsages = buildOrderStockUsages(orderID, lines[i].ID, menuByID[lines[i].MenuID], resources)
			}
		}
	}
	return lines, buildOrderCups(orderID, lines, existing, menus), nil
}

// アイテム 1 つで減る在庫対象：そのアイテムの在庫と、カップを作る（種類の makes_cup。order_cups と同じ isCupItem）アイテムなら
// その種類を使うカップ。注文の明細と緊急（入れ直し）で使う。
func itemStockResources(item models.Item, resources []models.StockResource) []models.StockResource {
	var used []models.StockResource
	for _, r := range resources {
		if (r.ItemID != nil && *r.ItemID == item.ID) ||
			(r.Kind == string(models.StockResourceKindCup) && isCupItem(item) && slices.ContainsFunc(r.ItemTypes, func(t models.StockResourceItemType) bool {
				return t.ItemTypeID == item.ItemTypeID
			})) {
			used = append(used, r)
		}
	}
	return used
}

// 明細 1 行で減る在庫。在庫対象（itemStockResources）ごとに、アイテムの数 × per_serving。
// 同じ在庫対象（同じ種類のアイテムが 2 つあるセットのカップなど）は 1 行にまとめる。
func buildOrderStockUsages(orderID, orderMenuID uuid.UUID, menu models.Menu, resources []models.StockResource) []models.OrderStockUsage {
	usages := []models.OrderStockUsage{}
	index := map[uuid.UUID]int{}
	add := func(r models.StockResource, quantity int) {
		i, ok := index[r.ID]
		if !ok {
			i = len(usages)
			index[r.ID] = i
			usages = append(usages, models.OrderStockUsage{OrderMenuID: orderMenuID, ResourceID: r.ID, OrderID: orderID})
		}
		usages[i].Servings += quantity
		usages[i].Amount += float64(quantity) * r.PerServing
	}
	for _, mi := range menu.MenuItems {
		for _, r := range itemStockResources(mi.Item, resources) {
			add(r, mi.Quantity)
		}
	}
	return usages
}

// DB models → API models 変換関数
func toOrderResponse(order *models.Order) models.OrderResponse {
	resp := models.OrderResponse{
		Id:                openapi_types.UUID(order.ID),
		OrderId:           order.OrderId,
		CreatedAt:         order.CreatedAt,
		ReadyAt:           order.ReadyAt,
		ServedAt:          order.ServedAt,
		CancelledAt:       order.CancelledAt,
		CashRefundedAt:    order.CashRefundedAt,
		SplitParentId:     (*openapi_types.UUID)(order.SplitParentID),
		BillingAmount:     order.BillingAmount,
		Received:          order.Received,
		DiscountOrderId:   &order.DiscountOrderId,
		DiscountOrderCups: &order.DiscountOrderCups,
		PaymentMethod:     orderPaymentMethod(order),
		Menus:             make([]models.MenuInfo, 0, len(order.OrderMenus)),
		Cups:              make([]models.OrderCupResponse, 0, len(order.OrderCups)),
	}
	now := time.Now()
	if len(order.SquareCheckouts) > 0 {
		status := squareRefundOutcomeOf(order.SquareCheckouts, now)
		resp.SquareRefundStatus = &status
	}
	resp.Payments = toOrderPaymentResponses(order, now)
	for i := range order.OrderCups {
		resp.Cups = append(resp.Cups, toOrderCupResponse(&order.OrderCups[i]))
	}
	// Menus変換
	if len(order.OrderMenus) > 0 {
		menus := make([]models.MenuInfo, 0, len(order.OrderMenus))
		for _, oi := range order.OrderMenus {
			menuInfo := models.MenuInfo{
				Id: openapi_types.UUID(oi.ID), MenuName: oi.MenuName, UnitPrice: oi.UnitPrice,
				Assignee: oi.Assignee, Dripper: oi.Dripper, Menu: toMenuResponse(&oi.Menu),
			}
			menus = append(menus, menuInfo)
		}
		resp.Menus = menus
	}
	// Comments変換
	if len(order.Comments) > 0 {
		comments := make([]models.CommentResponse, len(order.Comments))
		for i, comment := range order.Comments {
			comments[i] = toCommentResponse(&comment)
		}
		resp.Comments = &comments
	}

	return resp
}

// toOrderPaymentResponses は個別会計の支払いを応答の形にする。Square の支払いには、その決済の
// 決済画面の種類と返金の状態を載せる（attachSquareCheckouts で埋めた決済から引く）。
// 明細は、今の注文にあるものだけを返す（あとで編集して外した明細は落とす）。
func toOrderPaymentResponses(order *models.Order, now time.Time) []models.OrderPaymentResponse {
	lines := make(map[uuid.UUID]bool, len(order.OrderMenus))
	for _, line := range order.OrderMenus {
		lines[line.ID] = true
	}
	checkouts := make(map[uuid.UUID]*models.SquareCheckout, len(order.SquareCheckouts))
	for i := range order.SquareCheckouts {
		checkouts[order.SquareCheckouts[i].ID] = &order.SquareCheckouts[i]
	}
	payments := make([]models.OrderPaymentResponse, 0, len(order.Payments))
	for _, payment := range order.Payments {
		menuIDs := make([]openapi_types.UUID, 0, len(payment.OrderMenuIDs))
		for _, id := range payment.OrderMenuIDs {
			if lines[id] {
				menuIDs = append(menuIDs, openapi_types.UUID(id))
			}
		}
		resp := models.OrderPaymentResponse{
			Method:       models.PaymentMethod(payment.Method),
			Amount:       payment.Amount,
			Received:     payment.Received,
			Discount:     payment.Discount,
			OrderMenuIds: menuIDs,
		}
		if payment.SquareCheckoutID != nil {
			id := openapi_types.UUID(*payment.SquareCheckoutID)
			resp.SquareCheckoutId = &id
			if checkout := checkouts[*payment.SquareCheckoutID]; checkout != nil {
				paymentType := checkout.PaymentType
				status := squareRefundOutcome(checkout, now)
				resp.SquarePaymentType = &paymentType
				resp.SquareRefundStatus = &status
			}
		}
		payments = append(payments, resp)
	}
	return payments
}

// attachSquareCheckouts は Square で払った注文に、その決済（返金の状態を応答に載せる）を埋める。
// 個別会計の注文には決済が複数あり、作った順に並べる。
func attachSquareCheckouts(db *gorm.DB, orders []models.Order) error {
	ids := make([]uuid.UUID, 0, len(orders))
	for i := range orders {
		if orders[i].PaymentMethod == string(models.Square) {
			ids = append(ids, orders[i].ID)
		}
	}
	if len(ids) == 0 {
		return nil
	}
	var checkouts []models.SquareCheckout
	if err := db.Where("order_id IN ?", ids).Order("created_at, id").Find(&checkouts).Error; err != nil {
		return err
	}
	byOrder := make(map[uuid.UUID][]models.SquareCheckout, len(ids))
	for _, checkout := range checkouts {
		byOrder[*checkout.OrderID] = append(byOrder[*checkout.OrderID], checkout)
	}
	for i := range orders {
		orders[i].SquareCheckouts = byOrder[orders[i].ID]
	}
	return nil
}

// 列を足す前の行（payment_method が空）は現金として返す。
func orderPaymentMethod(order *models.Order) models.PaymentMethod {
	if order.PaymentMethod == string(models.Square) {
		return models.Square
	}
	return models.Cash
}

// squareCheckoutIDForOrder は作成リクエストの支払い方法を確かめ、Square の決済依頼の ID を返す。
// 現金なら nil。
func squareCheckoutIDForOrder(req models.CreateOrderJSONRequestBody) (*uuid.UUID, error) {
	method := models.Cash
	if req.PaymentMethod != nil {
		method = *req.PaymentMethod
	}
	switch method {
	case models.Cash:
		if req.SquareCheckoutId != nil {
			return nil, errors.New("square_checkout_id は payment_method が square のときだけ指定できます")
		}
		return nil, nil
	case models.Square:
		if req.SquareCheckoutId == nil {
			return nil, errors.New("payment_method が square のときは square_checkout_id が必要です")
		}
		id := uuid.UUID(*req.SquareCheckoutId)
		return &id, nil
	default:
		return nil, fmt.Errorf("payment_method %q には対応していません", method)
	}
}

// orderPaymentsFromRequest は作成リクエストの個別会計の支払いを確かめ、支払いと、それぞれが払った明細の
// menu_ids の中の位置を返す（明細の ID は明細を作ってから埋める）。payments が無ければ nil。
//
// amount の合計は billing_amount（分けた注文があればその請求額も足す）と同じでなければならない。現金はお預かりが amount 以上、
// Square は決済依頼の ID が要り、お預かりは amount にする。
// 小計を金額で分けて払うと、同じ明細が 2 つ以上の支払いに入る（1 つの支払いの中で重ねることはできない）。
func orderPaymentsFromRequest(req models.CreateOrderJSONRequestBody) ([]models.OrderPayment, [][]int, error) {
	if req.Payments == nil {
		return nil, nil, nil
	}
	if req.SquareCheckoutId != nil || (req.PaymentMethod != nil && *req.PaymentMethod != models.Cash) {
		return nil, nil, errors.New("payments を指定するときは payment_method・square_checkout_id は指定できません")
	}
	requests := *req.Payments
	if len(requests) == 0 {
		return nil, nil, errors.New("payments を空にはできません")
	}
	payments := make([]models.OrderPayment, len(requests))
	indexes := make([][]int, len(requests))
	usedCheckouts := map[uuid.UUID]bool{}
	total := 0
	for i, request := range requests {
		discount := 0
		if request.Discount != nil {
			discount = *request.Discount
		}
		if request.Amount < 0 || discount < 0 {
			return nil, nil, fmt.Errorf("payments[%d] の amount・discount は 0 以上にしてください", i)
		}
		payment := models.OrderPayment{
			Position: i, Method: string(request.Method), Amount: request.Amount, Received: request.Received,
			Discount: discount, OrderMenuIDs: []uuid.UUID{},
		}
		switch request.Method {
		case models.Cash:
			if request.SquareCheckoutId != nil {
				return nil, nil, fmt.Errorf("payments[%d] の square_checkout_id は method が square のときだけ指定できます", i)
			}
			if request.Received < request.Amount {
				return nil, nil, fmt.Errorf("payments[%d] のお預かり %d 円が %d 円に足りません", i, request.Received, request.Amount)
			}
		case models.Square:
			if request.SquareCheckoutId == nil {
				return nil, nil, fmt.Errorf("payments[%d] は method が square なので square_checkout_id が必要です", i)
			}
			id := uuid.UUID(*request.SquareCheckoutId)
			if usedCheckouts[id] {
				return nil, nil, fmt.Errorf("payments[%d] の決済は別の支払いにも使われています", i)
			}
			usedCheckouts[id] = true
			payment.SquareCheckoutID = &id
			// 端末で amount ちょうどを受け取っているので、お預かりは amount と同じ。
			payment.Received = request.Amount
		default:
			return nil, nil, fmt.Errorf("payments[%d] の method %q には対応していません", i, request.Method)
		}
		if request.MenuIndexes != nil {
			usedLines := map[int]bool{}
			for _, index := range *request.MenuIndexes {
				if index < 0 || index >= len(req.MenuIds) || usedLines[index] {
					return nil, nil, fmt.Errorf("payments[%d] の menu_indexes が正しくありません", i)
				}
				usedLines[index] = true
				indexes[i] = append(indexes[i], index)
			}
		}
		total += request.Amount
		payments[i] = payment
	}
	if expected := splitPaymentsTotal(req); total != expected {
		return nil, nil, fmt.Errorf("payments の amount の合計 %d 円が請求額 %d 円と一致しません", total, expected)
	}
	return payments, indexes, nil
}

// 全オーダーを WSMessage にする。取得に失敗したら ok = false
func ordersMessage(db *gorm.DB) (WSMessage, bool) {
	var orders []models.Order
	if err := preloadOrder(db).Find(&orders).Error; err != nil {
		return WSMessage{}, false
	}
	if err := attachSquareCheckouts(db, orders); err != nil {
		return WSMessage{}, false
	}
	responses := make([]models.OrderResponse, len(orders))
	for i, o := range orders {
		responses[i] = toOrderResponse(&o)
	}
	return WSMessage{
		Type:   WSMessageTypeOrders,
		Orders: responses,
	}, true
}

// GET /api/orders - オーダー一覧取得
func (h *OrderHandler) GetOrders(c *gin.Context) {
	var orders []models.Order
	if err := preloadOrder(h.db).Find(&orders).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if err := attachSquareCheckouts(h.db, orders); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// API型に変換
	responses := make([]models.OrderResponse, len(orders))
	for i, order := range orders {
		responses[i] = toOrderResponse(&order)
	}

	c.JSON(http.StatusOK, responses)
}

// 冪等キー付きの作成で、その注文がすでにあれば作らずに返す（作ったときは nil）。
// 応答が届かずにクライアントが送り直しても、注文が二重にできないようにする。
// 同じキーの作成が同時に走ると後の方は主キーの重複で失敗するので、そのときも先にできた注文を返す。
func createOrderOnce(hasKey bool, findExisting func() (*models.Order, error), create func() error) (*models.Order, error) {
	if !hasKey {
		return nil, create()
	}
	existing, err := findExisting()
	if err != nil {
		return nil, err
	}
	if existing != nil {
		return existing, nil
	}
	createErr := create()
	if createErr == nil {
		return nil, nil
	}
	if existing, err := findExisting(); err == nil && existing != nil {
		return existing, nil
	}
	return nil, createErr
}

// orderCreatedAt は、作る注文の時刻を決める。レジが確定した時刻（created_at）があればそれを使う
// （オフラインで溜めた注文を、つながってから送るとき）。無ければサーバーの今。
// 端末の時計が進んでいても未来の注文にならないよう、今より後は今にする。
// 古い時刻も断らない。断るとレジに残った注文がいつまでも送れず、サーバーの今にすると前の日の注文が
// 今日の作るべき注文としてマスターや CaOS に出てしまうので、確定した時刻のまま残す
func orderCreatedAt(requested *time.Time, now time.Time) time.Time {
	if requested == nil || requested.After(now) {
		return now
	}
	return *requested
}

// 冪等キーは作る注文の ID にそのまま使い、主キーで二重登録を防ぐ。
// 全部 0 の UUID は BeforeCreate が別の ID に振り直してしまい二重を防げないので、キーなしとして扱う
func orderIDFromIdempotencyKey(key *openapi_types.UUID) (uuid.UUID, bool) {
	if key == nil || uuid.UUID(*key) == uuid.Nil {
		return uuid.New(), false
	}
	return uuid.UUID(*key), true
}

// POST /api/orders - オーダー作成
func (h *OrderHandler) CreateOrder(c *gin.Context) {
	var req models.CreateOrderJSONRequestBody

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	orderID, hasKey := orderIDFromIdempotencyKey(req.IdempotencyKey)
	squareCheckoutID, err := squareCheckoutIDForOrder(req)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	payments, paymentLines, err := orderPaymentsFromRequest(req)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	createdAt := orderCreatedAt(req.CreatedAt, time.Now())

	// API型 → DB型に変換
	order := models.Order{
		ID:                orderID,
		OrderId:           req.OrderId,
		CreatedAt:         createdAt,
		BillingAmount:     req.BillingAmount,
		Received:          req.Received,
		DiscountOrderCups: 0,
		PaymentMethod:     string(models.Cash),
	}
	if squareCheckoutID != nil {
		// 端末で請求額ちょうどを受け取っているので、お預かりは請求額と同じ。
		order.PaymentMethod = string(models.Square)
		order.Received = req.BillingAmount
	}
	// 個別会計は、お預かりの合計を注文のお預かりにし、Square の支払いを含めば Square の注文として扱う
	if payments != nil {
		order.Received = 0
		for i := range payments {
			payments[i].OrderID, payments[i].CreatedAt = order.ID, createdAt
			order.Received += payments[i].Received
			if payments[i].Method == string(models.Square) {
				order.PaymentMethod = string(models.Square)
			}
		}
	}

	if req.DiscountOrderId != nil {
		order.DiscountOrderId = *req.DiscountOrderId
	}

	if req.DiscountOrderCups != nil {
		order.DiscountOrderCups = *req.DiscountOrderCups
	}

	order.Comments = commentsFromRequest(req.Comments, createdAt)

	if len(req.MenuIds) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "menu_ids is required"})
		return
	}

	// 分けた注文（2 つ目以降）。支払いはこの注文がまとめて持つ（split_group.go）
	children, err := splitOrdersFromRequest(req, &order)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	findExisting := func() (*models.Order, error) {
		var existing models.Order
		err := preloadOrder(h.db).Where("id = ?", order.ID).Take(&existing).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		if err != nil {
			return nil, err
		}
		return &existing, nil
	}
	create := func() error {
		return h.db.Transaction(func(tx *gorm.DB) error {
			lines, cups, err := loadOrderMenus(tx, order.ID, req.MenuIds, &models.Order{})
			if err != nil {
				return err
			}
			order.OrderMenus, order.OrderCups = lines, cups
			// 個別会計の支払いに、払った明細の ID を入れる（作り直しても同じ値になるよう、ここで毎回入れ直す）
			order.Payments = make([]models.OrderPayment, len(payments))
			for i, payment := range payments {
				payment.OrderMenuIDs = make([]uuid.UUID, 0, len(paymentLines[i]))
				for _, index := range paymentLines[i] {
					payment.OrderMenuIDs = append(payment.OrderMenuIDs, lines[index].ID)
				}
				order.Payments[i] = payment
			}
			// グッズだけの注文は作るものが無いので、作った時点で準備完了・提供済みにする
			serveCuplessOrder(&order, order.CreatedAt)
			if err := tx.Create(&order).Error; err != nil {
				return err
			}
			now := time.Now()
			if err := recordServiceOperation(tx, "order.created", order.CreatedAt, now, map[string]any{
				"orderId": order.ID, "orderNo": order.OrderId, "cups": len(order.OrderCups),
				"billingAmount": order.BillingAmount,
			}); err != nil {
				return err
			}
			if squareCheckoutID != nil {
				return linkSquareCheckout(tx, *squareCheckoutID, order.ID, order.BillingAmount, now)
			}
			for _, payment := range order.Payments {
				if payment.SquareCheckoutID == nil {
					continue
				}
				if err := linkSquareCheckout(tx, *payment.SquareCheckoutID, order.ID, payment.Amount, now); err != nil {
					return err
				}
			}
			for i := range children {
				child := &children[i]
				lines, cups, err := loadOrderMenus(tx, child.ID, (*req.SplitOrders)[i].MenuIds, &models.Order{})
				if err != nil {
					return err
				}
				child.OrderMenus, child.OrderCups = lines, cups
				serveCuplessOrder(child, child.CreatedAt)
				if err := tx.Create(child).Error; err != nil {
					return err
				}
				if err := recordServiceOperation(tx, "order.created", child.CreatedAt, now, map[string]any{
					"orderId": child.ID, "orderNo": child.OrderId, "cups": len(child.OrderCups),
					"billingAmount": child.BillingAmount, "splitParentId": order.ID,
				}); err != nil {
					return err
				}
			}
			return nil
		})
	}

	existing, err := createOrderOnce(hasKey, findExisting, create)
	if err != nil {
		status := http.StatusInternalServerError
		if errors.Is(err, errInvalidOrderMenus) {
			status = http.StatusBadRequest
		}
		if errors.Is(err, errSquareCheckoutUnusable) {
			status = http.StatusConflict
		}
		c.JSON(status, gin.H{"error": err.Error()})
		return
	}
	status := http.StatusCreated
	if existing != nil {
		// 保存済みの注文を返すときも配信と残量の確認をする。前の作成が配信の前に失敗していても、
		// 送り直しで済ませるため。配信は同じ注文の置き換え、確認は通知済みなら送らないので、重ねても変わらない
		status = http.StatusOK
	}

	// 関連データをロードし、この注文（と分けた注文）だけを配信する。応答はこの注文
	group, err := splitGroupIDs(h.db, order.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if err := publishOrders(h.db, h.hub, otherOrders(group, order.ID)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	resp, err := publishOrder(h.db, h.hub, order.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(status, resp)
	go func() { h.inventory.CheckAlerts(h.inventory.ResourceIDsForOrders(group...)) }()
}

// GET /api/orders/:id - オーダー取得
func (h *OrderHandler) GetOrder(c *gin.Context) {
	id := c.Param("id")

	orderID, err := uuid.Parse(id)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid ID format"})
		return
	}

	var order models.Order
	if err := preloadOrder(h.db).First(&order, "id = ?", orderID).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Order not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	orders := []models.Order{order}
	if err := attachSquareCheckouts(h.db, orders); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, toOrderResponse(&orders[0]))
}

// PUT /api/orders/:id - オーダー更新
func (h *OrderHandler) UpdateOrder(c *gin.Context) {
	id := c.Param("id")

	orderID, err := uuid.Parse(id)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid ID format"})
		return
	}

	var req models.UpdateOrderJSONRequestBody

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// 明細が減ったときも閾値の記録を戻せるよう、変更前の分も見る。
	resourcesBefore := h.inventory.ResourceIDsForOrders(orderID)

	err = h.db.Transaction(func(tx *gorm.DB) error {
		// カップの状態変更と重なっても、どちらかの変更が消えないようにロックしてから読む
		order, err := lockOrder(tx, orderID)
		if err != nil {
			return err
		}
		if order.CancelledAt != nil {
			return errOrderCancelled
		}
		orderMenus, orderCups, err := loadOrderMenus(tx, order.ID, req.MenuIds, &order)
		if err != nil {
			return err
		}
		// カップのある注文の状態はカップから決め直す。リクエストの ready_at / served_at は
		// 編集画面を開いた時点の値なので、使うとその間のカップの操作を巻き戻してしまう。
		// カップの無い注文（グッズだけの注文）はリクエストの値を使い、提供済みでなければ提供済みにする
		// （飲み物を外してグッズだけになった注文が準備中のまま残らないように）。
		beforeCups := order.OrderCups
		order.OrderCups = orderCups
		order.ReadyAt, order.ServedAt = req.ReadyAt, req.ServedAt
		syncOrderWithCups(&order)
		serveCuplessOrder(&order, time.Now())
		if err := tx.Model(&models.Order{}).Where("id = ?", order.ID).Updates(map[string]any{
			"order_id":            req.OrderId,
			"ready_at":            order.ReadyAt,
			"served_at":           order.ServedAt,
			"billing_amount":      req.BillingAmount,
			"received":            req.Received,
			"discount_order_id":   req.DiscountOrderId,
			"discount_order_cups": req.DiscountOrderCups,
		}).Error; err != nil {
			return err
		}
		if err := tx.Where("order_id = ?", order.ID).Delete(&models.OrderMenu{}).Error; err != nil {
			return err
		}
		if err := tx.Where("order_id = ?", order.ID).Delete(&models.OrderCup{}).Error; err != nil {
			return err
		}
		if err := tx.Where("order_id = ?", order.ID).Delete(&models.OrderStockUsage{}).Error; err != nil {
			return err
		}
		// 明細と一緒に、その明細で減る在庫も入れ直す
		if len(orderMenus) > 0 {
			if err := tx.Create(&orderMenus).Error; err != nil {
				return err
			}
		}
		// 引き継いだカップは同じ ID・状態のまま入れ直す
		if len(orderCups) > 0 {
			if err := tx.Omit(clause.Associations).Create(&orderCups).Error; err != nil {
				return err
			}
		}
		// 外した明細のカップの入れ直しも消す
		var removed []uuid.UUID
		for _, cup := range beforeCups {
			if !slices.ContainsFunc(orderCups, func(kept models.OrderCup) bool { return kept.ID == cup.ID }) {
				removed = append(removed, cup.ID)
			}
		}
		if len(removed) == 0 {
			return nil
		}
		return deleteCupEmergencies(tx, "order_cup_id IN ?", removed)
	})
	if err != nil {
		status, message := http.StatusInternalServerError, err.Error()
		switch {
		case errors.Is(err, gorm.ErrRecordNotFound):
			status, message = http.StatusNotFound, "Order not found"
		case errors.Is(err, errInvalidOrderMenus):
			status = http.StatusBadRequest
		case errors.Is(err, errOrderCancelled):
			status = http.StatusConflict
		}
		c.JSON(status, gin.H{"error": message})
		return
	}

	resp, err := publishOrder(h.db, h.hub, orderID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, resp)
	go func() {
		h.inventory.CheckAlerts(mergeResourceIDs(resourcesBefore, h.inventory.ResourceIDsForOrders(orderID)))
	}()
}

// DELETE /api/orders/:id - オーダー削除
func (h *OrderHandler) DeleteOrder(c *gin.Context) {
	id := c.Param("id")

	orderID, err := uuid.Parse(id)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid ID format"})
		return
	}

	if err := h.deleteOrder(orderID); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "Order not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Order deleted successfully"})
}

// deleteOrder は注文（分けた注文はグループ全部）を明細・カップごと消し、画面へ配る。
// 注文が無ければ gorm.ErrRecordNotFound を返す。
func (h *OrderHandler) deleteOrder(orderID uuid.UUID) error {
	// 分けた注文は支払いを 1 つ目がまとめて持つので、まとめて消す（split_group.go）
	group, err := splitGroupIDs(h.db, orderID)
	if err != nil {
		return err
	}

	// 明細を消す前に、閾値の記録を戻す対象を取っておく
	resources := h.inventory.ResourceIDsForOrders(group...)

	// 注文明細・カップ・減った在庫・オーダーをまとめて削除し、途中で失敗したら全部戻す
	var deleted []uuid.UUID
	if err := h.db.Transaction(func(tx *gorm.DB) error {
		// カップの状態の変更や CaOS の操作と同じく、先に注文の行をロックする（カップの行を先に消すと、ロックの順番が逆になる）
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Model(&models.Order{}).
			Where("id IN ?", group).Order("id").Pluck("id", &deleted).Error; err != nil {
			return err
		}
		if len(deleted) == 0 {
			return nil // ほかで先に消された（下で 404 にする）
		}
		if err := tx.Where("order_id IN ?", deleted).Delete(&models.OrderMenu{}).Error; err != nil {
			return err
		}
		// カップの入れ直しも消す
		if err := deleteCupEmergencies(tx, "order_cup_id IN (?)", tx.Model(&models.OrderCup{}).Select("id").Where("order_id IN ?", deleted)); err != nil {
			return err
		}
		if err := tx.Where("order_id IN ?", deleted).Delete(&models.OrderCup{}).Error; err != nil {
			return err
		}
		if err := tx.Where("order_id IN ?", deleted).Delete(&models.OrderStockUsage{}).Error; err != nil {
			return err
		}
		if err := tx.Where("order_id IN ?", deleted).Delete(&models.OrderPayment{}).Error; err != nil {
			return err
		}
		// Square で受け取ったお金は注文を消しても返金されない。結び付きだけ外して
		// 「支払い済みなのに注文が無い」一覧（GET /api/square/checkouts/unlinked）に戻す。
		if err := tx.Model(&models.SquareCheckout{}).Where("order_id IN ?", deleted).Update("order_id", nil).Error; err != nil {
			return err
		}
		return tx.Delete(&models.Order{}, "id IN ?", deleted).Error
	}); err != nil {
		return err
	}

	if len(deleted) == 0 {
		return gorm.ErrRecordNotFound
	}

	for _, id := range deleted {
		publishOrderDeleted(h.db, h.hub, id)
	}
	go h.inventory.CheckAlerts(resources)
	return nil
}

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}
