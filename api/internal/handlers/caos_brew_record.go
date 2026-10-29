package handlers

import (
	"encoding/json"
	"errors"
	"sort"
	"time"

	"cafeore-pos/api/internal/models"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type brewGroup struct {
	drip    uuid.UUID
	started time.Time
	rows    []models.CaosOperationCup
}

func brewGroupKey(drip uuid.UUID, started time.Time) string {
	return drip.String() + "/" + started.UTC().Format(time.RFC3339Nano)
}

func brewUnits(rows []models.CaosOperationCup) json.RawMessage {
	ids := make([]string, 0, len(rows))
	for _, row := range rows {
		ids = append(ids, row.UnitID.String())
	}
	sort.Strings(ids)
	encoded, _ := json.Marshal(ids)
	return encoded
}

func sameBrewUnits(a, b json.RawMessage) bool {
	var left, right []string
	if json.Unmarshal(a, &left) != nil || json.Unmarshal(b, &right) != nil || len(left) != len(right) {
		return false
	}
	sort.Strings(left)
	sort.Strings(right)
	for i := range left {
		if left[i] != right[i] {
			return false
		}
	}
	return true
}

func brewGroupKind(rows []models.CaosOperationCup) (string, string) {
	if len(rows) < 1 || len(rows) > 2 {
		return "", "invalid_cups"
	}
	seen := map[uuid.UUID]bool{}
	reason := ""
	for _, row := range rows {
		if seen[row.UnitID] {
			return "", "duplicate_cups"
		}
		seen[row.UnitID] = true
		if row.UnitID != row.CupID || row.EmergencyReason != "" {
			reason = "rebrew"
		}
		if row.IcedBrew == nil {
			return "", "unknown_type"
		}
		if rows[0].IcedBrew != nil && *row.IcedBrew != *rows[0].IcedBrew {
			return "", "mixed_type"
		}
	}
	kind := "hot"
	if *rows[0].IcedBrew {
		kind = "ice"
	}
	if len(rows) == 2 {
		return kind + "2", reason
	}
	return kind + "1", reason
}

func brewOperationDelayed(op models.CaosOperation) bool {
	d := op.RecordedAt.Sub(op.OccurredAt)
	return d > 5*time.Second || d < -5*time.Second
}

func beginCaosBrewRecord(tx *gorm.DB, op models.CaosOperation, group brewGroup, reason string) error {
	kind, classificationReason := brewGroupKind(group.rows)
	if reason == "" {
		reason = classificationReason
	}
	dripper := 0
	if len(group.rows) > 0 && group.rows[0].AfterDripper != nil {
		dripper = *group.rows[0].AfterDripper
	}
	for _, row := range group.rows {
		if row.AfterDripper == nil || *row.AfterDripper != dripper {
			reason = "inconsistent_dripper"
		}
	}
	personReason := ""
	var assignee models.DripperAssigneeChange
	err := tx.Where("day = ? AND dripper = ? AND changed_at <= ?", caosDayString(group.started), dripper, group.started).Order("changed_at DESC, id DESC").Take(&assignee).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	if errors.Is(err, gorm.ErrRecordNotFound) || assignee.Name == "" || assignee.Grade == "" {
		personReason = "unknown_assignee"
	}
	if brewOperationDelayed(op) {
		personReason = "delayed_operation"
		if reason == "" {
			reason = "delayed_operation"
		}
	}
	samples, err := loadCaosBrewSamples(tx, group.started)
	if err != nil {
		return err
	}
	name, grade := assignee.Name, assignee.Grade
	if personReason == "delayed_operation" {
		name = ""
		grade = ""
	}
	estimate := estimateCaosBrew(samples, kind, name, grade, group.started)
	record := models.CaosBrewRecord{DripID: group.drip, StartedAt: group.started, Dripper: dripper, Kind: kind, UnitIDs: brewUnits(group.rows), Name: name, Grade: grade, PredictedSeconds: estimate.Seconds, StandardSeconds: estimate.StandardSeconds, Coefficient: estimate.Coefficient, StandardSamples: estimate.StandardSamples, PersonSamples: estimate.PersonSamples, ExcludedReason: reason, PersonExcludedReason: personReason, ModelVersion: caosBrewModelVersion, StartOperationID: op.ID, RecordedAt: op.RecordedAt, UpdatedAt: op.RecordedAt}
	return tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&record).Error
}

func finishCaosBrewRecord(tx *gorm.DB, op models.CaosOperation, group brewGroup) error {
	var record models.CaosBrewRecord
	err := tx.Where("drip_id = ? AND started_at = ?", group.drip, group.started).Take(&record).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		if err = beginCaosBrewRecord(tx, op, group, "missing_start"); err != nil {
			return err
		}
		err = tx.Where("drip_id = ? AND started_at = ?", group.drip, group.started).Take(&record).Error
	}
	if err != nil {
		return err
	}
	if record.FinishedAt != nil {
		return nil
	}
	finished := group.rows[0].AfterBrewFinishedAt
	if finished == nil {
		return nil
	}
	actual := finished.Sub(group.started).Seconds()
	reason := record.ExcludedReason
	kind, kindReason := brewGroupKind(group.rows)
	if reason == "" {
		reason = kindReason
	}
	if reason == "" && (kind != record.Kind || !sameBrewUnits(record.UnitIDs, brewUnits(group.rows))) {
		reason = "changed_cups"
	}
	for _, row := range group.rows {
		if !timeEqual(row.AfterBrewFinishedAt, finished) || row.AfterDripper == nil || *row.AfterDripper != record.Dripper {
			reason = "inconsistent_finish"
		}
	}
	if op.Kind != "next" {
		reason = "non_next_finish"
	}
	if actual < 60 || actual > 900 {
		reason = "duration_outlier"
	}
	var changes int64
	if err := tx.Model(&models.DripperAssigneeChange{}).Where("dripper = ? AND changed_at > ? AND changed_at <= ?", record.Dripper, record.StartedAt, *finished).Where("name <> ? OR grade <> ?", record.Name, record.Grade).Count(&changes).Error; err != nil {
		return err
	}
	if changes > 0 {
		reason = "assignee_changed"
	}
	personReason := record.PersonExcludedReason
	if brewOperationDelayed(op) {
		personReason = "delayed_operation"
		if reason == "" {
			reason = "delayed_operation"
		}
	}
	return tx.Model(&models.CaosBrewRecord{}).Where("drip_id = ? AND started_at = ? AND finished_at IS NULL", record.DripID, record.StartedAt).Updates(map[string]any{"finished_at": finished, "actual_seconds": actual, "excluded_reason": reason, "person_excluded_reason": personReason, "finish_operation_id": op.ID, "updated_at": op.RecordedAt}).Error
}

// 成功操作の同じトランザクションで開始時予測と実績を残す。画面や再送の数では増えない。
func recordCaosBrews(tx *gorm.DB, op models.CaosOperation, rows []models.CaosOperationCup) error {
	groups := map[string]*brewGroup{}
	starts := map[string]bool{}
	finishes := map[string]bool{}
	for _, row := range rows {
		if row.Changed && row.BeforeDripID != nil && row.BeforeBrewStartedAt != nil && row.BeforeBrewFinishedAt == nil &&
			(row.AfterDripID == nil || !ptrEqual(row.BeforeDripID, row.AfterDripID) || !timeEqual(row.BeforeBrewStartedAt, row.AfterBrewStartedAt)) {
			if err := tx.Model(&models.CaosBrewRecord{}).Where("drip_id = ? AND started_at = ? AND finished_at IS NULL AND excluded_reason = ''", row.BeforeDripID, row.BeforeBrewStartedAt).Updates(map[string]any{"excluded_reason": "restarted_or_moved", "updated_at": op.RecordedAt}).Error; err != nil {
				return err
			}
		}
		if row.AfterDripID == nil || row.AfterBrewStartedAt == nil {
			continue
		}
		key := brewGroupKey(*row.AfterDripID, *row.AfterBrewStartedAt)
		if groups[key] == nil {
			groups[key] = &brewGroup{drip: *row.AfterDripID, started: *row.AfterBrewStartedAt}
		}
		groups[key].rows = append(groups[key].rows, row)
		if row.Changed && row.AfterBrewFinishedAt == nil && (!timeEqual(row.BeforeBrewStartedAt, row.AfterBrewStartedAt) || !ptrEqual(row.BeforeDripID, row.AfterDripID)) {
			starts[key] = true
		}
		if row.Changed && row.BeforeBrewFinishedAt == nil && row.AfterBrewFinishedAt != nil {
			finishes[key] = true
		}
		if row.MergedAt != nil && row.MergedAt.After(*row.AfterBrewStartedAt) {
			if err := tx.Model(&models.CaosBrewRecord{}).Where("drip_id = ? AND started_at = ? AND excluded_reason = ''", row.AfterDripID, row.AfterBrewStartedAt).Updates(map[string]any{"excluded_reason": "late_merge", "updated_at": op.RecordedAt}).Error; err != nil {
				return err
			}
		}
	}
	// 同じ「次へ」で完了と開始が並んでも、その時点と同時の実績は予測に使わない。
	keys := make([]string, 0, len(groups))
	for key := range groups {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		if finishes[key] {
			if err := finishCaosBrewRecord(tx, op, *groups[key]); err != nil {
				return err
			}
		}
	}
	for _, key := range keys {
		if starts[key] {
			if err := beginCaosBrewRecord(tx, op, *groups[key], ""); err != nil {
				return err
			}
		}
	}
	return nil
}
