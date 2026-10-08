// api/internal/handlers/activity.go
package handlers

import (
	"fmt"
	"strconv"
	"strings"

	"cafeore-pos/api/internal/models"
	"github.com/google/uuid"
)

// 操作の通知（notify.Activity）に流す文面。DB には触らず、渡された値だけで組み立てる。

// 末尾に付ける Slack のカスタム絵文字（ワークスペースに登録してあるもの）
const (
	tagAdd       = ":e-add:"
	tagChange    = ":e-change:"
	tagDelete    = ":e-delete:"
	tagInventory = ":e-take-inventory:"
	tagRestock   = ":e-restock:"
	tagStop      = ":e-stop:"
	tagRestart   = ":e-restart:"
)

// 末尾にカスタム絵文字を付ける。文面が空（送らない）なら空のまま。
// 直前が文字だと Slack が絵文字として読まないことがあるので、間を空ける
func tagged(text, tag string) string {
	if text == "" {
		return ""
	}
	return text + " " + tag
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

func formatNumber(v float64) string {
	return strconv.FormatFloat(v, 'f', -1, 64)
}

func formatYen(v int) string {
	return "¥" + strconv.Itoa(v)
}

func updatedMessage(label, name, changes string) string {
	if changes == "" {
		return ""
	}
	return tagged(fmt.Sprintf("✏️ %sを変更: %s（%s）", label, name, changes), tagChange)
}

// --- アイテムタイプ ---

func itemTypeCreatedMessage(t *models.ItemType) string {
	return tagged(fmt.Sprintf("🆕 タイプを追加: %s（%s）", t.DisplayName, t.Name), tagAdd)
}

func itemTypeUpdatedMessage(before, after *models.ItemType) string {
	return updatedMessage("タイプ", after.DisplayName, describeChanges(
		change{"表示名", before.DisplayName, after.DisplayName},
		change{"内部名", before.Name, after.Name},
	))
}

func itemTypeDeletedMessage(t *models.ItemType) string {
	return tagged(fmt.Sprintf("🗑️ タイプを削除: %s（%s）", t.DisplayName, t.Name), tagDelete)
}

// --- アイテム ---

func itemCreatedMessage(item *models.Item) string {
	return tagged(fmt.Sprintf("🆕 アイテムを追加: %s（略称 %s / %s）", item.Name, item.Abbr, item.ItemType.DisplayName), tagAdd)
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
	return tagged(fmt.Sprintf("🗑️ アイテムを削除: %s", item.Name), tagDelete)
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
	return tagged(fmt.Sprintf("🆕 メニューを追加: %s %s（キー %s / %s）", menu.Name, formatYen(menu.Price), menu.Key, menuItemsText(menu)), tagAdd)
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
	return tagged(fmt.Sprintf("🗑️ メニューを削除: %s（キー %s）", menu.Name, menu.Key), tagDelete)
}

// --- 背景色 ---

var colorScreenLabels = map[string]string{
	string(models.ColorScreenCashier):      "レジのボタン",
	string(models.ColorScreenCashierOrder): "レジの過去の注文",
	string(models.ColorScreenMaster):       "マスター",
	string(models.ColorScreenServe):        "提供",
}

// 画面の名前。知らない画面はそのままの値で出す
func colorScreenLabel(screen string) string {
	if label, ok := colorScreenLabels[screen]; ok {
		return label
	}
	return screen
}

// before が無ければ（ID が空なら）追加、あれば色の変更として出す。同じ色なら空
func colorSettingSavedMessage(target string, before, after *models.ColorSetting) string {
	screen := colorScreenLabel(after.Screen)
	if before.ID == uuid.Nil {
		return tagged(fmt.Sprintf("🆕 背景色を追加: %s（%s）%s", target, screen, after.Color), tagAdd)
	}
	if before.Color == after.Color {
		return ""
	}
	return tagged(fmt.Sprintf("✏️ 背景色を変更: %s（%s）%s → %s", target, screen, before.Color, after.Color), tagChange)
}

func colorSettingDeletedMessage(target string, setting *models.ColorSetting) string {
	return tagged(fmt.Sprintf("🗑️ 背景色を削除: %s（%s）%s", target, colorScreenLabel(setting.Screen), setting.Color), tagDelete)
}

// --- 在庫対象 ---

var stockKindLabels = map[string]string{
	string(models.StockResourceKindCup):  "カップ",
	string(models.StockResourceKindBean): "豆",
}

func stockResourceCreatedMessage(r *models.StockResource) string {
	return tagged(fmt.Sprintf("🆕 在庫対象を追加: %s（%s / 1杯 %s%s）", r.Name, stockKindLabels[r.Kind], formatNumber(r.PerServing), r.Unit), tagAdd)
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
	return tagged(fmt.Sprintf("🗑️ 在庫対象を削除: %s", r.Name), tagDelete)
}

// --- 使用量 ---

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
	return tagged(fmt.Sprintf("✏️ 使用量を変更: %s → %s", itemName, usagesText(usages, resources)), tagInventory)
}

func allUsagesReplacedMessage(count int) string {
	return tagged(fmt.Sprintf("✏️ 使用量をまとめて置き換え（%d件）", count), tagInventory)
}

// --- 棚卸し・入荷・調整 ---

func signed(v float64) string {
	if v > 0 {
		return "+" + formatNumber(v)
	}
	return formatNumber(v)
}

// remaining は記録したあとの残量（推定）。分からなければ nil
func stockEventMessage(r *models.StockResource, e *models.StockEvent, estimated, remaining *float64) string {
	var text string
	switch e.Kind {
	case string(models.StockEventKindCount):
		text = fmt.Sprintf("📝 %s %s%s", r.Name, formatNumber(e.Quantity), r.Unit)
		if estimated != nil {
			text += fmt.Sprintf("（推定 %s%s、差 %s%s）", formatNumber(*estimated), r.Unit, signed(e.Quantity-*estimated), r.Unit)
		}
	case string(models.StockEventKindReceipt):
		text = fmt.Sprintf("📝 %s %s%s", r.Name, signed(e.Quantity), r.Unit)
	default:
		text = fmt.Sprintf("📝 %s %s%s", r.Name, signed(e.Quantity), r.Unit)
	}
	if e.Kind != string(models.StockEventKindCount) && remaining != nil {
		text += fmt.Sprintf("（残り約%s%s）", formatNumber(*remaining), r.Unit)
	}
	if e.Note != "" {
		text += fmt.Sprintf("「%s」", e.Note)
	}
	// 入荷だけ末尾の絵文字を変えて見分ける
	if e.Kind == string(models.StockEventKindReceipt) {
		return tagged(text, tagRestock)
	}
	return tagged(text, tagInventory)
}

// --- オーダーストップ ---

func masterStateChangedMessage(state string) string {
	switch state {
	case "stop":
		return tagged("⛔ オーダーストップ", tagStop)
	case "operational":
		return tagged("✅ オーダー再開", tagRestart)
	default:
		return fmt.Sprintf("マスターの状態を変更: %s", state)
	}
}
