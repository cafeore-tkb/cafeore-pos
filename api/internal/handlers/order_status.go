package handlers

import (
	"errors"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"cafeore-pos/api/internal/models"
)

// 注文の ready_at / served_at と、カップ（注文明細）ごとの ready_at / served_at をそろえる。
//
//   - 注文単位で付けたら、まだ付いていないカップにも同じ時刻を付ける。
//   - 注文単位で外すときは、その操作で付いた（注文と同じ時刻の）カップだけ外す。
//     先に個別で提供したカップは残るので、提供の取消で一部提供の状態に戻る。
//   - カップ単位の操作では、全カップがそろったら注文にも付け、そろわなくなったら外す。

var errOrderMenuNotFound = errors.New("order menu not found")

func sameTime(a, b *time.Time) bool {
	return a != nil && b != nil && a.Equal(*b)
}

// 全カップに時刻が付いていれば一番遅い時刻を、1つでも欠けていれば nil を返す
func allCupsAt(lines []models.OrderMenu, at func(*models.OrderMenu) *time.Time) *time.Time {
	var latest *time.Time
	for i := range lines {
		t := at(&lines[i])
		if t == nil {
			return nil
		}
		if latest == nil || t.After(*latest) {
			latest = t
		}
	}
	if latest == nil {
		return nil
	}
	v := *latest
	return &v
}

func cupReadyAt(line *models.OrderMenu) *time.Time  { return line.ReadyAt }
func cupServedAt(line *models.OrderMenu) *time.Time { return line.ServedAt }

// 注文の状態をカップの状態から決め直す。カップの無い注文はそのままにする。
func syncOrderWithCups(order *models.Order) {
	if len(order.OrderMenus) == 0 {
		return
	}
	order.ReadyAt = allCupsAt(order.OrderMenus, cupReadyAt)
	order.ServedAt = allCupsAt(order.OrderMenus, cupServedAt)
}

// PATCH /api/orders/:id/ready の切り替え
func toggleOrderReady(order *models.Order, now time.Time) {
	lines := order.OrderMenus
	if order.ReadyAt == nil {
		order.ReadyAt = &now
		for i := range lines {
			if lines[i].ReadyAt == nil {
				lines[i].ReadyAt = &now
			}
		}
		return
	}
	prev := order.ReadyAt
	for i := range lines {
		if lines[i].ServedAt == nil && sameTime(lines[i].ReadyAt, prev) {
			lines[i].ReadyAt = nil
		}
	}
	// 時刻の一致するカップが無くても、呼び出しは必ず取り消せるようにする
	if allCupsAt(lines, cupReadyAt) != nil {
		for i := range lines {
			if lines[i].ServedAt == nil {
				lines[i].ReadyAt = nil
			}
		}
	}
	order.ReadyAt = nil
	syncOrderWithCups(order)
}

// PATCH /api/orders/:id/served の切り替え
func toggleOrderServed(order *models.Order, now time.Time) {
	lines := order.OrderMenus
	if order.ServedAt == nil {
		// 従来どおり注文の ready_at も提供時刻で付け直す
		order.ServedAt, order.ReadyAt = &now, &now
		for i := range lines {
			if lines[i].ServedAt == nil {
				lines[i].ServedAt = &now
			}
			if lines[i].ReadyAt == nil {
				lines[i].ReadyAt = &now
			}
		}
		return
	}
	prev := order.ServedAt
	unserve := func(line *models.OrderMenu) {
		// 提供と同時に付いた ready_at だけ外す
		if sameTime(line.ReadyAt, line.ServedAt) {
			line.ReadyAt = nil
		}
		line.ServedAt = nil
	}
	for i := range lines {
		if sameTime(lines[i].ServedAt, prev) {
			unserve(&lines[i])
		}
	}
	// 時刻の一致するカップが無くても、提供は必ず取り消せるようにする
	if allCupsAt(lines, cupServedAt) != nil {
		for i := range lines {
			unserve(&lines[i])
		}
	}
	order.ServedAt, order.ReadyAt = nil, nil
	syncOrderWithCups(order)
}

func findOrderMenu(order *models.Order, orderMenuID uuid.UUID) *models.OrderMenu {
	for i := range order.OrderMenus {
		if order.OrderMenus[i].ID == orderMenuID {
			return &order.OrderMenus[i]
		}
	}
	return nil
}

// PATCH /api/orders/:id/menus/:orderMenuId/ready の切り替え
func toggleCupReady(order *models.Order, line *models.OrderMenu, now time.Time) {
	if line.ReadyAt == nil {
		line.ReadyAt = &now
	} else {
		// 準備完了でないカップは提供済みにもできない
		line.ReadyAt, line.ServedAt = nil, nil
	}
	syncOrderWithCups(order)
}

// PATCH /api/orders/:id/menus/:orderMenuId/served の切り替え
func toggleCupServed(order *models.Order, line *models.OrderMenu, now time.Time) {
	if line.ServedAt == nil {
		line.ServedAt = &now
		if line.ReadyAt == nil {
			line.ReadyAt = &now
		}
	} else {
		if sameTime(line.ReadyAt, line.ServedAt) {
			line.ReadyAt = nil
		}
		line.ServedAt = nil
	}
	syncOrderWithCups(order)
}

func saveOrderStatus(tx *gorm.DB, order *models.Order) error {
	if err := tx.Model(&models.Order{}).Where("id = ?", order.ID).Updates(map[string]any{
		"ready_at":  order.ReadyAt,
		"served_at": order.ServedAt,
	}).Error; err != nil {
		return err
	}
	for _, line := range order.OrderMenus {
		if err := tx.Model(&models.OrderMenu{}).Where("id = ?", line.ID).Updates(map[string]any{
			"ready_at":  line.ReadyAt,
			"served_at": line.ServedAt,
		}).Error; err != nil {
			return err
		}
	}
	return nil
}

// 注文とカップの状態を1トランザクションで変更し、変更後の注文を返して配信する。
// 同じ注文への操作が重なっても片方の変更が消えないよう、注文の行をロックしてから読む。
func (h *OrderHandler) changeOrderStatus(c *gin.Context, change func(order *models.Order, now time.Time) error) {
	orderID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid ID format"})
		return
	}

	err = h.db.Transaction(func(tx *gorm.DB) error {
		var order models.Order
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Preload("OrderMenus").
			First(&order, "id = ?", orderID).Error; err != nil {
			return err
		}
		// DB に保存される精度にそろえておくと、保存前後で時刻を比べられる
		if err := change(&order, time.Now().Truncate(time.Microsecond)); err != nil {
			return err
		}
		return saveOrderStatus(tx, &order)
	})
	switch {
	case errors.Is(err, gorm.ErrRecordNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": "Order not found"})
		return
	case errors.Is(err, errOrderMenuNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": "Order menu not found"})
		return
	case err != nil:
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	var order models.Order
	if err := preloadOrder(h.db).First(&order, "id = ?", orderID).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, toOrderResponse(&order))
	h.broadcastOrders()
}

// カップ単位の操作。対象のカップがこの注文のものでなければ 404 にする。
func (h *OrderHandler) changeCupStatus(c *gin.Context, toggle func(order *models.Order, line *models.OrderMenu, now time.Time)) {
	orderMenuID, err := uuid.Parse(c.Param("orderMenuId"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid order menu ID format"})
		return
	}
	h.changeOrderStatus(c, func(order *models.Order, now time.Time) error {
		line := findOrderMenu(order, orderMenuID)
		if line == nil {
			return errOrderMenuNotFound
		}
		toggle(order, line, now)
		return nil
	})
}

// PATCH /api/orders/:id/ready - オーダーを準備完了にする
func (h *OrderHandler) MarkOrderReady(c *gin.Context) {
	h.changeOrderStatus(c, func(order *models.Order, now time.Time) error {
		toggleOrderReady(order, now)
		return nil
	})
}

// PATCH /api/orders/:id/served - オーダーを提供済みにする
func (h *OrderHandler) MarkOrderServed(c *gin.Context) {
	h.changeOrderStatus(c, func(order *models.Order, now time.Time) error {
		toggleOrderServed(order, now)
		return nil
	})
}

// PATCH /api/orders/:id/menus/:orderMenuId/ready - カップを準備完了にする
func (h *OrderHandler) MarkOrderMenuReady(c *gin.Context) {
	h.changeCupStatus(c, toggleCupReady)
}

// PATCH /api/orders/:id/menus/:orderMenuId/served - カップを提供済みにする
func (h *OrderHandler) MarkOrderMenuServed(c *gin.Context) {
	h.changeCupStatus(c, toggleCupServed)
}
