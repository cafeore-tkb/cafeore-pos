package main

import (
	"cafeore-pos/api/internal/handlers"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// ルートを登録する。
//
// openapi.yaml の全操作をここで手書きで登録する。oapi-codegen の gin サーバー
// （RegisterHandlers）は、パスの id を UUID に変換できないと独自の形の 400 を返す・
// ハンドラーの引数の形が違う・WebSocket など openapi に無いルートを扱えない、ので使わない。
// openapi.yaml との食い違いは routes_test.go で確かめる。
func registerRoutes(r gin.IRouter, db *gorm.DB, hub *handlers.Hub, inventory *handlers.Inventory) {
	item := handlers.NewItemHandler(db)
	menu := handlers.NewMenuHandler(db)
	itemType := handlers.NewItemTypeHandler(db)
	order := handlers.NewOrderHandler(db, hub, inventory)
	comment := handlers.NewCommentHandler(db, hub)
	masterState := handlers.NewMasterStateHandler(db, hub)
	cashierState := handlers.NewCashierStateHandler(db, hub)
	inv := handlers.NewInventoryHandler(inventory)
	colorSetting := handlers.NewColorSettingHandler(db)

	r.GET("/status", statusHandler)
	r.GET("/health", healthHandler)

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
