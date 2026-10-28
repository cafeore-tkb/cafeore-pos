package handlers

import (
	"math"
	"sort"
	"sync"
	"time"

	"cafeore-pos/api/internal/models"
	"gorm.io/gorm"
)

const caosBrewModelVersion = "brew-v1"
const caosBrewHistoryDays = 7
const caosBrewHistoryLimit = 2000

var caosBrewKinds = []string{"hot1", "hot2", "ice1", "ice2"}

type brewEstimate struct {
	Seconds         float64 `json:"seconds"`
	StandardSeconds float64 `json:"standard_seconds"`
	Coefficient     float64 `json:"coefficient"`
	StandardSamples int     `json:"standard_samples"`
	PersonSamples   int     `json:"person_samples"`
}

func initialBrewSeconds(kind string) float64 {
	if kind == "hot2" || kind == "ice2" {
		return 360
	}
	return 300
}

func brewMedian(values []float64) float64 {
	v := append([]float64(nil), values...)
	sort.Float64s(v)
	n := len(v)
	if n == 0 {
		return 0
	}
	if n%2 == 1 {
		return v[n/2]
	}
	return (v[n/2-1] + v[n/2]) / 2
}

func brewClamp(value, low, high float64) float64 { return math.Max(low, math.Min(high, value)) }

// samples は新しい完了順。基準は直近10件、個人比率は4種類共通で直近20件。
// 既知の個人差を実測から除いて店舗基準を更新し、個人係数は1へ縮小する。
func estimateCaosBrew(samples []models.CaosBrewRecord, kind, name, grade string, before time.Time) brewEstimate {
	base := []float64{}
	ratios := []float64{}
	reference := initialBrewSeconds(kind)
	for _, sample := range samples {
		if sample.FinishedAt == nil || !sample.FinishedAt.Before(before) || sample.FinishedAt.Before(before.AddDate(0, 0, -caosBrewHistoryDays)) || sample.ExcludedReason != "" || sample.ActualSeconds == nil {
			continue
		}
		actual := *sample.ActualSeconds
		if math.IsNaN(actual) || math.IsInf(actual, 0) || actual < 60 || actual > 900 {
			continue
		}
		if sample.Kind == kind && len(base) < 10 {
			if len(base) == 0 && sample.StandardSeconds >= 60 && sample.StandardSeconds <= 900 {
				reference = sample.StandardSeconds
			}
			coefficient := sample.Coefficient
			if coefficient <= 0 || math.IsNaN(coefficient) || math.IsInf(coefficient, 0) {
				coefficient = 1
			}
			base = append(base, actual/coefficient)
		}
		if name != "" && grade != "" && sample.Name == name && sample.Grade == grade && sample.PersonExcludedReason == "" && sample.StandardSeconds > 0 && len(ratios) < 20 {
			ratios = append(ratios, actual/sample.StandardSeconds)
		}
	}
	standard := initialBrewSeconds(kind)
	if len(base) > 0 {
		// 1件目から反映するが、1回の更新で基準が極端に飛ばないようにする。
		standard = brewClamp(brewClamp(brewMedian(base), reference*.8, reference*1.2), 60, 900)
	}
	coefficient := 1.0
	if len(ratios) > 0 {
		weight := float64(len(ratios)) / float64(len(ratios)+5)
		coefficient = brewClamp(1+weight*(brewMedian(ratios)-1), 0.7, 1.3)
	}
	return brewEstimate{Seconds: math.Round(brewClamp(standard*coefficient, 60, 900)), StandardSeconds: standard, Coefficient: coefficient, StandardSamples: len(base), PersonSamples: len(ratios)}
}

func loadCaosBrewSamples(db *gorm.DB, before time.Time) ([]models.CaosBrewRecord, error) {
	rows := []models.CaosBrewRecord{}
	err := db.Where("finished_at < ? AND finished_at >= ? AND excluded_reason = '' AND actual_seconds IS NOT NULL", before, before.AddDate(0, 0, -caosBrewHistoryDays)).Order("finished_at DESC, drip_id, started_at").Limit(caosBrewHistoryLimit).Find(&rows).Error
	return rows, err
}

// 閲覧端末が同時に読んでも履歴のDB読み込みは3秒に1回にまとめる。
// 行は読み取り専用。開始時予測の保存はこのキャッシュを使わない。
type caosBrewSampleCache struct {
	mu       sync.Mutex
	loadedAt time.Time
	rows     []models.CaosBrewRecord
}

func (cache *caosBrewSampleCache) load(now time.Time, read func() ([]models.CaosBrewRecord, error)) ([]models.CaosBrewRecord, error) {
	cache.mu.Lock()
	defer cache.mu.Unlock()
	if !cache.loadedAt.IsZero() && !now.Before(cache.loadedAt) && now.Sub(cache.loadedAt) < 3*time.Second {
		return cache.rows, nil
	}
	rows, err := read()
	if err != nil {
		return nil, err
	}
	cache.rows, cache.loadedAt = rows, now
	return rows, nil
}
