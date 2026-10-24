package handlers

import (
	"cafeore-pos/api/internal/auth"
	"cafeore-pos/api/internal/notify"

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
// order（DB の通知の待ち受けと Square でも使う）と square（環境変数から作る。無効なら status が
// enabled: false を返す）は main.go で作って渡す。
// authz が nil（AUTH_MODE=off）なら誰でも叩ける。
func RegisterRoutes(r gin.IRouter, authz *auth.Authorizer, db *gorm.DB, hub *Hub, inventory *Inventory, order *OrderHandler, square *SquareHandler, activities ...*notify.Activity) {
	var activity *notify.Activity
	if len(activities) > 0 {
		activity = activities[0]
	}
	item := NewItemHandler(db, activity)
	menu := NewMenuHandler(db, activity)
	itemType := NewItemTypeHandler(db, activity)
	comment := NewCommentHandler(db, hub)
	masterState := NewMasterStateHandler(db, hub, activity)
	cashierState := NewCashierStateHandler(db, hub)
	inv := NewInventoryHandler(inventory)
	colorSetting := NewColorSettingHandler(db, activity)
	printerSetting := NewPrinterSettingHandler(db)
	// 代理印刷（端末が直接刷れなかったシールを、代理印刷をオンにしたレジに刷ってもらう）
	labelPrint := NewLabelPrintHandler(db, hub)
	// CaOS（ドリップ管制）。盤面は注文のカップの列で持ち、書いた注文を今の注文の配信で配る
	caos := NewCaosHandler(db, hub, inventory)
	dataReset := NewDataResetHandler(db, hub)

	// 自前で相手を確かめるもの。Cloud Scheduler と Square は Access や IAP を通らず
	// Cloud Run に直接来る（Google の ID トークンと Webhook の署名で確かめる）。
	// /api のグループに入れると Access や IAP の JWT を求められて届かなくなる。
	r.POST("/api/inventory/remind", inv.RemindInventory)
	r.POST("/api/square/webhook", square.ReceiveWebhook)

	// GET は表示用の端末（呼び出し画面など）も、それ以外はスタッフの端末だけ。
	// 新しいルートもここに足せば、何もしなくてもこの決まりで守られる。
	api := r.Group("/api", authz.RequireByMethod())
	{
		// 呼んだ相手と権限（トップページに出す）。authz が nil でも登録する
		api.GET("/me", authz.Me)

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
		api.POST("/orders/:id/recall", order.RecallOrder)
		api.POST("/orders/:id/cancel", order.CancelOrder)
		api.POST("/orders/:id/cash-refund", order.RefundOrderCash)

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
		api.GET("/color-settings", colorSetting.GetColorSettings)
		api.PUT("/color-settings", colorSetting.UpsertColorSetting)
		api.DELETE("/color-settings/:id", colorSetting.DeleteColorSetting)
		api.PUT("/caos/cups", caos.WriteCaosCups)
		api.POST("/caos/discard", caos.DiscardCaosCups)
		api.POST("/caos/drippers/:dripper/next", caos.AdvanceCaosDripper)

		// Square は読むだけのものもスタッフだけ。決済の中身が見えるのと、
		// 表示用の端末が決済を待つことは無いので
		sq := api.Group("/square", authz.Require(auth.RoleStaff))
		sq.GET("/status", square.GetStatus)
		sq.GET("/devices", square.GetDevices)
		sq.POST("/devices", square.CreateDevice)
		sq.POST("/devices/pair", square.PairDevice)
		sq.POST("/devices/import", square.ImportDevices)
		sq.POST("/devices/:id/code", square.IssueDeviceCode)
		sq.DELETE("/devices/:id", square.DeleteDevice)
		sq.POST("/checkouts", square.CreateCheckout)
		sq.GET("/checkouts/unlinked", square.GetUnlinkedCheckouts)
		sq.GET("/checkouts/:id", square.GetCheckout)
		sq.POST("/checkouts/:id/cancel", square.CancelCheckout)
		sq.POST("/checkouts/:id/refund", square.RefundCheckout)
		sq.POST("/actions", square.CreateAction)
		sq.GET("/actions/:id", square.GetAction)
		sq.POST("/actions/:id/cancel", square.CancelAction)
		// 注文から Square の決済を返金する。POST なので RequireByMethod でスタッフだけ
		api.POST("/orders/:id/square-refund", square.RefundOrder)

		// 営業データのリセットは管理者だけ。GET も含めて、認証を掛けていない設定（off・report-only）では誰も使えない
		admin := api.Group("/admin", authz.RequireStrict(auth.RoleAdmin))
		admin.GET("/data-reset", dataReset.GetDataResetStatus)
		admin.GET("/data-reset/backup", dataReset.ExportDataResetBackup)
		admin.POST("/data-reset", dataReset.ResetData)
	}
	api.GET("/printer-settings", printerSetting.GetPrinterSettings)
	api.PUT("/printer-settings", printerSetting.UpdatePrinterSettings)
	api.POST("/label-print-requests", labelPrint.CreateLabelPrintRequest)
	api.GET("/label-print-requests", labelPrint.GetLabelPrintRequests)
	api.POST("/label-print-requests/:id/claim", labelPrint.ClaimLabelPrintRequest)
	api.POST("/label-print-requests/:id/printed", labelPrint.MarkLabelPrintRequestPrinted)
	api.POST("/label-print-requests/:id/release", labelPrint.ReleaseLabelPrintRequest)
	api.GET("/caos/logs/export", caos.ExportCaosLogs)
	api.GET("/caos/logs", caos.GetCaosLogs)
	api.POST("/caos/logs", caos.CreateCaosLogs)
	api.POST("/cup-emergencies", caos.CreateCupEmergencies)
	api.GET("/cup-emergencies/reasons", caos.GetCupEmergencyReasons)
	api.DELETE("/cup-emergencies/:id", caos.DeleteCupEmergency)
	api.PUT("/caos/lanes/:dripper", caos.PutCaosLane)
	api.POST("/caos/lanes/swap", caos.SwapCaosLanes)
	api.POST("/caos/lanes/seniors", caos.UpdateCaosLaneSeniors)
	api.POST("/orders/:id/square-refund-keep-order", square.RefundOrderKeepingOrder)
}
