package handlers

import (
	"database/sql"
	"net/http"
	"strconv"
	"time"

	"cafeore-pos/api/internal/models"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type brewLaneModel struct {
	Dripper   int                     `json:"dripper"`
	Name      string                  `json:"name"`
	Grade     string                  `json:"grade"`
	Estimates map[string]brewEstimate `json:"estimates"`
}

type brewModelResponse struct {
	Version   string                  `json:"version"`
	UpdatedAt time.Time               `json:"updated_at"`
	Standards map[string]brewEstimate `json:"standards"`
	Lanes     []brewLaneModel         `json:"lanes"`
	Active    []models.CaosBrewRecord `json:"active"`
}

// 読むだけの画面にも、同じ集計と開始時の予測を返す。
func (h *CaosHandler) GetCaosBrewModel(c *gin.Context) {
	now := h.now()
	response := brewModelResponse{Version: caosBrewModelVersion, UpdatedAt: now, Standards: map[string]brewEstimate{}, Lanes: []brewLaneModel{}, Active: []models.CaosBrewRecord{}}
	err := h.db.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		samples, err := loadCaosBrewSamples(tx, now)
		if err != nil {
			return err
		}
		for _, kind := range caosBrewKinds {
			response.Standards[kind] = estimateCaosBrew(samples, kind, "", "", now)
		}
		lanes, _, err := loadCaosLanes(tx, caosDayString(now))
		if err != nil {
			return err
		}
		for _, lane := range lanes.Lanes {
			grade := ""
			if lane.Grade != nil {
				grade = *lane.Grade
			}
			model := brewLaneModel{Dripper: lane.Dripper, Name: lane.Name, Grade: grade, Estimates: map[string]brewEstimate{}}
			for _, kind := range caosBrewKinds {
				model.Estimates[kind] = estimateCaosBrew(samples, kind, lane.Name, grade, now)
			}
			response.Lanes = append(response.Lanes, model)
		}
		// 再開前の無効記録も取りうるため、クライアントは開始時刻・種類も照合する。
		start, _ := caosToday(now)
		return tx.Where("started_at >= ? AND finished_at IS NULL", start).
			Where("EXISTS (SELECT 1 FROM " + caosUnits + " c WHERE c.drip_id = caos_brew_records.drip_id AND c.brew_started_at = caos_brew_records.started_at AND c.brew_finished_at IS NULL)").
			Order("started_at DESC, drip_id").Find(&response.Active).Error
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "抽出予測を取得できませんでした"})
		return
	}
	c.JSON(http.StatusOK, response)
}

// 評価・振り返り用。スタッフだけが実測と予測の内訳を読む。
func (h *CaosHandler) GetCaosBrewRecords(c *gin.Context) {
	limit := 100
	offset := 0
	for key, target := range map[string]*int{"limit": &limit, "offset": &offset} {
		if raw, present := c.GetQuery(key); present {
			n, err := strconv.Atoi(raw)
			if err != nil || n < 0 || (key == "limit" && (n < 1 || n > 500)) {
				c.JSON(400, gin.H{"error": "limit は1〜500、offset は0以上です"})
				return
			}
			*target = n
		}
	}
	snapshot := h.now()
	if raw, present := c.GetQuery("snapshot_at"); present {
		parsed, err := time.Parse(time.RFC3339Nano, raw)
		if err != nil || parsed.After(snapshot) {
			c.JSON(400, gin.H{"error": "snapshot_at は現在以前の日時です"})
			return
		}
		snapshot = parsed
	}
	// ページ間で新しい開始が挿入されても、書き出しの重複・欠落を起こさない。
	query := h.db.WithContext(c.Request.Context()).Model(&models.CaosBrewRecord{}).Where("recorded_at <= ?", snapshot)
	if day, present := c.GetQuery("day"); present {
		date, err := time.ParseInLocation(time.DateOnly, day, jst)
		if err != nil {
			c.JSON(400, gin.H{"error": "day は YYYY-MM-DD です"})
			return
		}
		query = query.Where("started_at >= ? AND started_at < ?", date, date.AddDate(0, 0, 1))
	}
	rows := []models.CaosBrewRecord{}
	if err := query.Order("started_at DESC, drip_id").Limit(limit + 1).Offset(offset).Find(&rows).Error; err != nil {
		c.JSON(500, gin.H{"error": "抽出実績を取得できませんでした"})
		return
	}
	hasMore := len(rows) > limit
	if hasMore {
		rows = rows[:limit]
	}
	c.JSON(200, gin.H{"entries": rows, "limit": limit, "offset": offset, "has_more": hasMore, "snapshot_at": snapshot})
}
