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

	"cafeore-pos/api/internal/auth"
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
	remindAuth RemindAuth
	posURL     string
	// 在庫対象の変更と、棚卸し・入荷・調整の記録を流す
	activity *notify.Activity
}

// POST /api/inventory/remind を叩いてよい相手。どちらか一方を満たせば通す。
// 両方とも未設定ならリマインドは無効（503）。
type RemindAuth struct {
	// 本番の Cloud Scheduler 用。Authorization: Bearer の Google ID トークンを検証する
	Scheduler *auth.GoogleIDTokenVerifier
	// ローカルや手動実行用。X-Cron-Secret ヘッダーと一致すれば通す
	CronSecret string
}

func NewInventory(db *gorm.DB, slack *notify.Slack, remindAuth RemindAuth, posURL string, activity *notify.Activity) *Inventory {
	return &Inventory{db: db, slack: slack, remindAuth: remindAuth, posURL: posURL, activity: activity}
}

// ids が nil なら削除されていない在庫対象すべて。
func (inv *Inventory) snapshots(ctx context.Context, ids []uuid.UUID) ([]stockSnapshot, error) {
	db := inv.db.WithContext(ctx)

	var resources []models.StockResource
	// カップを先に、それぞれ名前の順に並べる
	q := db.Preload("Item").Preload("ItemTypes").
		Joins("LEFT JOIN items ON items.id = stock_resources.item_id").
		Order("stock_resources.kind, COALESCE(items.name, stock_resources.name)")
	if ids != nil {
		if len(ids) == 0 {
			return nil, nil
		}
		q = q.Where("stock_resources.id IN ?", ids)
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
	// 量は注文を受けたときに残したもの（order_stock_usages）で数える。
	err := db.Raw(`
		SELECT
			COALESCE(SUM(u.amount) FILTER (WHERE `+consumedAfter+`), 0) AS consumed,
			COALESCE(SUM(u.servings) FILTER (WHERE `+consumedAfter+`), 0) AS servings,
			COALESCE(SUM(u.servings) FILTER (WHERE o.created_at > @hour_ago), 0) AS servings_last_hour
		FROM orders o
		JOIN order_stock_usages u ON u.order_id = o.id
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
// Slack への送信で応答を待たせないよう goroutine で呼ぶので、失敗してもログに残すだけにする。
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
	// 通知の記録を進めたもの。送信に失敗したら元に戻して、次の判定で送り直す。
	type claim struct {
		id         uuid.UUID
		prev, next *int
	}
	var claims []claim
	// 途中で DB エラーが起きても、それまでに記録を進めた分は送るか戻すかしてから返す。
	var loopErr error
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
				loopErr = res.Error
			} else if res.RowsAffected == 1 {
				messages = append(messages, alertMessage(s))
				claims = append(claims, claim{id: s.Resource.ID, prev: last, next: next})
			}
		case reset:
			var value any = gorm.Expr("NULL")
			if next != nil {
				value = *next
			}
			// 読んだ後に別の判定が記録を進めていたら、古い残量で戻さない。
			if err := db.Model(&models.StockResource{}).
				Where("id = ? AND last_alert_threshold = ?", s.Resource.ID, *last).
				Update("last_alert_threshold", value).Error; err != nil {
				loopErr = err
			}
		}
		if loopErr != nil {
			break
		}
	}

	if len(messages) == 0 {
		return loopErr
	}
	sendErr := inv.slack.Send(ctx, strings.Join(messages, "\n"))
	if sendErr == nil {
		return loopErr
	}

	// 送信のタイムアウトで ctx が切れていても戻せるよう、別の期限で書き戻す。
	rollbackCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	rollback := inv.db.WithContext(rollbackCtx)
	for _, cl := range claims {
		var value any = gorm.Expr("NULL")
		if cl.prev != nil {
			value = *cl.prev
		}
		if err := rollback.Model(&models.StockResource{}).
			Where("id = ? AND last_alert_threshold = ?", cl.id, *cl.next).
			Update("last_alert_threshold", value).Error; err != nil {
			log.Printf("inventory: failed to roll back alert threshold of %s: %v", cl.id, err)
		}
	}
	return errors.Join(sendErr, loopErr)
}

// 注文で減る在庫対象。
func (inv *Inventory) ResourceIDsForOrder(orderID uuid.UUID) []uuid.UUID {
	if inv == nil {
		return nil
	}
	ids := []uuid.UUID{}
	if err := inv.db.Model(&models.OrderStockUsage{}).Distinct().
		Where("order_id = ?", orderID).Pluck("resource_id", &ids).Error; err != nil {
		log.Printf("inventory: failed to load resources for order %s: %v", orderID, err)
		return nil
	}
	return ids
}

// 注文の変更前後で使う在庫対象をまとめる。どちらかが取れなかった（nil）ならすべて見る。
func mergeResourceIDs(a, b []uuid.UUID) []uuid.UUID {
	if a == nil || b == nil {
		return nil
	}
	seen := make(map[uuid.UUID]bool, len(a)+len(b))
	merged := make([]uuid.UUID, 0, len(a)+len(b))
	for _, ids := range [][]uuid.UUID{a, b} {
		for _, id := range ids {
			if !seen[id] {
				seen[id] = true
				merged = append(merged, id)
			}
		}
	}
	return merged
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
	itemTypeIDs := make([]openapi_types.UUID, len(r.ItemTypes))
	for i, t := range r.ItemTypes {
		itemTypeIDs[i] = t.ItemTypeID
	}
	return models.StockResourceResponse{
		Id:          openapi_types.UUID(r.ID),
		Kind:        models.StockResourceKind(r.Kind),
		ItemId:      r.ItemID,
		Name:        r.DisplayName(),
		ItemTypeIds: itemTypeIDs,
		Unit:        r.Unit,
		PerServing:  r.PerServing,
		NotifyFrom:  r.NotifyFrom,
		NotifyStep:  r.NotifyStep,
		Buffer:      r.Buffer,
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

// cup ならカップの名前も見る。アイテムの在庫は名前も使う種類も持たない（名前はアイテムの名前）。
func validateStockResource(req *models.StockResourceRequest, cup bool) error {
	switch {
	case cup && (req.Name == nil || strings.TrimSpace(*req.Name) == ""):
		return errors.New("name is required for cups")
	case !cup && (req.Name != nil || req.ItemTypeIds != nil):
		return errors.New("name and item_type_ids are only for cups; item stock is named after its item, so rename the item instead")
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

// POST /api/inventory/resources - カップの作成（アイテムの在庫はアイテムと一緒に作る）
func (h *InventoryHandler) CreateStockResource(c *gin.Context) {
	var req models.CreateStockResourceJSONRequestBody
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := validateStockResource(&req, true); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	resource := models.StockResource{
		Kind:       string(models.StockResourceKindCup),
		Name:       strings.TrimSpace(*req.Name),
		Unit:       req.Unit,
		PerServing: req.PerServing,
		NotifyFrom: req.NotifyFrom,
		NotifyStep: req.NotifyStep,
		Buffer:     req.Buffer,
	}
	err := h.inv.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&resource).Error; err != nil {
			return err
		}
		return replaceCupItemTypes(tx, &resource, req.ItemTypeIds)
	})
	if err != nil {
		c.JSON(stockResourceErrorStatus(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, toStockResourceResponse(&resource))
	h.inv.activity.Post(stockResourceCreatedMessage(&resource, h.inv.itemTypeNames(resource.ItemTypes)))
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

	var resource models.StockResource
	if err := h.inv.db.Preload("Item").Preload("ItemTypes").First(&resource, "id = ?", id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "Resource not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	isCup := resource.Kind == string(models.StockResourceKindCup)
	if err := validateStockResource(&req, isCup); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// 閾値の区切りが変わると以前の通知記録は意味を失うので、今の残量から数え直す。
	// 名前や Buffer だけの編集では記録を残し、通知済みの警告を再送しない。
	// 読んだ後に注文の判定が通知の記録を進めていることがあるので、編集したカラムだけ書く。
	before := resource
	columns := []string{"unit", "per_serving", "notify_from", "notify_step", "buffer"}
	if resource.NotifyFrom != req.NotifyFrom || resource.NotifyStep != req.NotifyStep {
		resource.LastAlertThreshold = nil
		columns = append(columns, "last_alert_threshold")
	}
	if isCup {
		resource.Name = strings.TrimSpace(*req.Name)
		columns = append(columns, "name")
	}
	resource.Unit = req.Unit
	resource.PerServing = req.PerServing
	resource.NotifyFrom = req.NotifyFrom
	resource.NotifyStep = req.NotifyStep
	resource.Buffer = req.Buffer
	err := h.inv.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&resource).Select(columns).Updates(&resource).Error; err != nil {
			return err
		}
		return replaceCupItemTypes(tx, &resource, req.ItemTypeIds)
	})
	if err != nil {
		c.JSON(stockResourceErrorStatus(err), gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, toStockResourceResponse(&resource))
	go h.inv.CheckAlerts([]uuid.UUID{resource.ID})
	// 使う種類は送られたときだけ比べる（省略したときは今のまま）
	var typesBefore, typesAfter string
	if req.ItemTypeIds != nil {
		typesBefore, typesAfter = h.inv.itemTypeNames(before.ItemTypes), h.inv.itemTypeNames(resource.ItemTypes)
	}
	h.inv.activity.Post(stockResourceUpdatedMessage(&before, &resource, typesBefore, typesAfter))
}

// 通知に出す、カップを使う種類の名前を「ブレンド・グルメ」と並べる。消えた種類も名前で出したいので論理削除も含めて探す
func (inv *Inventory) itemTypeNames(types []models.StockResourceItemType) string {
	ids := make([]uuid.UUID, len(types))
	for i, t := range types {
		ids[i] = t.ItemTypeID
	}
	var names []string
	if len(ids) > 0 {
		if err := inv.db.Unscoped().Model(&models.ItemType{}).Where("id IN ?", ids).Order("name").Pluck("display_name", &names).Error; err != nil {
			log.Printf("activity: failed to load item types: %v", err)
		}
	}
	if len(names) == 0 {
		return "なし"
	}
	return strings.Join(names, "・")
}

var errInvalidCupItemTypes = errors.New("item_type_ids must be existing and unique item types")

func stockResourceErrorStatus(err error) int {
	if errors.Is(err, errInvalidCupItemTypes) {
		return http.StatusBadRequest
	}
	return http.StatusInternalServerError
}

// カップを使うアイテムの種類を、本文のとおりに置き換える。省略（nil）なら今のまま（アイテムの在庫では送れない）。
// 無い種類や重複があれば errInvalidCupItemTypes。
func replaceCupItemTypes(tx *gorm.DB, resource *models.StockResource, ids *[]openapi_types.UUID) error {
	if ids == nil {
		return nil
	}
	resource.ItemTypes = make([]models.StockResourceItemType, len(*ids))
	for i, id := range *ids {
		resource.ItemTypes[i] = models.StockResourceItemType{ResourceID: resource.ID, ItemTypeID: id}
	}
	if err := tx.Where("resource_id = ?", resource.ID).Delete(&models.StockResourceItemType{}).Error; err != nil {
		return err
	}
	if len(resource.ItemTypes) == 0 {
		return nil
	}
	var found int64
	if err := tx.Model(&models.ItemType{}).Where("id IN ?", *ids).Count(&found).Error; err != nil {
		return err
	}
	if found != int64(len(resource.ItemTypes)) {
		return errInvalidCupItemTypes
	}
	return tx.Create(&resource.ItemTypes).Error
}

// DELETE /api/inventory/resources/:id - カップの削除（アイテムの在庫はアイテムを消すと消える）
func (h *InventoryHandler) DeleteStockResource(c *gin.Context) {
	id, ok := parseUUIDParam(c)
	if !ok {
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
	if resource.Kind != string(models.StockResourceKindCup) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "item stock is deleted with its item"})
		return
	}
	// 同時に消したときに二重に通知しないよう、消せたときだけ通知する
	var deleted bool
	err := h.inv.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("resource_id = ?", id).Delete(&models.StockResourceItemType{}).Error; err != nil {
			return err
		}
		res := tx.Delete(&resource)
		deleted = res.RowsAffected > 0
		return res.Error
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.Status(http.StatusNoContent)
	if deleted {
		h.inv.activity.Post(stockResourceDeletedMessage(&resource))
	}
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
	if msg := validateStockEvent(req.Kind, req.Quantity); msg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": msg})
		return
	}

	// 記録する直前の推定。棚卸しなら推定とのずれと、実測の1回あたり使用量を返す。
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

	// 記録した直後の残量で通知する。応答の後に裏で数えると、その間の注文の分だけずれ、
	// 終了時（activity.Close）より後に Post して欠けることもあるので、ハンドラーの中で送る
	h.inv.postStockEvent(before[0].Resource, event, resp.Estimated)
	c.JSON(http.StatusCreated, resp)
	go h.inv.CheckAlerts([]uuid.UUID{id})
}

func (inv *Inventory) postStockEvent(resource models.StockResource, event models.StockEvent, estimated *float64) {
	var remaining *float64
	after, err := inv.snapshots(context.Background(), []uuid.UUID{resource.ID})
	if err != nil {
		log.Printf("activity: failed to calculate remaining of %s: %v", resource.DisplayName(), err)
	} else if len(after) > 0 {
		remaining = after[0].Remaining()
	}
	inv.activity.Post(stockEventMessage(&resource, &event, estimated, remaining))
}

// 記録の種類と数量の組み合わせを検証し、不正なら 400 で返す文言を返す。
// count は実数なので 0 以上。receipt は入荷なので正の数に限り、減らすときは adjust を使う。
// adjust は差分なので負の値も取れるが、0 は何も変えないので受け付けない。
func validateStockEvent(kind models.StockEventKind, quantity float64) string {
	switch kind {
	case models.StockEventKindCount:
		if quantity < 0 {
			return "quantity must not be negative"
		}
	case models.StockEventKindReceipt:
		if quantity <= 0 {
			return "quantity must be positive for receipt (use adjust to decrease)"
		}
	case models.StockEventKindAdjust:
		if quantity == 0 {
			return "quantity must not be zero for adjust"
		}
	default:
		return "kind must be count, receipt or adjust"
	}
	return ""
}

// POST /api/inventory/remind - 残量確認のリマインド（スケジューラから呼ぶ）
func (h *InventoryHandler) RemindInventory(c *gin.Context) {
	ra := h.inv.remindAuth
	if ra.Scheduler == nil && ra.CronSecret == "" {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "inventory reminder is not configured"})
		return
	}

	ctx := c.Request.Context()

	authorized := false
	if ra.CronSecret != "" {
		given := c.GetHeader("X-Cron-Secret")
		authorized = subtle.ConstantTimeCompare([]byte(given), []byte(ra.CronSecret)) == 1
	}
	if !authorized && ra.Scheduler != nil {
		if token, ok := strings.CutPrefix(c.GetHeader("Authorization"), "Bearer "); ok {
			err := ra.Scheduler.Verify(ctx, token)
			if err != nil && !errors.Is(err, auth.ErrInvalidIDToken) {
				log.Printf("inventory: failed to verify id token: %v", err)
			}
			authorized = err == nil
		}
	}
	if !authorized {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

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
