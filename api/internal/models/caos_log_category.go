package models

import (
	"encoding/json"
	"strings"
)

// ログを出力した場所ではなく、記録している出来事で分ける。
// API結果・自動更新はsystem。操作受付と明示的なUI操作だけをhumanにする。
func CaosLogCategory(event string, details json.RawMessage) string {
	var fields map[string]any
	_ = json.Unmarshal(details, &fields)
	if trusted, ok := fields["isTrusted"].(bool); ok && !trusted {
		return "system"
	}
	switch event {
	case "ui.click", "ui.change", "ui.input", "ui.pointerdown", "ui.pointerup", "ui.pointercancel", "ui.dragstart", "ui.drop", "ui.keydown",
		"card.action", "comment.mark.clicked", "comment.notice.clicked", "comment.notices.dismissed",
		"search.submitted", "search.opened-from-comment", "sound.changed", "printer.retry",
		"outbox.retry", "outbox.discard", "confirmation.confirmed", "notice.dismissed",
		"device-setting.changed", "water.changed", "practice.reset", "practice.started",
		"practice.running.changed", "practice.speed.changed", "practice.import.cleared",
		"shift-feed.key.saved", "shift-feed.key.cleared", "shift-feed.reload":
		return "human"
	case "practice.finished":
		if fields["source"] == "manual" {
			return "human"
		}
	}
	// requestedだけが操作受付。API送信や自動リロードのrequestedとは区別する。
	if event == "operation.requested" || event == "lanes.operation.requested" || event == "practice.operation.requested" || event == "comment.stamp.requested" || event == "emergency.add.requested" || event == "emergency.cancel.requested" || event == "practice.import.requested" || event == "inventory.requested" || (strings.HasPrefix(event, "board.") && strings.HasSuffix(event, ".requested")) || strings.HasPrefix(event, "gesture.") {
		return "human"
	}
	return "system"
}

func categorizedCaosDetails(details json.RawMessage, category string) json.RawMessage {
	fields := map[string]any{}
	if json.Unmarshal(details, &fields) != nil || fields == nil {
		fields = map[string]any{}
	}
	fields["category"] = category
	encoded, _ := json.Marshal(fields)
	return encoded
}

// 既存のDB行もGET/書き出し時に分類する。スキーマ変更・過去データの書換えは不要。
func (row CaosClientLog) MarshalJSON() ([]byte, error) {
	type plain CaosClientLog
	value := plain(row)
	details, _ := decodeCaosClientLogDetails(row.Details)
	value.Details = categorizedCaosDetails(details, CaosLogCategory(row.Event, details))
	return json.Marshal(value)
}

// サーバーの成功履歴は操作に対する処理結果。画面での操作受付と区別する。
func (row CaosOperation) MarshalJSON() ([]byte, error) {
	type plain CaosOperation
	value := plain(row)
	value.Details = categorizedCaosDetails(row.Details, "system")
	return json.Marshal(value)
}
