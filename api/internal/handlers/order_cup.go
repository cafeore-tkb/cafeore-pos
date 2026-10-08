package handlers

import (
	"sort"
	"time"

	"github.com/google/uuid"
	openapi_types "github.com/oapi-codegen/runtime/types"

	"cafeore-pos/api/internal/models"
)

// 注文明細からカップ（1杯ずつの行）を作る。
//
//   - 既存の明細（existing.OrderMenus に含まれる ID）は、保存済みのカップをそのまま引き継ぐ。
//     ID・状態・item とも変えないので、編集中にメニューの構成が変わっていても影響しない。
//   - 新しい明細は、メニューの構成品のうちカップを作る種類（item_types.makes_cup）のものを数量分に展開し、準備中のカップを作る。
//     並びは画面の getItems() と同じ展開（明細の順 → 構成品の順 → 数量）。
//   - 保存済みのカップが無い既存の明細（カップを持つ前の注文）も同じように展開し、
//     状態は注文の ready_at / served_at を写す（マイグレーションの SQL と同じ）。
//
// 並び順（Position）は、返すカップ全体で 0 から振り直す。
func buildOrderCups(orderID uuid.UUID, lines []models.OrderMenu, existing *models.Order, menus []models.Menu) []models.OrderCup {
	kept := make(map[uuid.UUID]bool, len(existing.OrderMenus))
	for _, line := range existing.OrderMenus {
		kept[line.ID] = true
	}
	cupsByLine := make(map[uuid.UUID][]models.OrderCup, len(existing.OrderMenus))
	sorted := append([]models.OrderCup(nil), existing.OrderCups...)
	sort.SliceStable(sorted, func(i, j int) bool { return sorted[i].Position < sorted[j].Position })
	for _, cup := range sorted {
		cupsByLine[cup.OrderMenuID] = append(cupsByLine[cup.OrderMenuID], cup)
	}
	menuByID := make(map[uuid.UUID]models.Menu, len(menus))
	for _, menu := range menus {
		menuByID[menu.ID] = menu
	}

	cups := []models.OrderCup{}
	for _, line := range lines {
		if kept[line.ID] && len(cupsByLine[line.ID]) > 0 {
			for _, cup := range cupsByLine[line.ID] {
				cup.Item = models.Item{} // 保存時に item を書き戻さないようにする
				cups = append(cups, cup)
			}
			continue
		}
		var readyAt, servedAt *time.Time
		if kept[line.ID] {
			readyAt, servedAt = existing.ReadyAt, existing.ServedAt
			if readyAt == nil {
				readyAt = servedAt // 提供済みのカップは必ず ready_at も持つ
			}
		}
		for _, menuItem := range menuByID[line.MenuID].MenuItems {
			if !isCupItem(menuItem.Item) {
				continue
			}
			for range menuItem.Quantity {
				cups = append(cups, models.OrderCup{
					ID: uuid.New(), OrderID: orderID, OrderMenuID: line.ID, ItemID: menuItem.ItemID,
					ReadyAt: readyAt, ServedAt: servedAt,
				})
			}
		}
	}
	for i := range cups {
		cups[i].OrderID = orderID
		cups[i].Position = i
	}
	return cups
}

// 削除済みの item（読み込めなかったもの）と、カップを作らない種類（グッズなど）の item はカップにしない。
// 種類が読み込めなかったとき（削除済みの種類）は、列の既定値と同じくカップを作るとみなす。
// 在庫の消費（inventory.go の orderItemsSQL）も、同じ決まりでカップにならないものを見分ける。
func isCupItem(item models.Item) bool {
	if item.ID == uuid.Nil || item.DeletedAt.Valid {
		return false
	}
	return item.ItemType.CreatesCup()
}

func toOrderCupResponse(cup *models.OrderCup) models.OrderCupResponse {
	return models.OrderCupResponse{
		Id:          openapi_types.UUID(cup.ID),
		OrderMenuId: openapi_types.UUID(cup.OrderMenuID),
		Item:        toItemResponse(&cup.Item),
		ReadyAt:     cup.ReadyAt,
		ServedAt:    cup.ServedAt,

		Dripper:         cup.Dripper,
		DripperPosition: cup.DripperPosition,
		DripId:          apiUUID(cup.DripID),
		BrewStartedAt:   cup.BrewStartedAt,
		BrewFinishedAt:  cup.BrewFinishedAt,

		EmergencyAt:        cup.EmergencyAt,
		EmergencyDripId:    apiUUID(cup.EmergencyDripID),
		EmergencyPrintedAt: cup.EmergencyPrintedAt,
	}
}
