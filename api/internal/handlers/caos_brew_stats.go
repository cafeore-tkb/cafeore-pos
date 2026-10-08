package handlers

import (
	"log"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"

	"cafeore-pos/api/internal/caosstats"
	"cafeore-pos/api/internal/models"
)

// 本番の抽出時間の集計（Issue #803）。読み取りだけで、盤面はロックしない。
// 集計の決まり（まとめ方・係数・担当者の出し方）は caosstats パッケージ（Build）。ここは表を GORM で読んで渡すだけ。

// GET /api/caos/brew-stats?day=YYYY-MM-DD - 抽出時間の集計（day を省くと全部の日）
func (h *CaosHandler) GetCaosBrewStats(c *gin.Context) {
	day := c.Query("day")
	var from, to *time.Time
	if day != "" {
		start, end, err := caosstats.DayRange(day)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "day は YYYY-MM-DD（日本時間の日付）です"})
			return
		}
		from, to = &start, &end
	}
	stats, err := readCaosBrewStats(h.db, from, to)
	if err != nil {
		log.Printf("caos: failed to read the brew stats: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, stats)
}

// readCaosBrewStats は CaOS のカードに入ったカップ（drip_id か emergency_drip_id のあるカップ）と、その日の担当者を読んで集計する。
// from・to があれば、その間に作った注文だけ（CaOS の盤面の「今日」と同じく、注文を作った日で区切る）。
func readCaosBrewStats(db *gorm.DB, from, to *time.Time) (caosstats.BrewStats, error) {
	var rows []struct {
		CreatedAt       time.Time
		DripID          *uuid.UUID
		Dripper         *int
		BrewStartedAt   *time.Time
		BrewFinishedAt  *time.Time
		EmergencyAt     *time.Time
		EmergencyDripID *uuid.UUID
	}
	q := db.Model(&models.OrderCup{}).
		Select("orders.created_at, order_cups.drip_id, order_cups.dripper, order_cups.brew_started_at, order_cups.brew_finished_at, " +
			"order_cups.emergency_at, order_cups.emergency_drip_id").
		Joins("JOIN orders ON orders.id = order_cups.order_id").
		Where("order_cups.drip_id IS NOT NULL OR order_cups.emergency_drip_id IS NOT NULL")
	lanes := db.Model(&models.CaosLaneRow{}).Select("day", "dripper", "name", "updated_at")
	if from != nil && to != nil {
		q = q.Where("orders.created_at >= ? AND orders.created_at < ?", *from, *to)
		lanes = lanes.Where("day = ?", caosstats.Day(*from))
	}
	if err := q.Order("orders.created_at, order_cups.position").Scan(&rows).Error; err != nil {
		return caosstats.BrewStats{}, err
	}
	var laneRows []models.CaosLaneRow
	if err := lanes.Find(&laneRows).Error; err != nil {
		return caosstats.BrewStats{}, err
	}

	cups := make([]caosstats.Cup, len(rows))
	for i, r := range rows {
		cups[i] = caosstats.Cup{
			Day: caosstats.Day(r.CreatedAt), DripID: r.DripID, Dripper: r.Dripper,
			BrewStartedAt: r.BrewStartedAt, BrewFinishedAt: r.BrewFinishedAt,
			EmergencyAt: r.EmergencyAt, EmergencyDripID: r.EmergencyDripID,
		}
	}
	lanesIn := make([]caosstats.Lane, len(laneRows))
	for i, l := range laneRows {
		lanesIn[i] = caosstats.Lane{Day: dateOnly(l.Day), Dripper: l.Dripper, Name: l.Name, UpdatedAt: l.UpdatedAt}
	}
	return caosstats.Build(cups, lanesIn), nil
}

// dateOnly は date の列を string で読んだ値（ドライバーによって "2026-11-01T00:00:00Z" になる）を YYYY-MM-DD にそろえる。
func dateOnly(s string) string {
	if len(s) > len(time.DateOnly) {
		return s[:len(time.DateOnly)]
	}
	return s
}
