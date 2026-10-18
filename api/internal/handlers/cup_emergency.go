package handlers

import (
	"fmt"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"

	"cafeore-pos/api/internal/models"
)

// POST /api/cup-emergencies - カップを緊急（入れ直し）にする。1 杯につき入れ直し（models.CupEmergency）を 1 つ足す。
// 入れ直しは CaOS で未割当の入れ直しのカードになり、あとはカップと同じく PUT /api/caos/cups・「次へ」で扱う（caos.go）。
func (h *CaosHandler) CreateCupEmergencies(c *gin.Context) {
	var req models.CupEmergencyCreateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if len(req.OrderCupIds) == 0 || len(sortedUnique(req.OrderCupIds, compareUUID)) != len(req.OrderCupIds) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "order_cup_ids は空にせず、同じカップを 2 回入れないでください"})
		return
	}
	var reason string
	if req.Reason != nil {
		reason = strings.TrimSpace(*req.Reason)
	}
	if utf8.RuneCountInString(reason) > cupEmergencyReasonMax {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("理由は %d 文字までです", cupEmergencyReasonMax)})
		return
	}
	rows, orderIDs, resourceIDs, err := h.addEmergencies(req.OrderCupIds, reason)
	if respondError(c, err) {
		return
	}
	ids := make([]uuid.UUID, len(rows))
	for i, row := range rows {
		ids[i] = row.ID
	}
	c.JSON(http.StatusCreated, models.CupEmergencyCreateResponse{Ids: ids})
	h.publish(orderIDs)
	h.checkStockAlerts(resourceIDs)
}

// 入れ直す理由の長さ（文字。OpenAPI の maxLength と同じ）
const cupEmergencyReasonMax = 100

// GET /api/cup-emergencies/reasons - 緊急の入力に出す理由の候補。前の日までも含めた全部の入れ直しの理由を、よく使う順に
// cupEmergencyReasonsLimit 個まで（同じ回数なら理由の文字の順。理由の無い入れ直しは数えない）。
func (h *CaosHandler) GetCupEmergencyReasons(c *gin.Context) {
	reasons := []string{}
	if err := h.db.Model(&models.CupEmergency{}).Where("reason <> ''").Group("reason").
		Order(`COUNT(*) DESC, reason COLLATE "C"`).Limit(cupEmergencyReasonsLimit).
		Pluck("reason", &reasons).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, reasons)
}

// 理由の候補の数
const cupEmergencyReasonsLimit = 5

// addEmergencies は cupIDs のカップに理由 reason の入れ直しを 1 つずつ足し（cupIDs と同じ順）、入れ直しで減る在庫を残す。
// 足したカップの注文と、減らした在庫対象の ID も返す。
// 今日の注文の、抽出が要るカップだけ。注文の行をロックしてから足す（注文の編集・CaOS の書き込みと同じ順番）。
func (h *CaosHandler) addEmergencies(cupIDs []uuid.UUID, reason string) (rows []models.CupEmergency, orderIDs, resourceIDs []uuid.UUID, err error) {
	now := h.now()
	start, end := caosToday(now)
	err = h.db.Transaction(func(tx *gorm.DB) error {
		rows, orderIDs, resourceIDs = nil, nil, nil
		unscoped := func(db *gorm.DB) *gorm.DB { return db.Unscoped() }
		var cups []models.OrderCup
		if err := tx.Preload("Item", unscoped).Preload("Item.ItemType", unscoped).
			Find(&cups, "id IN ?", cupIDs).Error; err != nil {
			return err
		}
		if len(cups) != len(cupIDs) {
			return conflictErrorf("カップが消えました（注文が編集・削除されたかもしれません）")
		}
		cupByID := make(map[uuid.UUID]models.OrderCup, len(cups))
		var lockIDs []uuid.UUID
		for _, cup := range cups {
			if !cup.Item.ItemType.BrewRequired() {
				return ruleErrorf("抽出の要らないカップ（%s）は入れ直せません", cup.Item.Name)
			}
			cupByID[cup.ID] = cup
			lockIDs = append(lockIDs, cup.OrderID)
		}
		orders, err := lockCaosOrders(tx, lockIDs, nil, start, end)
		if err != nil {
			return err
		}
		// 減る在庫は、注文と同じく今（足したとき）の在庫の設定で決めて残す
		var resources []models.StockResource
		if err := tx.Preload("ItemTypes").Find(&resources).Error; err != nil {
			return err
		}
		var usages []models.CupEmergencyStockUsage
		for _, id := range cupIDs {
			cup := cupByID[id]
			// ロックしてから、カップがまだあるか（注文の編集で外れていないか）
			if findOrderCup(orders[cup.OrderID], cup.ID) == nil {
				return conflictErrorf("カップが消えました（注文が編集されたかもしれません）")
			}
			row := models.CupEmergency{ID: uuid.New(), OrderCupID: cup.ID, CreatedAt: now, Reason: reason}
			rows = append(rows, row)
			for _, r := range itemStockResources(cup.Item, resources) {
				usages = append(usages, models.CupEmergencyStockUsage{CupEmergencyID: row.ID, ResourceID: r.ID, Servings: 1, Amount: r.PerServing})
				resourceIDs = append(resourceIDs, r.ID)
			}
		}
		window, err := readCaosLogWindow(tx, cupIDs, nil, start, end)
		if err != nil {
			return err
		}
		if err := tx.Create(&rows).Error; err != nil {
			return err
		}
		if len(usages) > 0 {
			if err := tx.Create(&usages).Error; err != nil {
				return err
			}
		}
		for id := range orders {
			orderIDs = append(orderIDs, id)
		}
		var addedIDs []uuid.UUID
		for _, row := range rows {
			addedIDs = append(addedIDs, row.ID)
		}
		added, err := readCaosLogWindow(tx, addedIDs, nil, start, end)
		if err != nil {
			return err
		}
		for _, row := range added {
			if containsUUID(addedIDs, row.UnitID) {
				row.Added = true
				window = append(window, row)
			}
		}
		return recordCaosEmergency(tx, "emergency.add", now, window, addedIDs, reason)
	})
	return rows, orderIDs, resourceIDs, err
}

// DELETE /api/cup-emergencies/{id} - 緊急（入れ直し）を取り消す（押し間違い）。まだ抽出を始めていない（未割当か待機の）入れ直しだけ。
// 入れ直しで減らした在庫も戻し、レジに頼んだその入れ直しのシールの代理印刷も消す。取り消したら全部の画面に {"type":"cup_emergency_cancelled"} で知らせる（publishCupEmergencyCancelled）。
func (h *CaosHandler) DeleteCupEmergency(c *gin.Context) {
	id, ok := parseUUIDParam(c)
	if !ok {
		return
	}
	orderID, resourceIDs, err := h.cancelEmergency(id)
	h.respond(c, []uuid.UUID{orderID}, err)
	if err == nil {
		publishCupEmergencyCancelled(h.db, h.hub, id)
		h.checkStockAlerts(resourceIDs)
	}
}

// publishCupEmergencyCancelled は入れ直しを取り消したことを、このインスタンスの画面へ配り、ほかのインスタンスへ DB の通知で知らせる。
// 画面は、この知らせを受けたときだけ、その入れ直しの未印刷のシールを消す（注文の一覧から消えたことでは消さない）。
// 知らせを受け損ねた画面はシールを刷ってしまうが、刷るべきシールを刷らないよりよいので、送り直しはしない。
func publishCupEmergencyCancelled(db *gorm.DB, hub *Hub, id uuid.UUID) {
	broadcastCupEmergencyCancelled(hub, id)
	notifyChanged(db, cupEmergencyCancelledChannel, instanceID+" "+id.String())
}

// broadcastCupEmergencyCancelled は入れ直しを取り消したことを、このインスタンスの画面へだけ配る（ほかのインスタンスからの通知でも使う）。
func broadcastCupEmergencyCancelled(hub *Hub, id uuid.UUID) {
	_ = hub.Publish(func() (WSMessage, error) {
		return WSMessage{Type: WSMessageTypeCupEmergencyCancelled, CupEmergencyID: &id}, nil
	})
}

// cancelEmergency は入れ直しを消す。消した入れ直しの注文と、戻した在庫対象の ID を返す。
// 待機の入れ直しはドリッパーの列から抜けるので、CaOS の書き込みと同じく、ドリッパーの advisory lock を取ってから注文の行をロックする。
func (h *CaosHandler) cancelEmergency(id uuid.UUID) (orderID uuid.UUID, resourceIDs []uuid.UUID, err error) {
	now := h.now()
	start, end := caosToday(now)
	err = h.db.Transaction(func(tx *gorm.DB) error {
		// 入れ直しの行だけ（カップの行は id と cup_id が同じ）
		read := func() (caosUnit, error) {
			rows, err := readCaosUnits(tx, "c.id = ? AND c.id <> c.cup_id", id)
			if err == nil && len(rows) == 0 {
				err = conflictErrorf("入れ直しが見つかりません（ほかの端末で取り消したか、注文が編集・削除されたかもしれません）")
			}
			if err != nil {
				return caosUnit{}, err
			}
			return rows[0], nil
		}
		seen, err := read()
		if err != nil {
			return err
		}
		if seen.Dripper != nil {
			if err := lockCaosDrippers(tx, []int{*seen.Dripper}); err != nil {
				return err
			}
		}
		if _, err := lockCaosOrders(tx, []uuid.UUID{seen.OrderID}, nil, start, end); err != nil {
			return err
		}
		// ロックしてから読み直す（ロックしたドリッパーから動いていれば、もう一度押してもらう）
		row, err := read()
		if err != nil {
			return err
		}
		if !ptrEqual(row.Dripper, seen.Dripper) {
			return conflictErrorf("ほかの端末で先に変わりました。もう一度操作してください")
		}
		if row.BrewStartedAt != nil {
			return ruleErrorf("抽出を始めた入れ直しは取り消せません")
		}
		orderID = row.OrderID
		if err := tx.Model(&models.CupEmergencyStockUsage{}).Where("cup_emergency_id = ?", id).
			Pluck("resource_id", &resourceIDs).Error; err != nil {
			return err
		}
		window, err := readCaosLogWindow(tx, []uuid.UUID{id}, nil, start, end)
		if err != nil {
			return err
		}
		reason := ""
		for i := range window {
			if window[i].UnitID == id {
				reason = window[i].EmergencyReason
				window[i].Removed = true
			}
		}
		if err := deleteCupEmergencies(tx, "id = ?", id); err != nil {
			return err
		}
		// レジに頼んだ代理印刷も消す（まだ刷れていなければ、レジは刷らない。label_print.go）
		if err := tx.Delete(&models.LabelPrintRequest{}, "id = ?", id).Error; err != nil {
			return err
		}
		return recordCaosEmergency(tx, "emergency.cancel", now, window, []uuid.UUID{id}, reason)
	})
	return orderID, resourceIDs, err
}

// deleteCupEmergencies は where に合う入れ直しを、入れ直しで減らした在庫ごと消す（外部キーが無いので。models.CupEmergency）。
func deleteCupEmergencies(tx *gorm.DB, where string, args ...any) error {
	if err := tx.Where("cup_emergency_id IN (?)", tx.Model(&models.CupEmergency{}).Select("id").Where(where, args...)).
		Delete(&models.CupEmergencyStockUsage{}).Error; err != nil {
		return err
	}
	return tx.Where(where, args...).Delete(&models.CupEmergency{}).Error
}

// checkStockAlerts は入れ直しで増減した在庫の通知を確かめる（応答を書いてから呼ぶ）。
func (h *CaosHandler) checkStockAlerts(resourceIDs []uuid.UUID) {
	if len(resourceIDs) > 0 {
		go h.inventory.CheckAlerts(resourceIDs)
	}
}
