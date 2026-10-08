package handlers

import (
	"log"
	"net/http"

	"github.com/gin-gonic/gin"

	"cafeore-pos/api/internal/caos"
	"cafeore-pos/api/internal/models"
)

// 本番の抽出時間の集計（Issue #803）。読み取りだけで、盤面はロックしない。
// 集計の決まり（まとめ方・係数・担当者の出し方）は caos パッケージの brew_stats.go（BuildBrewStats）。ここは表を読んで渡すだけ。

// GET /api/caos/brew-stats?day=YYYY-MM-DD - 抽出時間の集計（day を省くと全部の日）
func (h *CaosHandler) BrewStats(c *gin.Context) {
	day := c.Query("day")
	if day != "" {
		if _, err := caos.ParseDay(day); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
	}
	stats, err := h.store.BrewStats(day)
	if err != nil {
		log.Printf("caos: failed to read the brew stats: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, stats)
}

// BrewStats は抽出が終わったカード（caos_drips）と、列の担当者の交代の記録（caos_ops）を読んで集計する。day が空なら全部の日。
func (s *CaosStore) BrewStats(day string) (caos.BrewStats, error) {
	drips := s.db.Where("status = ? AND started_at IS NOT NULL AND finished_at IS NOT NULL", caos.StatusDone)
	// 担当者を替えた操作だけ（カードの中身の before・after は要らないので読まない）
	ops := s.db.Select("day", "created_at", "undone_at", "lanes_before", "lanes_after").Where("lanes_after <> '[]'::jsonb")
	if day != "" {
		drips = drips.Where("day = ?", day)
		ops = ops.Where("day = ?", day)
	}
	var dripRows []models.CaosDripRow
	if err := drips.Order("day, started_at, id").Find(&dripRows).Error; err != nil {
		return caos.BrewStats{}, err
	}
	var opRows []models.CaosOpRow
	if err := ops.Order("day, created_at").Find(&opRows).Error; err != nil {
		return caos.BrewStats{}, err
	}

	var days []caos.BrewDay
	index := map[string]int{}
	of := func(d string) *caos.BrewDay {
		d = dateOnly(d)
		i, ok := index[d]
		if !ok {
			i = len(days)
			index[d] = i
			days = append(days, caos.BrewDay{Day: d})
		}
		return &days[i]
	}
	for _, r := range dripRows {
		bd := of(r.Day)
		bd.Drips = append(bd.Drips, fromCaosDripRow(r))
	}
	for _, r := range opRows {
		bd := of(r.Day)
		bd.LaneChanges = append(bd.LaneChanges, caos.LaneChangesOfOp(r.CreatedAt, r.UndoneAt, r.LanesBefore, r.LanesAfter)...)
	}
	return caos.BuildBrewStats(days), nil
}

// dateOnly は date の列を string で読んだ値（ドライバーによって "2026-11-01T00:00:00Z" になる）を YYYY-MM-DD にそろえる。
func dateOnly(s string) string {
	if len(s) > len("2006-01-02") {
		return s[:len("2006-01-02")]
	}
	return s
}
