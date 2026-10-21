package handlers

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"cafeore-pos/api/internal/models"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// 型とGinルーティングを別パッケージへ生成するため、ルーティング側にもパラメーター型を公開する。
type GetCaosLogsParams = models.GetCaosLogsParams

// CreateCaosLogs 保存の確認を返せなかった場合も、同じキーを再送すれば1行だけになる。
func (h *CaosHandler) CreateCaosLogs(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16*1024*1024)
	var req models.CaosLogBatch
	if err := c.ShouldBindJSON(&req); err != nil {
		var tooLarge *http.MaxBytesError
		code := http.StatusBadRequest
		if errors.As(err, &tooLarge) {
			code = http.StatusRequestEntityTooLarge
		}
		c.JSON(code, gin.H{"error": "ログの形式またはサイズが不正です"})
		return
	}
	if len(req.Entries) == 0 || len(req.Entries) > 100 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "entries は1〜100件です"})
		return
	}
	now := h.now()
	rows := make([]models.CaosClientLog, 0, len(req.Entries))
	for _, entry := range req.Entries {
		if entry.TabId == uuid.Nil || entry.Sequence < 1 || entry.At.IsZero() || len(entry.Event) > 128 || strings.TrimSpace(entry.Event) == "" || entry.Details == nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "ログの項目が不正です"})
			return
		}
		details, err := models.EncodeCaosClientLogDetails(entry.Details)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "details が不正です"})
			return
		}
		rows = append(rows, models.CaosClientLog{TabID: entry.TabId, Sequence: entry.Sequence, At: entry.At, ReceivedAt: now, Event: entry.Event, Details: details})
	}
	if err := h.db.WithContext(c.Request.Context()).Clauses(clause.OnConflict{DoNothing: true}).Create(&rows).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ログを保存できませんでした"})
		return
	}
	c.Status(http.StatusNoContent)
}

// GetCaosLogs は保存済みログを新しい順に返す。limit/offset と端末・イベントの絞り込みを使える。
func (h *CaosHandler) GetCaosLogs(c *gin.Context) {
	limit, offset := 100, 0
	for name, value := range map[string]*int{"limit": &limit, "offset": &offset} {
		if raw, present := c.GetQuery(name); present {
			parsed, err := strconv.Atoi(raw)
			if err != nil || parsed < 0 || (name == "limit" && (parsed < 1 || parsed > 1000)) {
				c.JSON(http.StatusBadRequest, gin.H{"error": "limit は1〜1000、offset は0以上の整数です"})
				return
			}
			*value = parsed
		}
	}
	query := h.db.WithContext(c.Request.Context()).Model(&models.CaosClientLog{})
	if raw, present := c.GetQuery("tab_id"); present {
		id, err := uuid.Parse(raw)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "tab_id はUUIDです"})
			return
		}
		query = query.Where("tab_id = ?", id)
	}
	if event, present := c.GetQuery("event"); present {
		query = query.Where("event = ?", event)
	}
	rows := []models.CaosClientLog{}
	if err := query.Order("at DESC, tab_id, sequence DESC").Limit(limit + 1).Offset(offset).Find(&rows).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ログを取得できませんでした"})
		return
	}
	hasMore := len(rows) > limit
	if hasMore {
		rows = rows[:limit]
	}
	c.JSON(http.StatusOK, gin.H{"entries": rows, "limit": limit, "offset": offset, "hasMore": hasMore})
}

// ready前のCaOS対象cupと、操作対象cupを同じSQLスナップショットで取得する。
// 同時間窓は未割当・待機・抽出中・抽出完了を含み、readyになった杯は除く。
// 淹れ直しは元のcupのreadyとは独立して動くため、履歴には含めるが窓には元cupのreadyを使う。
func readCaosLogWindow(tx *gorm.DB, affected, dripIDs []uuid.UUID, start, end time.Time) ([]models.CaosOperationCup, error) {
	var rows []models.CaosOperationCup
	err := tx.Raw(`SELECT c.id AS unit_id, c.cup_id, c.order_id, o.order_id AS order_no,
   o.created_at AS order_created_at, oc.ready_at, COALESCE(e.reason, '') AS emergency_reason,
   (oc.ready_at IS NULL AND it.makes_cup AND it.needs_brew) AS in_window,
   c.dripper AS before_dripper, c.dripper_position AS before_dripper_position, c.drip_id AS before_drip_id,
   c.brew_started_at AS before_brew_started_at, c.brew_finished_at AS before_brew_finished_at
  FROM `+caosUnits+` c
  JOIN orders o ON o.id = c.order_id
  JOIN order_cups oc ON oc.id = c.cup_id
  LEFT JOIN cup_emergencies e ON e.id = c.id
  JOIN items i ON i.id = c.item_id
  JOIN item_types it ON it.id = i.item_type_id
  WHERE o.created_at >= ? AND o.created_at < ?
    AND ((oc.ready_at IS NULL AND it.makes_cup AND it.needs_brew) OR c.id IN ? OR c.drip_id IN ?)
  ORDER BY c.id`, start, end, affected, dripIDs).Scan(&rows).Error
	return rows, err
}

// recordCaosOperation は盤面を更新した tx の中でだけ呼ぶ。失敗・rollback は記録しない。
// merged は「統合元のunit → 統合先のunit」。向きは明示情報を優先し、古い画面はwritesから推定する。
func recordCaosOperation(tx *gorm.DB, kind string, pressed, now time.Time, press *models.CaosPress,
	before []models.CaosOperationCup, affected []uuid.UUID, merged map[uuid.UUID]uuid.UUID, details ...json.RawMessage) error {
	after, err := readCaosUnits(tx, "c.id IN ?", affected)
	if err != nil {
		return err
	}
	byID := map[uuid.UUID]caosUnit{}
	for _, cup := range after {
		byID[cup.ID] = cup
	}
	rowsByID := map[uuid.UUID]*models.CaosOperationCup{}
	for i := range before {
		rowsByID[before[i].UnitID] = &before[i]
	}
	operation := models.CaosOperation{ID: uuid.New(), Kind: kind, OccurredAt: pressed, RecordedAt: now, ContextAt: now}
	if len(details) > 0 {
		operation.Details = details[0]
	}
	if press != nil {
		operation.ClientPressedAt = &press.At
		operation.ClientSentAt = &press.SentAt
	}
	for i := range before {
		row := &before[i]
		row.OperationID = operation.ID
		row.Changed = row.Added || row.Removed
		row.AfterDripper, row.AfterDripperPosition, row.AfterDripID = row.BeforeDripper, row.BeforeDripperPosition, row.BeforeDripID
		row.AfterBrewStartedAt, row.AfterBrewFinishedAt = row.BeforeBrewStartedAt, row.BeforeBrewFinishedAt
		if row.Removed {
			row.AfterDripper, row.AfterDripperPosition, row.AfterDripID = nil, nil, nil
			row.AfterBrewStartedAt, row.AfterBrewFinishedAt = nil, nil
			continue
		}
		if cup, ok := byID[row.UnitID]; ok {
			row.AfterDripper, row.AfterDripperPosition, row.AfterDripID = cup.Dripper, cup.DripperPosition, cup.DripID
			row.AfterBrewStartedAt, row.AfterBrewFinishedAt = cup.BrewStartedAt, cup.BrewFinishedAt
			row.Changed = row.Added || row.Removed || !ptrEqual(row.BeforeDripper, cup.Dripper) || !ptrEqual(row.BeforeDripperPosition, cup.DripperPosition) ||
				!ptrEqual(row.BeforeDripID, cup.DripID) || !timeEqual(row.BeforeBrewStartedAt, cup.BrewStartedAt) || !timeEqual(row.BeforeBrewFinishedAt, cup.BrewFinishedAt)
			if cup.Dripper != nil && !ptrEqual(row.BeforeDripper, cup.Dripper) {
				row.AssignedAt = &pressed
			}
		}
	}
	for sourceID, targetID := range merged {
		source, target := rowsByID[sourceID], rowsByID[targetID]
		if source == nil || target == nil || sourceID == targetID || source.AfterDripID == nil || !ptrEqual(source.AfterDripID, target.AfterDripID) {
			// 旧画面では更新前の状態から統合先を推定するため、
			// 同時に相手が移動する操作などでは外れる。盤面更新を妨げず、
			// この組の統合情報だけを省いて前後の状態は記録する。
			continue
		}
		source.MergedAt, target.MergedAt = &pressed, &pressed
		source.MergeTargetUnitID = &target.UnitID
		source.MergeTargetCupID = &target.CupID
		source.MergeTargetOrderID = &target.OrderID
	}
	if err := tx.Create(&operation).Error; err != nil {
		return err
	}
	if len(before) == 0 {
		return nil
	}
	return tx.CreateInBatches(&before, 100).Error
}

// 現行画面は merge_into を送る。古い画面では同じdrip_idへ入る別の書き込み/既存の杯を相手とする。
func caosLogMerges(writes []models.CaosCupsWrite, before []models.CaosOperationCup) map[uuid.UUID]uuid.UUID {
	result := map[uuid.UUID]uuid.UUID{}
	for wi, w := range writes {
		if w.After.DripId == nil {
			continue
		}
		var target *uuid.UUID
		if w.MergeInto != nil {
			target = w.MergeInto
		} else {
			for _, row := range before {
				if row.BeforeDripID != nil && *row.BeforeDripID == *w.After.DripId && !containsUUID(w.CupIds, row.UnitID) {
					target = &row.UnitID
					break
				}
			}
			if target == nil {
				for j := wi + 1; j < len(writes); j++ {
					other := writes[j]
					if ptrEqual(w.After.DripId, other.After.DripId) && len(other.CupIds) > 0 {
						target = &other.CupIds[0]
						break
					}
				}
			}
		}
		if target == nil {
			continue
		}
		for _, id := range w.CupIds {
			// 移動/並べ替えで元から同じカードなら統合とは数えない。
			for _, row := range before {
				if row.UnitID == id && !ptrEqual(row.BeforeDripID, w.After.DripId) {
					result[id] = *target
				}
			}
		}
	}
	return result
}
func containsUUID(ids []uuid.UUID, id uuid.UUID) bool {
	for _, v := range ids {
		if v == id {
			return true
		}
	}
	return false
}

// 緊急の追加・取消を、対象cup/order・理由・淹れ直しIDと共に残す。
func recordCaosEmergency(tx *gorm.DB, kind string, now time.Time, before []models.CaosOperationCup, ids []uuid.UUID, reason string) error {
	payload, err := json.Marshal(map[string]any{"reason": reason, "unit_ids": ids})
	if err != nil {
		return err
	}
	return recordCaosOperation(tx, kind, now, now, nil, before, ids, nil, payload)
}
