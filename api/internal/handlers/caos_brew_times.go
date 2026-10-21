package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"cafeore-pos/api/internal/models"
)

const (
	// 杯数ごとの抽出時間の中央値に使う、終えたのが新しいカードの数。担当者や時間帯で速さが変わるので、新しいものだけを使う
	caosBrewTimeCards = 30
	// 中央値を返すのに要る、終えたカードの数。押し間違えてすぐ「次へ」を押したカードが 1〜2 枚あっても、予定の時刻を狂わせないように
	caosBrewTimeMinCards = 5
)

// GET /api/caos/brew-times - 「次へ」で終えたカード（同じ drip_id のカップと淹れ直し。caosUnits）の抽出時間を、杯数ごとに、
// 終えたのが新しいカードから caosBrewTimeCards 枚までの中央値で返す（日はまたぐ）。CaOS の画面が予定の時刻に使う。
// 終えたカードが caosBrewTimeMinCards 枚に足りない杯数は返さない（画面は初めの値を使う）。
func (h *CaosHandler) GetCaosBrewTimes(c *gin.Context) {
	times := []models.CaosBrewTime{}
	err := h.db.Raw(`
		WITH cards AS (
			SELECT COUNT(*) AS cups, MIN(brew_started_at) AS started_at, MAX(brew_finished_at) AS finished_at
			FROM `+caosUnits+` c
			WHERE drip_id IS NOT NULL AND brew_started_at IS NOT NULL AND brew_finished_at IS NOT NULL
			GROUP BY drip_id
		), recent AS (
			SELECT cups, EXTRACT(EPOCH FROM finished_at - started_at) AS sec,
				ROW_NUMBER() OVER (PARTITION BY cups ORDER BY finished_at DESC) AS n
			FROM cards
		)
		SELECT cups, ROUND((percentile_cont(0.5) WITHIN GROUP (ORDER BY sec))::numeric)::int AS sec, COUNT(*) AS samples
		FROM recent WHERE n <= ? GROUP BY cups HAVING COUNT(*) >= ? ORDER BY cups`,
		caosBrewTimeCards, caosBrewTimeMinCards).Scan(&times).Error
	if respondError(c, err) {
		return
	}
	c.JSON(http.StatusOK, times)
}
