// api/internal/handlers/inventory.go
package handlers

import (
	"context"
	"crypto/subtle"
	"errors"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	openapi_types "github.com/oapi-codegen/runtime/types"
	"gorm.io/gorm"

	"cafeore-pos/api/internal/models"
	"cafeore-pos/api/internal/notify"
)

const (
	// 棚卸しの時点で受けていてまだ作っていない注文は、実数に含まれているのに
	// 後から作られる。ready_at で後から消費したものとして数えるが、
	// 作られないまま放置された古い注文まで拾わないよう遡る範囲を絞る。
	pendingOrderWindow = 3 * time.Hour
	// リマインドを送るのは、この時間内に注文がある（営業している）ときだけ。
	remindActiveWindow = 3 * time.Hour
	// この時間内に棚卸ししたものはリマインドに載せない。
	remindRecentCount = time.Hour
)

// 残量の計算と Slack 通知。注文の作成・変更からも呼ぶ。
type Inventory struct {
	db         *gorm.DB
	slack      *notify.Slack
	cronSecret string
	posURL     string
}

func NewInventory(db *gorm.DB, slack *notify.Slack, cronSecret, posURL string) *Inventory {
	return &Inventory{db: db, slack: slack, cronSecret: cronSecret, posURL: posURL}
}

// ids が nil なら削除されていない在庫対象すべて。
func (inv *Inventory) snapshots(ctx context.Context, ids []uuid.UUID) ([]stockSnapshot, error) {
	db := inv.db.WithContext(ctx)

	var resources []models.StockResource
	q := db.Order("kind DESC, name")
	if ids != nil {
		if len(ids) == 0 {
			return nil, nil
		}
		q = q.Where("id IN ?", ids)
	}
	if err := q.Find(&resources).Error; err != nil {
		return nil, err
	}

	now := time.Now()
	result := make([]stockSnapshot, 0, len(resources))
	for _, r := range resources {
		var events []models.StockEvent
		if err := db.Where("resource_id = ?", r.ID).Order("created_at").Find(&events).Error; err != nil {
			return nil, err
		}
		s := stockSnapshot{Resource: r, Tracked: len(events) > 0}
		s.BaseAt, s.CountedQuantity, s.Received = stockBaseline(events)

		since := now
		if s.BaseAt != nil {
			since = *s.BaseAt
		}
		if err := inv.consumption(db, &s, since, now); err != nil {
			return nil, err
		}
		result = append(result, s)
	}
	return result, nil
}

func (inv *Inventory) consumption(db *gorm.DB, s *stockSnapshot, since, now time.Time) error {
	var row struct {
		Consumed         float64
		Servings         int
		ServingsLastHour int
	}

	pendingFrom := since.Add(-pendingOrderWindow)
	hourAgo := now.Add(-time.Hour)
	// SQL の LEAST() に渡すと simple protocol では text 同士の比較になるので、ここで決める。
	scanFrom := pendingFrom
	if hourAgo.Before(scanFrom) {
		scanFrom = hourAgo
	}

	// since 以降に受けた注文と、since より前に受けて since 以降に作った（まだ作っていない）注文。
	err := db.Raw(`
		SELECT
			COALESCE(SUM(mi.quantity * u.amount) FILTER (WHERE `+consumedAfter+`), 0) AS consumed,
			COALESCE(SUM(mi.quantity) FILTER (WHERE `+consumedAfter+`), 0) AS servings,
			COALESCE(SUM(mi.quantity) FILTER (WHERE o.created_at > @hour_ago), 0) AS servings_last_hour
		FROM orders o
		JOIN order_menus om ON om.order_id = o.id
		JOIN menu_items mi ON mi.menu_id = om.menu_id
		JOIN item_stock_usages u ON u.item_id = mi.item_id
		WHERE u.resource_id = @resource_id
			AND o.created_at > @scan_from`,
		map[string]any{
			"resource_id":  s.Resource.ID,
			"since":        since,
			"pending_from": pendingFrom,
			"hour_ago":     hourAgo,
			"scan_from":    scanFrom,
		}).Scan(&row).Error
	if err != nil {
		return err
	}

	s.Consumed, s.Servings, s.ServingsLastHour = row.Consumed, row.Servings, row.ServingsLastHour
	return nil
}

const consumedAfter = `o.created_at > @since OR (o.created_at > @pending_from AND (o.ready_at IS NULL OR o.ready_at > @since))`

// 通知の閾値を切ったものを Slack に流す。ids が nil ならすべて。
// 注文の応答を返した後に呼ぶので、失敗してもログに残すだけにする。
func (inv *Inventory) CheckAlerts(ids []uuid.UUID) {
	if inv == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := inv.checkAlerts(ctx, ids); err != nil {
		log.Printf("inventory: failed to check alerts: %v", err)
	}
}

func (inv *Inventory) checkAlerts(ctx context.Context, ids []uuid.UUID) error {
	snapshots, err := inv.snapshots(ctx, ids)
	if err != nil {
		return err
	}

	db := inv.db.WithContext(ctx)
	var messages []string
	for _, s := range snapshots {
		rs := s.RemainingServings()
		if rs == nil {
			continue
		}
		last := s.Resource.LastAlertThreshold
		next := alertThreshold(*rs, s.Resource.NotifyFrom, s.Resource.NotifyStep)
		notifyNow, reset := nextAlertState(last, next)

		switch {
		case notifyNow:
			// 同時に来た注文で二重に通知しないよう、下げられた方だけが送る。
			res := db.Model(&models.StockResource{}).
				Where("id = ? AND (last_alert_threshold IS NULL OR last_alert_threshold > ?)", s.Resource.ID, *next).
				Update("last_alert_threshold", *next)
			if res.Error != nil {
				return res.Error
			}
			if res.RowsAffected == 1 {
				messages = append(messages, alertMessage(s))
			}
		case reset:
			var value any = gorm.Expr("NULL")
			if next != nil {
				value = *next
			}
			if err := db.Model(&models.StockResource{}).Where("id = ?", s.Resource.ID).
				Update("last_alert_threshold", value).Error; err != nil {
				return err
			}
		}
	}

	if len(messages) == 0 {
		return nil
	}
	return inv.slack.Send(ctx, strings.Join(messages, "\n"))
}

// 注文に含まれるアイテムが使う在庫対象。
func (inv *Inventory) ResourceIDsForOrder(orderID uuid.UUID) []uuid.UUID {
	if inv == nil {
		return nil
	}
	ids := []uuid.UUID{}
	if err := inv.db.Raw(`
		SELECT DISTINCT u.resource_id
		FROM order_menus om
		JOIN menu_items mi ON mi.menu_id = om.menu_id
		JOIN item_stock_usages u ON u.item_id = mi.item_id
		WHERE om.order_id = ?`, orderID).Scan(&ids).Error; err != nil {
		log.Printf("inventory: failed to load resources for order %s: %v", orderID, err)
		return nil
	}
	return ids
}

// -------------------------------------------------------------------
// HTTP ハンドラー

type InventoryHandler struct {
	inv *Inventory
}

func NewInventoryHandler(inv *Inventory) *InventoryHandler {
	return &InventoryHandler{inv: inv}
}

func toStockResourceResponse(r *models.StockResource) models.StockResourceResponse {
	return models.StockResourceResponse{
		Id:         openapi_types.UUID(r.ID),
		Kind:       models.StockResourceKind(r.Kind),
		Name:       r.Name,
		Unit:       r.Unit,
		PerServing: r.PerServing,
		NotifyFrom: r.NotifyFrom,
		NotifyStep: r.NotifyStep,
		Buffer:     r.Buffer,
	}
}

func toInventoryStatus(s stockSnapshot) models.InventoryStatus {
	return models.InventoryStatus{
		Resource:          toStockResourceResponse(&s.Resource),
		Level:             s.Level(),
		CountedAt:         s.BaseAt,
		CountedQuantity:   s.CountedQuantity,
		Received:          s.Received,
		Consumed:          s.Consumed,
		Servings:          s.Servings,
		Remaining:         s.Remaining(),
		RemainingServings: s.RemainingServings(),
		ServingsLastHour:  s.ServingsLastHour,
	}
}

func toStockEventResponse(e *models.StockEvent) models.StockEventResponse {
	note := e.Note
	return models.StockEventResponse{
		Id:         openapi_types.UUID(e.ID),
		ResourceId: openapi_types.UUID(e.ResourceID),
		Kind:       models.StockEventKind(e.Kind),
		Quantity:   e.Quantity,
		Note:       &note,
		CreatedAt:  e.CreatedAt,
	}
}

func validateStockResource(req *models.StockResourceRequest) error {
	switch {
	case req.Kind != models.StockResourceKindCup && req.Kind != models.StockResourceKindBean:
		return errors.New("kind must be cup or bean")
	case strings.TrimSpace(req.Name) == "":
		return errors.New("name is required")
	case req.PerServing <= 0:
		return errors.New("per_serving must be positive")
	case req.NotifyFrom < 0 || req.NotifyStep < 0 || req.Buffer < 0:
		return errors.New("notify_from, notify_step and buffer must not be negative")
	}
	return nil
}

func parseUUIDParam(c *gin.Context) (uuid.UUID, bool) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid ID format"})
		return uuid.Nil, false
	}
	return id, true
}

// GET /api/inventory - 残量一覧
func (h *InventoryHandler) GetInventory(c *gin.Context) {
	snapshots, err := h.inv.snapshots(c.Request.Context(), nil)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	responses := make([]models.InventoryStatus, len(snapshots))
	for i, s := range snapshots {
		responses[i] = toInventoryStatus(s)
	}
	c.JSON(http.StatusOK, responses)
}

// POST /api/inventory/resources - 在庫対象の作成
func (h *InventoryHandler) CreateStockResource(c *gin.Context) {
	var req models.CreateStockResourceJSONRequestBody
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := validateStockResource(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	resource := models.StockResource{
		Kind:       string(req.Kind),
		Name:       strings.TrimSpace(req.Name),
		Unit:       req.Unit,
		PerServing: req.PerServing,
		NotifyFrom: req.NotifyFrom,
		NotifyStep: req.NotifyStep,
		Buffer:     req.Buffer,
	}
	if err := h.inv.db.Create(&resource).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, toStockResourceResponse(&resource))
}

// PUT /api/inventory/resources/:id - 在庫対象の更新
func (h *InventoryHandler) UpdateStockResource(c *gin.Context) {
	id, ok := parseUUIDParam(c)
	if !ok {
		return
	}
	var req models.UpdateStockResourceJSONRequestBody
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := validateStockResource(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var resource models.StockResource
	if err := h.inv.db.First(&resource, "id = ?", id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "Resource not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	resource.Kind = string(req.Kind)
	resource.Name = strings.TrimSpace(req.Name)
	resource.Unit = req.Unit
	resource.PerServing = req.PerServing
	resource.NotifyFrom = req.NotifyFrom
	resource.NotifyStep = req.NotifyStep
	resource.Buffer = req.Buffer
	// 閾値が変わると以前の通知記録は意味を失うので、今の残量から数え直す。
	resource.LastAlertThreshold = nil
	if err := h.inv.db.Save(&resource).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, toStockResourceResponse(&resource))
	h.inv.CheckAlerts([]uuid.UUID{resource.ID})
}

// DELETE /api/inventory/resources/:id - 在庫対象の削除
func (h *InventoryHandler) DeleteStockResource(c *gin.Context) {
	id, ok := parseUUIDParam(c)
	if !ok {
		return
	}

	var affected int64
	err := h.inv.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("resource_id = ?", id).Delete(&models.ItemStockUsage{}).Error; err != nil {
			return err
		}
		res := tx.Delete(&models.StockResource{}, "id = ?", id)
		affected = res.RowsAffected
		return res.Error
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if affected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Resource not found"})
		return
	}
	c.Status(http.StatusNoContent)
}

// GET /api/inventory/resources/:id/events - 棚卸し・入荷の履歴
func (h *InventoryHandler) GetStockEvents(c *gin.Context) {
	id, ok := parseUUIDParam(c)
	if !ok {
		return
	}
	var events []models.StockEvent
	if err := h.inv.db.Where("resource_id = ?", id).Order("created_at DESC").Limit(50).Find(&events).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	responses := make([]models.StockEventResponse, len(events))
	for i := range events {
		responses[i] = toStockEventResponse(&events[i])
	}
	c.JSON(http.StatusOK, responses)
}

// POST /api/inventory/resources/:id/events - 棚卸し・入荷・調整の記録
func (h *InventoryHandler) CreateStockEvent(c *gin.Context) {
	id, ok := parseUUIDParam(c)
	if !ok {
		return
	}
	var req models.CreateStockEventJSONRequestBody
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	switch req.Kind {
	case models.StockEventKindCount:
		if req.Quantity < 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "quantity must not be negative"})
			return
		}
	case models.StockEventKindReceipt, models.StockEventKindAdjust:
	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "kind must be count, receipt or adjust"})
		return
	}

	// 記録する直前の推定。棚卸しなら推定とのずれと、実測の1杯あたり使用量を返す。
	before, err := h.inv.snapshots(c.Request.Context(), []uuid.UUID{id})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if len(before) == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Resource not found"})
		return
	}

	event := models.StockEvent{
		ResourceID: id,
		Kind:       string(req.Kind),
		Quantity:   req.Quantity,
		CreatedAt:  time.Now(),
	}
	if req.Note != nil {
		event.Note = *req.Note
	}
	if err := h.inv.db.Create(&event).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	resp := models.StockEventCreateResponse{Event: toStockEventResponse(&event)}
	if req.Kind == models.StockEventKindCount {
		s := before[0]
		resp.Estimated = s.Remaining()
		if resp.Estimated != nil && s.Servings > 0 {
			used := (*resp.Estimated + s.Consumed - req.Quantity) / float64(s.Servings)
			resp.ActualPerServing = &used
		}
	}

	c.JSON(http.StatusCreated, resp)
	h.inv.CheckAlerts([]uuid.UUID{id})
}

// GET /api/inventory/usages - アイテムごとの使用量
func (h *InventoryHandler) GetStockUsages(c *gin.Context) {
	var usages []models.ItemStockUsage
	if err := h.inv.db.Find(&usages).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, toStockUsageResponses(usages))
}

func toStockUsageResponses(usages []models.ItemStockUsage) []models.StockUsage {
	responses := make([]models.StockUsage, len(usages))
	for i, u := range usages {
		responses[i] = models.StockUsage{
			ItemId:     openapi_types.UUID(u.ItemID),
			ResourceId: openapi_types.UUID(u.ResourceID),
			Amount:     u.Amount,
		}
	}
	return responses
}

// PUT /api/inventory/usages - 使用量をまとめて置き換える
func (h *InventoryHandler) ReplaceStockUsages(c *gin.Context) {
	var req models.ReplaceStockUsagesJSONRequestBody
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	type key struct{ item, resource uuid.UUID }
	seen := make(map[key]bool, len(req))
	usages := make([]models.ItemStockUsage, 0, len(req))
	for _, u := range req {
		k := key{uuid.UUID(u.ItemId), uuid.UUID(u.ResourceId)}
		if u.Amount <= 0 || seen[k] {
			c.JSON(http.StatusBadRequest, gin.H{"error": "amount must be positive and each item/resource pair must be unique"})
			return
		}
		seen[k] = true
		usages = append(usages, models.ItemStockUsage{ItemID: k.item, ResourceID: k.resource, Amount: u.Amount})
	}

	err := h.inv.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("1 = 1").Delete(&models.ItemStockUsage{}).Error; err != nil {
			return err
		}
		if len(usages) == 0 {
			return nil
		}
		return tx.Create(&usages).Error
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, toStockUsageResponses(usages))
	h.inv.CheckAlerts(nil)
}

// POST /api/inventory/remind - 残量確認のリマインド（スケジューラから呼ぶ）
func (h *InventoryHandler) RemindInventory(c *gin.Context) {
	if h.inv.cronSecret == "" {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "INVENTORY_CRON_SECRET is not set"})
		return
	}
	given := c.GetHeader("X-Cron-Secret")
	if subtle.ConstantTimeCompare([]byte(given), []byte(h.inv.cronSecret)) != 1 {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid cron secret"})
		return
	}

	ctx := c.Request.Context()
	now := time.Now()
	skip := func(reason string) {
		c.JSON(http.StatusOK, models.InventoryRemindResponse{Sent: false, Reason: &reason})
	}

	var recentOrders int64
	if err := h.inv.db.WithContext(ctx).Model(&models.Order{}).
		Where("created_at > ?", now.Add(-remindActiveWindow)).Count(&recentOrders).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if recentOrders == 0 {
		skip("no recent orders")
		return
	}

	snapshots, err := h.inv.snapshots(ctx, nil)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	var stale []stockSnapshot
	for _, s := range snapshots {
		recentlyCounted := s.CountedQuantity != nil && s.BaseAt != nil && now.Sub(*s.BaseAt) < remindRecentCount
		if !recentlyCounted {
			stale = append(stale, s)
		}
	}
	if len(stale) == 0 {
		skip("all resources counted recently")
		return
	}

	if err := h.inv.slack.Send(ctx, remindMessage(stale, now, h.inv.posURL)); err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, models.InventoryRemindResponse{Sent: true})
}
