package handlers

import (
	"net/http"

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
	orderIDs, err := h.addEmergencies(req.OrderCupIds)
	h.respond(c, orderIDs, err)
}

// addEmergencies は cupIDs のカップに入れ直しを 1 つずつ足す。足したカップの注文の ID を返す。
// 今日の注文の、抽出が要るカップだけ。注文の行をロックしてから足す（注文の編集・CaOS の書き込みと同じ順番）。
func (h *CaosHandler) addEmergencies(cupIDs []uuid.UUID) ([]uuid.UUID, error) {
	now := h.now()
	start, end := caosToday(now)
	var orderIDs []uuid.UUID
	err := h.db.Transaction(func(tx *gorm.DB) error {
		orderIDs = nil
		unscoped := func(db *gorm.DB) *gorm.DB { return db.Unscoped() }
		var cups []models.OrderCup
		if err := tx.Preload("Item", unscoped).Preload("Item.ItemType", unscoped).
			Find(&cups, "id IN ?", cupIDs).Error; err != nil {
			return err
		}
		if len(cups) != len(cupIDs) {
			return conflictErrorf("カップが消えました（注文が編集・削除されたかもしれません）")
		}
		var lockIDs []uuid.UUID
		for _, cup := range cups {
			if !cup.Item.ItemType.BrewRequired() {
				return ruleErrorf("抽出の要らないカップ（%s）は入れ直せません", cup.Item.Name)
			}
			lockIDs = append(lockIDs, cup.OrderID)
		}
		orders, err := lockCaosOrders(tx, lockIDs, nil, start, end)
		if err != nil {
			return err
		}
		// ロックしてから、カップがまだあるか（注文の編集で外れていないか）
		rows := make([]models.CupEmergency, 0, len(cups))
		for _, cup := range cups {
			if findOrderCup(orders[cup.OrderID], cup.ID) == nil {
				return conflictErrorf("カップが消えました（注文が編集されたかもしれません）")
			}
			rows = append(rows, models.CupEmergency{OrderCupID: cup.ID, CreatedAt: now})
		}
		if err := tx.Create(&rows).Error; err != nil {
			return err
		}
		for id := range orders {
			orderIDs = append(orderIDs, id)
		}
		return nil
	})
	return orderIDs, err
}
