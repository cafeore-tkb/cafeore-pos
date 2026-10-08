package handlers

import (
	"testing"

	"cafeore-pos/api/internal/models"
	"github.com/google/uuid"
)

func TestDescribeChangesListsOnlyChangedFields(t *testing.T) {
	got := describeChanges(
		change{"名前", "ケニア", "ケニア"},
		change{"価格", "¥400", "¥450"},
		change{"キー", ";", ":"},
	)
	if got != "価格 ¥400 → ¥450、キー ; → :" {
		t.Fatalf("unexpected: %q", got)
	}
	if describeChanges(change{"名前", "a", "a"}) != "" {
		t.Fatal("expected empty when nothing changed")
	}
}

func TestMenuUpdatedMessage(t *testing.T) {
	kenya := models.Item{Name: "ケニア"}
	tote := models.Item{Name: "トートバッグ"}
	before := models.Menu{Name: "トートセット", Abbr: "セット", Price: 1000, Key: "@",
		MenuItems: []models.MenuItem{{Item: kenya, Quantity: 1}}}
	after := before
	after.Price = 1200
	after.MenuItems = []models.MenuItem{{Item: kenya, Quantity: 1}, {Item: tote, Quantity: 1}}

	got := menuUpdatedMessage(&before, &after)
	want := "✏️ メニューを変更: トートセット（価格 ¥1000 → ¥1200、構成 ケニア×1 → ケニア×1、トートバッグ×1） :e-change:"
	if got != want {
		t.Fatalf("got  %q\nwant %q", got, want)
	}
	// 保存し直しただけなら通知しない
	if menuUpdatedMessage(&before, &before) != "" {
		t.Fatal("expected no message for unchanged menu")
	}
}

func TestItemUsagesMessage(t *testing.T) {
	cup, bean := uuid.New(), uuid.New()
	resources := map[uuid.UUID]models.StockResource{
		cup:  {Name: "ホットカップ", Unit: "個"},
		bean: {Name: "ケニア豆", Unit: "g"},
	}
	usages := []models.ItemStockUsage{
		{ResourceID: cup, Amount: 1},
		{ResourceID: bean, Amount: 15},
	}
	if got := itemUsagesMessage("ケニア", usages, resources); got != "✏️ 使用量を変更: ケニア → ホットカップ 1個・ケニア豆 15g :e-take-inventory:" {
		t.Fatalf("unexpected: %q", got)
	}
	if got := itemUsagesMessage("ケニア", nil, resources); got != "✏️ 使用量を変更: ケニア → なし :e-take-inventory:" {
		t.Fatalf("unexpected: %q", got)
	}
}

func TestStockEventMessage(t *testing.T) {
	bean := models.StockResource{Name: "ケニア豆", Unit: "g"}
	estimated, remaining := 1180.0, 2230.0

	cases := []struct {
		name  string
		event models.StockEvent
		want  string
	}{
		{
			"receipt",
			models.StockEvent{Kind: "receipt", Quantity: 1000, Note: "追加発注分"},
			"📝 ケニア豆 +1000g（残り約2230g）「追加発注分」 :e-restock:",
		},
		{
			"count",
			models.StockEvent{Kind: "count", Quantity: 1200},
			"📝 ケニア豆 1200g（推定 1180g、差 +20g） :e-take-inventory:",
		},
		{
			"adjust",
			models.StockEvent{Kind: "adjust", Quantity: -50},
			"📝 ケニア豆 -50g（残り約2230g） :e-take-inventory:",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := stockEventMessage(&bean, &tc.event, &estimated, &remaining); got != tc.want {
				t.Fatalf("got  %q\nwant %q", got, tc.want)
			}
		})
	}

	// 残量が出せない（まだ棚卸しも入荷もない）ときは残りを付けない
	event := models.StockEvent{Kind: "receipt", Quantity: 500}
	if got := stockEventMessage(&bean, &event, nil, nil); got != "📝 ケニア豆 +500g :e-restock:" {
		t.Fatalf("unexpected: %q", got)
	}
}

func TestMasterStateMessage(t *testing.T) {
	if masterStateChangedMessage("stop") != "⛔ オーダーストップ :e-stop:" || masterStateChangedMessage("operational") != "✅ オーダー再開 :e-restart:" {
		t.Fatal("unexpected master state message")
	}
}

func TestColorSettingMessages(t *testing.T) {
	after := models.ColorSetting{Screen: "master", Color: "#7bf1a8"}
	if got := colorSettingSavedMessage("ライチ", &models.ColorSetting{}, &after); got != "🆕 背景色を追加: ライチ（マスター）#7bf1a8 :e-add:" {
		t.Fatalf("unexpected: %q", got)
	}
	before := models.ColorSetting{ID: uuid.New(), Screen: "master", Color: "#bedbff"}
	if got := colorSettingSavedMessage("ライチ", &before, &after); got != "✏️ 背景色を変更: ライチ（マスター）#bedbff → #7bf1a8 :e-change:" {
		t.Fatalf("unexpected: %q", got)
	}
	same := models.ColorSetting{ID: uuid.New(), Screen: "master", Color: "#7bf1a8"}
	if got := colorSettingSavedMessage("ライチ", &same, &after); got != "" {
		t.Fatalf("expected no message, got %q", got)
	}
	deleted := models.ColorSetting{Screen: "serve", Color: "#fff085"}
	if got := colorSettingDeletedMessage("ミルク", &deleted); got != "🗑️ 背景色を削除: ミルク（提供）#fff085 :e-delete:" {
		t.Fatalf("unexpected: %q", got)
	}
	cashier := models.ColorSetting{Screen: "cashier_order", Color: "#fff085"}
	if got := colorSettingSavedMessage("ミルク", &models.ColorSetting{}, &cashier); got != "🆕 背景色を追加: ミルク（レジの過去の注文）#fff085 :e-add:" {
		t.Fatalf("unexpected: %q", got)
	}
}
