package handlers

import (
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// RegisterRoutes は API のルートを登録する。main.go も、テストで API を丸ごと立てるときもこれを呼ぶ。
//
// openapi.yaml の全操作をここで手書きで登録する（/status・/health は DB の状態と起動時に調べた
// スキーマのズレを返すので main.go が登録する）。oapi-codegen の gin サーバー
// （RegisterHandlers）は、パスの id を UUID に変換できないと独自の形の 400 を返す・
// ハンドラーの引数の形が違う・WebSocket など openapi に無いルートを扱えない、ので使わない。
// openapi.yaml との食い違いは cmd/server/routes_test.go で確かめる。
func RegisterRoutes(r gin.IRouter, db *gorm.DB, hub *Hub, inventory *Inventory) {
	item := NewItemHandler(db)
	menu := NewMenuHandler(db)
	itemType := NewItemTypeHandler(db)
	order := NewOrderHandler(db, hub, inventory)
	comment := NewCommentHandler(db, hub)
	masterState := NewMasterStateHandler(db, hub)
	cashierState := NewCashierStateHandler(db, hub)
	inv := NewInventoryHandler(inventory)
	colorSetting := NewColorSettingHandler(db)

	api := r.Group("/api")
	{
		api.GET("/items", item.GetItems)
		api.POST("/items", item.CreateItem)
		api.GET("/items/:id", item.GetItem)
		api.PUT("/items/:id", item.UpdateItem)
		api.DELETE("/items/:id", item.DeleteItem)

		api.GET("/menus", menu.GetMenus)
		api.POST("/menus", menu.CreateMenu)
		api.GET("/menus/:id", menu.GetMenu)
		api.PUT("/menus/:id", menu.UpdateMenu)
		api.DELETE("/menus/:id", menu.DeleteMenu)

		api.GET("/item-types", itemType.GetItemTypes)
		api.POST("/item-types", itemType.CreateItemType)
		api.GET("/item-types/:id", itemType.GetItemType)
		api.PUT("/item-types/:id", itemType.UpdateItemType)
		api.DELETE("/item-types/:id", itemType.DeleteItemType)

		api.GET("/orders", order.GetOrders)
		api.GET("/ws/orders", order.WSHandler)
		api.POST("/orders", order.CreateOrder)
		api.GET("/orders/:id", order.GetOrder)
		api.PUT("/orders/:id", order.UpdateOrder)
		api.DELETE("/orders/:id", order.DeleteOrder)
		api.PATCH("/orders/:id/ready", order.MarkOrderReady)
		api.PATCH("/orders/:id/served", order.MarkOrderServed)
		api.PATCH("/orders/:id/cups/:cupId/ready", order.MarkOrderCupReady)
		api.PATCH("/orders/:id/cups/:cupId/served", order.MarkOrderCupServed)

		api.GET("/orders/:id/comments", comment.GetOrderComments)
		api.POST("/orders/:id/comments", comment.CreateComment)

		api.GET("/master-status", masterState.GetMasterStatus)
		api.POST("/master-status", masterState.UpdateMasterStatus)

		api.GET("/cashier-state", cashierState.GetCashierState)
		api.PUT("/cashier-state", cashierState.UpdateCashierState)

		api.GET("/inventory", inv.GetInventory)
		api.POST("/inventory/resources", inv.CreateStockResource)
		api.PUT("/inventory/resources/:id", inv.UpdateStockResource)
		api.DELETE("/inventory/resources/:id", inv.DeleteStockResource)
		api.POST("/inventory/resources/:id/events", inv.CreateStockEvent)
		api.GET("/inventory/usages", inv.GetStockUsages)
		api.PUT("/inventory/usages", inv.ReplaceStockUsages)
		api.POST("/inventory/remind", inv.RemindInventory)
		api.GET("/color-settings", colorSetting.GetColorSettings)
		api.PUT("/color-settings", colorSetting.UpsertColorSetting)
		api.DELETE("/color-settings/:id", colorSetting.DeleteColorSetting)
	}
}
