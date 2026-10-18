package handlers

import (
	"encoding/json"
	"fmt"
	"io"
	"strings"
	"time"

	"cafeore-pos/api/internal/models"
	"gorm.io/gorm"
)

type caosHumanLog struct {
	Category string         `json:"category"`
	Time     string         `json:"time"`
	Action   string         `json:"action"`
	Target   string         `json:"target"`
	Event    string         `json:"event"`
	Details  map[string]any `json:"details"`
}

// 古い座標イベントも除外し、意味のある操作だけを時系列に出す。
func humanCaosLog(row models.CaosClientLog, orderNo *int) *caosHumanLog {
	return displayCaosLog(row, orderNo, "human")
}

func displayCaosLog(row models.CaosClientLog, orderNo *int, format string) *caosHumanLog {
	if strings.HasPrefix(row.Event, "ui.") {
		return nil
	}
	// mainのNUL互換エンコードはモデルの公開シリアライザーで復元する。
	encoded, err := json.Marshal(row)
	if err != nil {
		return nil
	}
	var public struct{ Details map[string]any }
	if json.Unmarshal(encoded, &public) != nil {
		return nil
	}
	category, _ := public.Details["category"].(string)
	if format != "mixed" && category != format {
		return nil
	}
	details := public.Details
	// 旧ログに座標があっても書き出さない。source/target内も再帰的に除く。
	details = cleanCaosLogDetails(details).(map[string]any)
	target := "CaOS"
	for _, key := range []string{"source", "card", "target"} {
		if object, ok := details[key].(map[string]any); ok {
			if card, ok := object["card"].(map[string]any); ok {
				object = card
			}
			if label, ok := object["orderLabel"].(string); ok && label != "" {
				target = label
				break
			}
		}
	}
	if label, ok := details["orderLabel"].(string); ok && label != "" {
		target = label
	}
	if orderNo != nil {
		target = fmt.Sprintf("注文 #%03d", *orderNo)
	}
	if label, ok := details["label"].(string); ok && label != "" {
		target += " / " + label
	}
	if no, ok := details["orderNo"].(float64); ok {
		target = fmt.Sprintf("注文 #%03d", int(no))
	}
	if digits, ok := details["digits"].(string); ok && digits != "" {
		target = "注文番号 " + digits
	}
	return &caosHumanLog{Category: category, Time: row.At.In(time.FixedZone("JST", 9*60*60)).Format("2006-01-02 15:04:05.000 -07:00"), Action: row.Event, Target: target, Event: row.Event, Details: details}
}

func cleanCaosLogDetails(value any) any {
	switch v := value.(type) {
	case string:
		return strings.ReplaceAll(v, "\x00", "␀")
	case map[string]any:
		if cups, ok := v["cups"].([]any); ok && v["key"] != nil {
			summary := map[string]any{"cardKey": v["key"], "dripper": v["dripper"], "status": v["status"]}
			ids := []any{}
			labels := []string{}
			seen := map[int]bool{}
			for _, item := range cups {
				if cup, ok := item.(map[string]any); ok {
					ids = append(ids, cup["id"])
					if no, ok := cup["orderNo"].(float64); ok && !seen[int(no)] {
						seen[int(no)] = true
						labels = append(labels, fmt.Sprintf("#%03d", int(no)))
					}
				}
			}
			summary["unitIds"] = ids
			summary["orderLabel"] = strings.Join(labels, "+")
			return summary
		}
		clean := map[string]any{}
		for key, child := range v {
			switch key {
			case "x", "y", "startX", "startY", "pointer", "pointerId", "left", "top", "rect", "category", "isTrusted":
				continue
			}
			clean[key] = cleanCaosLogDetails(child)
		}
		return clean
	case []any:
		for i := range v {
			v[i] = cleanCaosLogDetails(v[i])
		}
		return v
	default:
		return value
	}
}

func writeCaosDisplayLogs(tx *gorm.DB, writer io.Writer, format string) error {
	rows, err := tx.Table("caos_client_logs AS l").Select("l.*, o.order_id AS log_order_no").Joins("LEFT JOIN orders o ON o.id::text = l.details->>'orderId'").Order("l.at, l.tab_id, l.sequence").Rows()
	if err != nil {
		return err
	}
	defer func() { _ = rows.Close() }()
	if _, err := io.WriteString(writer, "["); err != nil {
		return err
	}
	encoder := json.NewEncoder(writer)
	encoder.SetIndent("", "  ")
	first := true
	for rows.Next() {
		var row struct {
			models.CaosClientLog
			LogOrderNo *int
		}
		if err := tx.ScanRows(rows, &row); err != nil {
			return err
		}
		entry := displayCaosLog(row.CaosClientLog, row.LogOrderNo, format)
		if entry == nil {
			continue
		}
		if !first {
			if _, err := io.WriteString(writer, ","); err != nil {
				return err
			}
		}
		first = false
		if err := encoder.Encode(entry); err != nil {
			return err
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	_, err = io.WriteString(writer, "]")
	return err
}
