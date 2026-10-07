package handlers

import (
	"net/http"
	"testing"

	"cafeore-pos/api/internal/models"

	"github.com/google/uuid"
	openapi_types "github.com/oapi-codegen/runtime/types"
)

// マスタ（種類・アイテム・メニュー・背景色）の結合テスト（Postgres を使う）

func TestItemTypeCRUD(t *testing.T) {
	api := newTestAPI(t)

	var hot, ice models.ItemTypeResponse
	api.do(http.MethodPost, "/api/item-types", models.ItemTypeCreateRequest{Name: "ice", DisplayName: "アイス"}).
		expect(http.StatusCreated).decode(&ice)
	api.do(http.MethodPost, "/api/item-types", models.ItemTypeCreateRequest{Name: "hot", DisplayName: "ホット"}).
		expect(http.StatusCreated).decode(&hot)
	if hot.Id == (openapi_types.UUID{}) || hot.Name != "hot" || hot.DisplayName != "ホット" {
		t.Fatalf("created: %+v", hot)
	}
	api.do(http.MethodPost, "/api/item-types", `{`).expect(http.StatusBadRequest)

	// 名前の順に並べる
	var all []models.ItemTypeResponse
	api.do(http.MethodGet, "/api/item-types", nil).expect(http.StatusOK).decode(&all)
	if len(all) != 2 || all[0].Name != "hot" || all[1].Name != "ice" {
		t.Fatalf("item types: %+v", all)
	}

	var got models.ItemTypeResponse
	api.do(http.MethodGet, "/api/item-types/"+ice.Id.String(), nil).expect(http.StatusOK).decode(&got)
	if got != ice {
		t.Fatalf("got %+v, want %+v", got, ice)
	}

	api.do(http.MethodPut, "/api/item-types/"+ice.Id.String(), models.ItemTypeUpdateRequest{Id: ice.Id, Name: "iced", DisplayName: "アイスドリンク"}).
		expect(http.StatusOK).decode(&got)
	if got.Id != ice.Id || got.Name != "iced" || got.DisplayName != "アイスドリンク" {
		t.Fatalf("updated: %+v", got)
	}

	api.do(http.MethodDelete, "/api/item-types/"+ice.Id.String(), nil).expect(http.StatusOK)
	api.do(http.MethodGet, "/api/item-types", nil).expect(http.StatusOK).decode(&all)
	if len(all) != 1 || all[0].Id != hot.Id {
		t.Fatalf("deleted item type must not be listed: %+v", all)
	}
	// 論理削除なので行は残る（過去の注文のカップから参照する）
	var row models.ItemType
	if err := api.db.Unscoped().First(&row, "id = ?", ice.Id).Error; err != nil || !row.DeletedAt.Valid {
		t.Fatalf("must be soft deleted: %+v %v", row, err)
	}

	for _, path := range []string{"/api/item-types/abc", "/api/item-types/" + uuid.NewString(), "/api/item-types/" + ice.Id.String()} {
		want := http.StatusNotFound
		if path == "/api/item-types/abc" {
			want = http.StatusBadRequest
		}
		if res := api.do(http.MethodGet, path, nil); res.Code != want {
			t.Errorf("GET %s: status = %d, want %d", path, res.Code, want)
		}
		if res := api.do(http.MethodPut, path, models.ItemTypeUpdateRequest{Name: "x", DisplayName: "x"}); res.Code != want {
			t.Errorf("PUT %s: status = %d, want %d", path, res.Code, want)
		}
		if res := api.do(http.MethodDelete, path, nil); res.Code != want {
			t.Errorf("DELETE %s: status = %d, want %d", path, res.Code, want)
		}
	}
	api.do(http.MethodPut, "/api/item-types/"+hot.Id.String(), `{`).expect(http.StatusBadRequest)
}

func TestItemCRUD(t *testing.T) {
	api := newTestAPI(t)
	hot := models.ItemType{ID: uuid.New(), Name: "hot", DisplayName: "ホット"}
	ice := models.ItemType{ID: uuid.New(), Name: "ice", DisplayName: "アイス"}
	api.create(&hot, &ice)

	var item models.ItemResponse
	api.do(http.MethodPost, "/api/items", models.ItemCreateRequest{Name: "ブレンド", Abbr: "ブ", ItemTypeId: hot.ID}).
		expect(http.StatusCreated).decode(&item)
	// 種類も読み込んで返す
	if item.Name != "ブレンド" || item.Abbr != "ブ" || item.ItemType.Name != "hot" || item.ItemType.DisplayName != "ホット" {
		t.Fatalf("created: %+v", item)
	}
	api.do(http.MethodPost, "/api/items", `{`).expect(http.StatusBadRequest)

	var items []models.ItemResponse
	api.do(http.MethodGet, "/api/items", nil).expect(http.StatusOK).decode(&items)
	if len(items) != 1 || items[0] != item {
		t.Fatalf("items: %+v", items)
	}

	// 種類を変える
	var updated models.ItemResponse
	api.do(http.MethodPut, "/api/items/"+item.Id.String(), models.ItemUpdateRequest{Id: item.Id, Name: "アイスブレンド", Abbr: "アブ", ItemTypeId: ice.ID}).
		expect(http.StatusOK).decode(&updated)
	if updated.Id != item.Id || updated.Name != "アイスブレンド" || updated.ItemType.Name != "ice" {
		t.Fatalf("updated: %+v", updated)
	}
	var got models.ItemResponse
	api.do(http.MethodGet, "/api/items/"+item.Id.String(), nil).expect(http.StatusOK).decode(&got)
	if got != updated {
		t.Fatalf("got %+v, want %+v", got, updated)
	}
	api.do(http.MethodPut, "/api/items/"+item.Id.String(), `{`).expect(http.StatusBadRequest)

	api.do(http.MethodDelete, "/api/items/"+item.Id.String(), nil).expect(http.StatusOK)
	api.do(http.MethodGet, "/api/items", nil).expect(http.StatusOK).decode(&items)
	if len(items) != 0 {
		t.Fatalf("deleted item must not be listed: %+v", items)
	}

	for _, path := range []string{"/api/items/" + uuid.NewString(), "/api/items/" + item.Id.String()} {
		api.do(http.MethodGet, path, nil).expect(http.StatusNotFound)
		api.do(http.MethodPut, path, models.ItemUpdateRequest{Name: "x", Abbr: "x", ItemTypeId: hot.ID}).expect(http.StatusNotFound)
		api.do(http.MethodDelete, path, nil).expect(http.StatusNotFound)
	}
	api.do(http.MethodGet, "/api/items/abc", nil).expect(http.StatusBadRequest)
	api.do(http.MethodPut, "/api/items/abc", models.ItemUpdateRequest{}).expect(http.StatusBadRequest)
	api.do(http.MethodDelete, "/api/items/abc", nil).expect(http.StatusBadRequest)
}

func TestMenuCRUD(t *testing.T) {
	api := newTestAPI(t)
	m := api.seedMaster()

	var created models.MenuResponse
	api.do(http.MethodPost, "/api/menus", models.MenuCreateRequest{
		Name: "ホット & アイス", Abbr: "HI", Key: "w", Price: 800,
		Items: []models.MenuItemRequest{{ItemId: m.blend.ID, Quantity: 1}, {ItemId: m.iced.ID, Quantity: 1}},
	}).expect(http.StatusCreated).decode(&created)
	if created.Name != "ホット & アイス" || created.Key != "w" || created.Price != 800 || len(created.Items) != 2 {
		t.Fatalf("created: %+v", created)
	}
	// 構成品は種類まで読み込んで返す
	if created.Items[0].Item.ItemType.Name == "" {
		t.Fatalf("item type must be loaded: %+v", created.Items)
	}

	// 構成品が不正なら、メニューも作らない（トランザクションで戻す）
	before := api.count(&models.Menu{}, "")
	cases := map[string]any{
		"no items":     models.MenuCreateRequest{Name: "空", Key: "e", Price: 0},
		"zero":         models.MenuCreateRequest{Name: "零", Key: "z", Items: []models.MenuItemRequest{{ItemId: m.blend.ID, Quantity: 0}}},
		"duplicate":    models.MenuCreateRequest{Name: "重複", Key: "d", Items: []models.MenuItemRequest{{ItemId: m.blend.ID, Quantity: 1}, {ItemId: m.blend.ID, Quantity: 1}}},
		"key conflict": models.MenuCreateRequest{Name: "被り", Key: "w", Items: []models.MenuItemRequest{{ItemId: m.blend.ID, Quantity: 1}}},
		"broken json":  `{`,
	}
	for name, body := range cases {
		if res := api.do(http.MethodPost, "/api/menus", body); res.Code != http.StatusBadRequest {
			t.Errorf("%s: status = %d, want 400: %s", name, res.Code, res.Body)
		}
	}
	if after := api.count(&models.Menu{}, ""); after != before {
		t.Fatalf("menus: %d → %d", before, after)
	}

	// 構成品ごと置き換える
	var updated models.MenuResponse
	api.do(http.MethodPut, "/api/menus/"+created.Id.String(), models.MenuUpdateRequest{
		Id: created.Id, Name: "ホット 2 杯", Abbr: "H2", Key: "w", Price: 750,
		Items: []models.MenuItemRequest{{ItemId: m.blend.ID, Quantity: 2}},
	}).expect(http.StatusOK).decode(&updated)
	if updated.Name != "ホット 2 杯" || updated.Price != 750 || len(updated.Items) != 1 || updated.Items[0].Quantity != 2 {
		t.Fatalf("updated: %+v", updated)
	}
	if n := api.count(&models.MenuItem{}, "menu_id = ?", created.Id); n != 1 {
		t.Fatalf("%d menu items", n)
	}
	// 構成品が不正なら、名前や価格も変えない
	api.do(http.MethodPut, "/api/menus/"+created.Id.String(), models.MenuUpdateRequest{Name: "壊れ", Key: "w", Price: 1}).expect(http.StatusBadRequest)
	// 他のメニューとキーが被ったら、構成品も消さない
	api.do(http.MethodPut, "/api/menus/"+created.Id.String(), models.MenuUpdateRequest{
		Name: "被り", Key: m.blendMenu.Key, Items: []models.MenuItemRequest{{ItemId: m.iced.ID, Quantity: 1}},
	}).expect(http.StatusBadRequest)
	var got models.MenuResponse
	api.do(http.MethodGet, "/api/menus/"+created.Id.String(), nil).expect(http.StatusOK).decode(&got)
	if got.Name != "ホット 2 杯" || got.Key != "w" || len(got.Items) != 1 || got.Items[0].Item.Name != "ブレンド" {
		t.Fatalf("failed updates must not change the menu: %+v", got)
	}

	var menus []models.MenuResponse
	api.do(http.MethodGet, "/api/menus", nil).expect(http.StatusOK).decode(&menus)
	if len(menus) != 4 {
		t.Fatalf("menus: %+v", menus)
	}

	// 販売終了（論理削除）すると一覧から消える
	api.do(http.MethodDelete, "/api/menus/"+created.Id.String(), nil).expect(http.StatusNoContent)
	api.do(http.MethodGet, "/api/menus", nil).expect(http.StatusOK).decode(&menus)
	if len(menus) != 3 {
		t.Fatalf("deleted menu must not be listed: %+v", menus)
	}

	for _, path := range []string{"/api/menus/" + uuid.NewString(), "/api/menus/" + created.Id.String()} {
		api.do(http.MethodGet, path, nil).expect(http.StatusNotFound)
		api.do(http.MethodPut, path, models.MenuUpdateRequest{Name: "x", Key: "x", Items: []models.MenuItemRequest{{ItemId: m.blend.ID, Quantity: 1}}}).
			expect(http.StatusNotFound)
		api.do(http.MethodDelete, path, nil).expect(http.StatusNotFound)
	}
	api.do(http.MethodGet, "/api/menus/abc", nil).expect(http.StatusBadRequest)
	api.do(http.MethodPut, "/api/menus/abc", models.MenuUpdateRequest{}).expect(http.StatusBadRequest)
	api.do(http.MethodPut, "/api/menus/"+m.blendMenu.ID.String(), `{`).expect(http.StatusBadRequest)
	api.do(http.MethodDelete, "/api/menus/abc", nil).expect(http.StatusBadRequest)
}

func TestColorSettings(t *testing.T) {
	api := newTestAPI(t)
	m := api.seedMaster()

	request := models.ColorSettingUpsertRequest{
		TargetType: models.ColorTargetTypeItemType, TargetId: m.hotType.ID, Screen: models.ColorScreenMaster, Color: "#FCA5A5",
	}
	var created models.ColorSettingResponse
	api.do(http.MethodPut, "/api/color-settings", request).expect(http.StatusOK).decode(&created)
	if created.Color != "#fca5a5" || created.TargetId != m.hotType.ID || created.Screen != models.ColorScreenMaster {
		t.Fatalf("created: %+v", created)
	}

	// 同じ対象と画面なら、色だけ上書きして同じ ID を返す
	request.Color = "#bfdbfe"
	var updated models.ColorSettingResponse
	api.do(http.MethodPut, "/api/color-settings", request).expect(http.StatusOK).decode(&updated)
	if updated.Id != created.Id || updated.Color != "#bfdbfe" {
		t.Fatalf("updated: %+v", updated)
	}
	// 画面が違えば別の設定
	request.Screen = models.ColorScreenServe
	var serve models.ColorSettingResponse
	api.do(http.MethodPut, "/api/color-settings", request).expect(http.StatusOK).decode(&serve)
	if serve.Id == created.Id {
		t.Fatal("other screen must be another setting")
	}
	// アイテムにも付けられる
	api.do(http.MethodPut, "/api/color-settings", models.ColorSettingUpsertRequest{
		TargetType: models.ColorTargetTypeItem, TargetId: m.blend.ID, Screen: models.ColorScreenCashier, Color: "#ffffff",
	}).expect(http.StatusOK)

	var settings []models.ColorSettingResponse
	api.do(http.MethodGet, "/api/color-settings", nil).expect(http.StatusOK).decode(&settings)
	if len(settings) != 3 || settings[0].TargetType != models.ColorTargetTypeItem {
		t.Fatalf("settings must be ordered by target type: %+v", settings)
	}

	// 無い対象・削除した対象・種類を取り違えた対象には付けられない
	if err := api.db.Delete(&m.iced).Error; err != nil {
		t.Fatal(err)
	}
	cases := map[string]models.ColorSettingUpsertRequest{
		"unknown target": {TargetType: models.ColorTargetTypeItem, TargetId: uuid.New(), Screen: models.ColorScreenMaster, Color: "#000000"},
		"deleted item":   {TargetType: models.ColorTargetTypeItem, TargetId: m.iced.ID, Screen: models.ColorScreenMaster, Color: "#000000"},
		"wrong type":     {TargetType: models.ColorTargetTypeItem, TargetId: m.hotType.ID, Screen: models.ColorScreenMaster, Color: "#000000"},
		"invalid color":  {TargetType: models.ColorTargetTypeItem, TargetId: m.blend.ID, Screen: models.ColorScreenMaster, Color: "red"},
	}
	for name, body := range cases {
		if res := api.do(http.MethodPut, "/api/color-settings", body); res.Code != http.StatusBadRequest {
			t.Errorf("%s: status = %d, want 400: %s", name, res.Code, res.Body)
		}
	}
	api.do(http.MethodPut, "/api/color-settings", `{`).expect(http.StatusBadRequest)
	if n := api.count(&models.ColorSetting{}, ""); n != 3 {
		t.Fatalf("%d settings", n)
	}

	api.do(http.MethodDelete, "/api/color-settings/"+serve.Id.String(), nil).expect(http.StatusNoContent)
	api.do(http.MethodDelete, "/api/color-settings/"+serve.Id.String(), nil).expect(http.StatusNotFound)
	api.do(http.MethodDelete, "/api/color-settings/abc", nil).expect(http.StatusBadRequest)
	if n := api.count(&models.ColorSetting{}, ""); n != 2 {
		t.Fatalf("%d settings", n)
	}
}
