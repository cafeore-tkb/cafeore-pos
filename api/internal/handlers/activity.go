package handlers

import (
	"fmt"
	"strconv"
	"strings"

	"cafeore-pos/api/internal/models"
)

// 操作の通知（notify.Activity）に流す文面。DB には触らず、渡された値だけで組み立てる。
//
// 流すのは次の6種類だけ。タイプ・背景色の編集と在庫の調整は流さない。
//   - メニュー / アイテム / 在庫の設定（在庫対象・使用量）の追加・変更・削除
//   - 棚卸し / 入荷
//   - オーダーストップ・再開
//
// 追加・変更・削除はどれも「{印} {対象}を{操作}: {名前}（{詳細}）」の形にそろえる。
// 文言は POS の /dev/notify で試せる。ここを変えたらそちらの既定値も合わせること。

type operation struct{ mark, label string }

var (
	opCreated = operation{"🆕", "追加"}
	opUpdated = operation{"✏️", "変更"}
	opDeleted = operation{"🗑️", "削除"}
)

// 詳細が空なら括弧ごと省く
func changeMessage(op operation, target, name, detail string) string {
	text := fmt.Sprintf("%s %sを%s: %s", op.mark, target, op.label, name)
	if detail != "" {
		text += "（" + detail + "）"
	}
	return text
}

type change struct{ label, before, after string }

// 変わった項目だけを「名前 A → B、価格 ¥400 → ¥450」と並べる。何も変わっていなければ空。
func describeChanges(changes ...change) string {
	parts := make([]string, 0, len(changes))
	for _, c := range changes {
		if c.before != c.after {
			parts = append(parts, fmt.Sprintf("%s %s → %s", c.label, c.before, c.after))
		}
	}
	return strings.Join(parts, "、")
}

// 変わった項目が無ければ（保存し直しただけなら）通知しない
func updatedMessage(target, name, changes string) string {
	if changes == "" {
		return ""
	}
	return changeMessage(opUpdated, target, name, changes)
}

func formatNumber(v float64) string {
	return strconv.FormatFloat(v, 'f', -1, 64)
}

func formatYen(v int) string {
	return "¥" + strconv.Itoa(v)
}

// --- メニュー ---

// 構成を「優勝ブレンド×1、トートバッグ×1」と並べる
func menuItemsText(menu *models.Menu) string {
	parts := make([]string, 0, len(menu.MenuItems))
	for _, mi := range menu.MenuItems {
		parts = append(parts, fmt.Sprintf("%s×%d", mi.Item.Name, mi.Quantity))
	}
	return strings.Join(parts, "、")
}

func menuCreatedMessage(menu *models.Menu) string {
	return changeMessage(opCreated, "メニュー", menu.Name,
		fmt.Sprintf("%s / キー %s / %s", formatYen(menu.Price), menu.Key, menuItemsText(menu)))
}

func menuUpdatedMessage(before, after *models.Menu) string {
	return updatedMessage("メニュー", after.Name, describeChanges(
		change{"名前", before.Name, after.Name},
		change{"略称", before.Abbr, after.Abbr},
		change{"価格", formatYen(before.Price), formatYen(after.Price)},
		change{"キー", before.Key, after.Key},
		change{"構成", menuItemsText(before), menuItemsText(after)},
	))
}

func menuDeletedMessage(menu *models.Menu) string {
	return changeMessage(opDeleted, "メニュー", menu.Name, "")
}

// --- アイテム ---

func itemCreatedMessage(item *models.Item) string {
	return changeMessage(opCreated, "アイテム", item.Name,
		fmt.Sprintf("略称 %s / %s", item.Abbr, item.ItemType.DisplayName))
}

// before は ItemType を読み込んだもの
func itemUpdatedMessage(before, after *models.Item) string {
	return updatedMessage("アイテム", after.Name, describeChanges(
		change{"名前", before.Name, after.Name},
		change{"略称", before.Abbr, after.Abbr},
		change{"タイプ", before.ItemType.DisplayName, after.ItemType.DisplayName},
	))
}

func itemDeletedMessage(item *models.Item) string {
	return changeMessage(opDeleted, "アイテム", item.Name, "")
}

// --- 在庫の設定（在庫対象・使用量） ---

var stockKindLabels = map[string]string{
	string(models.StockResourceKindCup):  "カップ",
	string(models.StockResourceKindBean): "豆",
}

func stockResourceCreatedMessage(r *models.StockResource) string {
	return changeMessage(opCreated, "在庫対象", r.Name,
		fmt.Sprintf("%s / 1杯 %s%s", stockKindLabels[r.Kind], formatNumber(r.PerServing), r.Unit))
}

func stockResourceUpdatedMessage(before, after *models.StockResource) string {
	return updatedMessage("在庫対象", after.Name, describeChanges(
		change{"種類", stockKindLabels[before.Kind], stockKindLabels[after.Kind]},
		change{"名前", before.Name, after.Name},
		change{"単位", before.Unit, after.Unit},
		change{"1杯あたり", formatNumber(before.PerServing), formatNumber(after.PerServing)},
		change{"通知開始", strconv.Itoa(before.NotifyFrom), strconv.Itoa(after.NotifyFrom)},
		change{"間隔", strconv.Itoa(before.NotifyStep), strconv.Itoa(after.NotifyStep)},
		change{"バッファ", strconv.Itoa(before.Buffer), strconv.Itoa(after.Buffer)},
	))
}

func stockResourceDeletedMessage(r *models.StockResource) string {
	return changeMessage(opDeleted, "在庫対象", r.Name, "")
}

// 「ホットカップ 1個・ケニア豆 15g」と並べる。resources に無いものは飛ばす
func usagesText(usages []models.ItemStockUsage, resources map[string]models.StockResource) string {
	parts := make([]string, 0, len(usages))
	for _, u := range usages {
		r, ok := resources[u.ResourceID.String()]
		if !ok {
			continue
		}
		parts = append(parts, fmt.Sprintf("%s %s%s", r.Name, formatNumber(u.Amount), r.Unit))
	}
	if len(parts) == 0 {
		return "なし"
	}
	return strings.Join(parts, "・")
}

func itemUsagesMessage(itemName string, usages []models.ItemStockUsage, resources map[string]models.StockResource) string {
	return changeMessage(opUpdated, "使用量", itemName, usagesText(usages, resources))
}

func allUsagesReplacedMessage(count int) string {
	return changeMessage(opUpdated, "使用量", fmt.Sprintf("%d件をまとめて置き換え", count), "")
}

// --- 棚卸し・入荷 ---

func signed(v float64) string {
	if v > 0 {
		return "+" + formatNumber(v)
	}
	return formatNumber(v)
}

// 調整は流さないので空を返す。remaining は記録したあとの残量（推定）。分からなければ nil
func stockEventMessage(r *models.StockResource, e *models.StockEvent, estimated, remaining *float64) string {
	var text string
	switch e.Kind {
	case string(models.StockEventKindCount):
		text = fmt.Sprintf("📋 棚卸し: %s %s%s", r.Name, formatNumber(e.Quantity), r.Unit)
		if estimated != nil {
			text += fmt.Sprintf("（推定 %s%s、差 %s%s）", formatNumber(*estimated), r.Unit, signed(e.Quantity-*estimated), r.Unit)
		}
	case string(models.StockEventKindReceipt):
		text = fmt.Sprintf("📦 入荷: %s %s%s", r.Name, signed(e.Quantity), r.Unit)
		if remaining != nil {
			text += fmt.Sprintf("（残り約%s%s）", formatNumber(*remaining), r.Unit)
		}
	default:
		return ""
	}
	if e.Note != "" {
		text += fmt.Sprintf("「%s」", e.Note)
	}
	return text
}

// --- オーダーストップ ---

func masterStateMessage(state string) string {
	switch state {
	case "stop":
		return "⛔ オーダーストップ"
	case "operational":
		return "▶️ オーダー再開"
	default:
		return fmt.Sprintf("マスターの状態を変更: %s", state)
	}
}
