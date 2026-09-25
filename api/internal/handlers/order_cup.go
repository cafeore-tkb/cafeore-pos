package handlers

import (
	"sort"

	"github.com/google/uuid"
	openapi_types "github.com/oapi-codegen/runtime/types"

	"cafeore-pos/api/internal/models"
)

// グッズの種類。グッズは作って出すものではないので、カップを作らない。
const goodsItemTypeName = "others"

// 注文明細からカップ（1杯ずつの行）を作る。
//
//   - 既存の明細（existingLines に含まれる ID）は、保存済みのカップをそのまま引き継ぐ。
//     ID・状態・item とも変えないので、編集中にメニューの構成が変わっていても影響しない。
//   - 新しい明細は、メニューの構成品のうちグッズ以外を数量分に展開し、準備中のカップを作る。
//     並びは画面の getItems() と同じ展開（明細の順 → 構成品の順 → 数量）。
//
// 並び順（Position）は、返すカップ全体で 0 から振り直す。
func buildOrderCups(orderID uuid.UUID, lines []models.OrderMenu, existingLines []models.OrderMenu, existingCups []models.OrderCup, menus []models.Menu) []models.OrderCup {
	kept := make(map[uuid.UUID]bool, len(existingLines))
	for _, line := range existingLines {
		kept[line.ID] = true
	}
	cupsByLine := make(map[uuid.UUID][]models.OrderCup, len(existingLines))
	sorted := append([]models.OrderCup(nil), existingCups...)
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
		if kept[line.ID] {
			for _, cup := range cupsByLine[line.ID] {
				cup.Item = models.Item{} // 保存時に item を書き戻さないようにする
				cups = append(cups, cup)
			}
			continue
		}
		for _, menuItem := range menuByID[line.MenuID].MenuItems {
			// 削除済みの item（読み込めなかったもの）とグッズはカップにしない
			if menuItem.Item.ID == uuid.Nil || menuItem.Item.ItemType.Name == goodsItemTypeName {
				continue
			}
			for range menuItem.Quantity {
				cups = append(cups, models.OrderCup{
					ID: uuid.New(), OrderID: orderID, OrderMenuID: line.ID, ItemID: menuItem.ItemID,
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

func toOrderCupResponse(cup *models.OrderCup) models.OrderCupResponse {
	return models.OrderCupResponse{
		Id:          openapi_types.UUID(cup.ID),
		OrderMenuId: openapi_types.UUID(cup.OrderMenuID),
		Item:        toItemResponse(&cup.Item),
		ReadyAt:     cup.ReadyAt,
		ServedAt:    cup.ServedAt,
	}
}
