package main

import (
	"cafeore-pos/api/internal/handlers"

	"github.com/gin-gonic/gin"
)

// ルートに登録するハンドラー。作るのは main で、ここでは登録だけをする。
type routeHandlers struct {
	item         *handlers.ItemHandler
	menu         *handlers.MenuHandler
	itemType     *handlers.ItemTypeHandler
	order        *handlers.OrderHandler
	comment      *handlers.CommentHandler
	masterState  *handlers.MasterStateHandler
	cashierState *handlers.CashierStateHandler
	inventory    *handlers.InventoryHandler
	colorSetting *handlers.ColorSettingHandler
}

// ルートを登録する。
//
// openapi.yaml の全操作をここで手書きで登録する。oapi-codegen の gin サーバー
// （RegisterHandlers）は、パスの id を UUID に変換できないと独自の形の 400 を返す・
// ハンドラーの引数の形が違う・WebSocket など openapi に無いルートを扱えない、ので使わない。
// openapi.yaml との食い違いは routes_test.go で確かめる。
func registerRoutes(r gin.IRouter, h routeHandlers) {
	r.GET("/status", statusHandler)
	r.GET("/health", healthHandler)

	api := r.Group("/api")
	{
		api.GET("/items", h.item.GetItems)
		api.POST("/items", h.item.CreateItem)
		api.GET("/items/:id", h.item.GetItem)
		api.PUT("/items/:id", h.item.UpdateItem)
		api.DELETE("/items/:id", h.item.DeleteItem)

		api.GET("/menus", h.menu.GetMenus)
		api.POST("/menus", h.menu.CreateMenu)
		api.GET("/menus/:id", h.menu.GetMenu)
		api.PUT("/menus/:id", h.menu.UpdateMenu)
		api.DELETE("/menus/:id", h.menu.DeleteMenu)

		api.GET("/item-types", h.itemType.GetItemTypes)
		api.POST("/item-types", h.itemType.CreateItemType)
		api.GET("/item-types/:id", h.itemType.GetItemType)
		api.PUT("/item-types/:id", h.itemType.UpdateItemType)
		api.DELETE("/item-types/:id", h.itemType.DeleteItemType)

		api.GET("/orders", h.order.GetOrders)
		api.GET("/ws/orders", h.order.WSHandler)
		api.POST("/orders", h.order.CreateOrder)
		api.GET("/orders/:id", h.order.GetOrder)
		api.PUT("/orders/:id", h.order.UpdateOrder)
		api.DELETE("/orders/:id", h.order.DeleteOrder)
		api.PATCH("/orders/:id/ready", h.order.MarkOrderReady)
		api.PATCH("/orders/:id/served", h.order.MarkOrderServed)
		api.PATCH("/orders/:id/cups/:cupId/ready", h.order.MarkOrderCupReady)
		api.PATCH("/orders/:id/cups/:cupId/served", h.order.MarkOrderCupServed)

		api.GET("/orders/:id/comments", h.comment.GetOrderComments)
		api.POST("/orders/:id/comments", h.comment.CreateComment)

		api.GET("/master-status", h.masterState.GetMasterStatus)
		api.POST("/master-status", h.masterState.UpdateMasterStatus)

		api.GET("/cashier-state", h.cashierState.GetCashierState)
		api.PUT("/cashier-state", h.cashierState.UpdateCashierState)

		api.GET("/inventory", h.inventory.GetInventory)
		api.POST("/inventory/resources", h.inventory.CreateStockResource)
		api.PUT("/inventory/resources/:id", h.inventory.UpdateStockResource)
		api.DELETE("/inventory/resources/:id", h.inventory.DeleteStockResource)
		api.POST("/inventory/resources/:id/events", h.inventory.CreateStockEvent)
		api.GET("/inventory/usages", h.inventory.GetStockUsages)
		api.PUT("/inventory/usages", h.inventory.ReplaceStockUsages)
		api.POST("/inventory/remind", h.inventory.RemindInventory)
		api.GET("/color-settings", h.colorSetting.GetColorSettings)
		api.PUT("/color-settings", h.colorSetting.UpsertColorSetting)
		api.DELETE("/color-settings/:id", h.colorSetting.DeleteColorSetting)
	}
}
