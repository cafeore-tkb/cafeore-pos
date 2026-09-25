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

// 注文の ready_at / served_at と、カップ（1杯）ごとの ready_at / served_at をそろえる。
//
//   - 注文単位で付けたら、まだ付いていないカップにも同じ時刻を付ける。
//   - 注文単位で外すときは、その操作で付いた（注文と同じ時刻の）カップだけ外す。
//     先に個別で提供したカップは残るので、提供の取消で一部提供の状態に戻る。
//   - カップ単位の操作では、全カップがそろったら注文にも付け、そろわなくなったら外す。
//
// カップが無い注文（グッズだけの注文）は、注文単位の状態だけを持つ。

var errOrderCupNotFound = errors.New("order cup not found")

func sameTime(a, b *time.Time) bool {
	return a != nil && b != nil && a.Equal(*b)
}

// 全カップに時刻が付いていれば一番遅い時刻を、1つでも欠けていれば nil を返す
func allCupsAt(cups []models.OrderCup, at func(*models.OrderCup) *time.Time) *time.Time {
	var latest *time.Time
	for i := range cups {
		t := at(&cups[i])
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

func cupReadyAt(cup *models.OrderCup) *time.Time  { return cup.ReadyAt }
func cupServedAt(cup *models.OrderCup) *time.Time { return cup.ServedAt }

// 注文の状態をカップの状態から決め直す。カップの無い注文はそのままにする。
func syncOrderWithCups(order *models.Order) {
	if len(order.OrderCups) == 0 {
		return
	}
	order.ReadyAt = allCupsAt(order.OrderCups, cupReadyAt)
	order.ServedAt = allCupsAt(order.OrderCups, cupServedAt)
}

// PATCH /api/orders/:id/ready の切り替え
func toggleOrderReady(order *models.Order, now time.Time) {
	cups := order.OrderCups
	if order.ReadyAt == nil {
		order.ReadyAt = &now
		for i := range cups {
			if cups[i].ReadyAt == nil {
				cups[i].ReadyAt = &now
			}
		}
		return
	}
	prev := order.ReadyAt
	for i := range cups {
		if cups[i].ServedAt == nil && sameTime(cups[i].ReadyAt, prev) {
			cups[i].ReadyAt = nil
		}
	}
	// 時刻の一致するカップが無くても、呼び出しは必ず取り消せるようにする
	if allCupsAt(cups, cupReadyAt) != nil {
		for i := range cups {
			if cups[i].ServedAt == nil {
				cups[i].ReadyAt = nil
			}
		}
	}
	order.ReadyAt = nil
	syncOrderWithCups(order)
}

// PATCH /api/orders/:id/served の切り替え
func toggleOrderServed(order *models.Order, now time.Time) {
	cups := order.OrderCups
	if order.ServedAt == nil {
		// 従来どおり注文の ready_at も提供時刻で付け直す
		order.ServedAt, order.ReadyAt = &now, &now
		for i := range cups {
			if cups[i].ServedAt == nil {
				cups[i].ServedAt = &now
			}
			if cups[i].ReadyAt == nil {
				cups[i].ReadyAt = &now
			}
		}
		return
	}
	prev := order.ServedAt
	unserve := func(cup *models.OrderCup) {
		// 提供と同時に付いた ready_at だけ外す
		if sameTime(cup.ReadyAt, cup.ServedAt) {
			cup.ReadyAt = nil
		}
		cup.ServedAt = nil
	}
	for i := range cups {
		if sameTime(cups[i].ServedAt, prev) {
			unserve(&cups[i])
		}
	}
	// 時刻の一致するカップが無くても、提供は必ず取り消せるようにする
	if allCupsAt(cups, cupServedAt) != nil {
		for i := range cups {
			unserve(&cups[i])
		}
	}
	order.ServedAt, order.ReadyAt = nil, nil
	syncOrderWithCups(order)
}

func findOrderCup(order *models.Order, cupID uuid.UUID) *models.OrderCup {
	for i := range order.OrderCups {
		if order.OrderCups[i].ID == cupID {
			return &order.OrderCups[i]
		}
	}
	return nil
}

// PATCH /api/orders/:id/cups/:cupId/ready の切り替え
func toggleCupReady(order *models.Order, cup *models.OrderCup, now time.Time) {
	if cup.ReadyAt == nil {
		cup.ReadyAt = &now
	} else {
		// 準備完了でないカップは提供済みにもできない
		cup.ReadyAt, cup.ServedAt = nil, nil
	}
	syncOrderWithCups(order)
}

// PATCH /api/orders/:id/cups/:cupId/served の切り替え
func toggleCupServed(order *models.Order, cup *models.OrderCup, now time.Time) {
	if cup.ServedAt == nil {
		cup.ServedAt = &now
		if cup.ReadyAt == nil {
			cup.ReadyAt = &now
		}
	} else {
		if sameTime(cup.ReadyAt, cup.ServedAt) {
			cup.ReadyAt = nil
		}
		cup.ServedAt = nil
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
	for _, cup := range order.OrderCups {
		if err := tx.Model(&models.OrderCup{}).Where("id = ?", cup.ID).Updates(map[string]any{
			"ready_at":  cup.ReadyAt,
			"served_at": cup.ServedAt,
		}).Error; err != nil {
			return err
		}
	}
	return nil
}

// 注文の行をロックしてから、明細とカップを読む。
// 同じ注文への操作（状態の変更や編集）が重なっても、片方の変更が消えないようにする。
func lockOrder(tx *gorm.DB, orderID uuid.UUID) (models.Order, error) {
	var order models.Order
	err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Preload("OrderMenus").
		Preload("OrderCups", func(db *gorm.DB) *gorm.DB { return db.Order("order_cups.position") }).
		First(&order, "id = ?", orderID).Error
	return order, err
}

// 注文とカップの状態を1トランザクションで変更し、変更後の注文を返して配信する。
func (h *OrderHandler) changeOrderStatus(c *gin.Context, change func(order *models.Order, now time.Time) error) {
	orderID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid ID format"})
		return
	}

	err = h.db.Transaction(func(tx *gorm.DB) error {
		order, err := lockOrder(tx, orderID)
		if err != nil {
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
	case errors.Is(err, errOrderCupNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": "Order cup not found"})
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
// カップの無い注文（グッズだけの注文）は、どのカップIDでも 404 になる。
func (h *OrderHandler) changeCupStatus(c *gin.Context, toggle func(order *models.Order, cup *models.OrderCup, now time.Time)) {
	cupID, err := uuid.Parse(c.Param("cupId"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid cup ID format"})
		return
	}
	h.changeOrderStatus(c, func(order *models.Order, now time.Time) error {
		cup := findOrderCup(order, cupID)
		if cup == nil {
			return errOrderCupNotFound
		}
		toggle(order, cup, now)
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

// PATCH /api/orders/:id/cups/:cupId/ready - カップを準備完了にする
func (h *OrderHandler) MarkOrderCupReady(c *gin.Context) {
	h.changeCupStatus(c, toggleCupReady)
}

// PATCH /api/orders/:id/cups/:cupId/served - カップを提供済みにする
func (h *OrderHandler) MarkOrderCupServed(c *gin.Context) {
	h.changeCupStatus(c, toggleCupServed)
}
