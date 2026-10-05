// api/cmd/server/main.go
package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"cafeore-pos/api/internal/auth"
	"cafeore-pos/api/internal/caos"
	"cafeore-pos/api/internal/handlers"
	"cafeore-pos/api/internal/models"
	"cafeore-pos/api/internal/notify"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

type StatusResponse struct {
	Status    string    `json:"status"`
	Timestamp time.Time `json:"timestamp"`
	Version   string    `json:"version"`
	Database  string    `json:"database"`
}

var db *gorm.DB

func initDB() error {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		log.Fatal("DATABASE_URL environment variable is not set")
	}

	var err error
	db, err = gorm.Open(
		postgres.New(postgres.Config{
			DSN:                  dsn,
			PreferSimpleProtocol: true,
		}),
		&gorm.Config{
			PrepareStmt:                              false,
			DisableForeignKeyConstraintWhenMigrating: true,
		})
	if err != nil {
		return fmt.Errorf("failed to open database: %w", err)
	}

	sqlDB, err := db.DB()
	if err != nil {
		return fmt.Errorf("failed to get database connection: %w", err)
	}

	// Cloud Run はリクエストが増えるとインスタンスを増やす。1インスタンスが
	// 際限なく接続を張ると、マネージド Postgres 側の上限にすぐ届く。
	sqlDB.SetMaxOpenConns(5)
	sqlDB.SetMaxIdleConns(2)
	sqlDB.SetConnMaxLifetime(30 * time.Minute)
	sqlDB.SetConnMaxIdleTime(5 * time.Minute)

	// 起動時の疎通確認。タイムアウトを付けないと、DB が応答しないときに
	// listen へ進めないまま Cloud Run の起動プローブが切れるのを待つことになる。
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := sqlDB.PingContext(ctx); err != nil {
		return fmt.Errorf("failed to ping database: %w", err)
	}

	// AutoMigrate は RUN_MIGRATIONS=true のときだけ走らせる。
	//
	// 本番のスキーマは手で作られている。ここで無条件に AutoMigrate を走らせて
	// 失敗すると、listen は initDB の後なのでコンテナが PORT を開けられず、
	// Cloud Run のデプロイごと落ちる。
	//
	// 逆に PR プレビューは空の Neon ブランチを使うので、走らせないと
	// テーブルが無いままになる。CI（api-build.yml）が true を渡している。
	if os.Getenv("RUN_MIGRATIONS") == "true" {
		if err := db.AutoMigrate(
			&models.ItemType{},
			&models.Item{},
			&models.Menu{},
			&models.MenuItem{},
			&models.Order{},
			&models.Comment{},
			&models.OrderMenu{},
			&models.OrderCup{},
			&models.MasterState{},
			&models.StockResource{},
			&models.ItemStockUsage{},
			&models.StockEvent{},
			&models.ColorSetting{},
			&caos.DripRow{},
			&caos.OpRow{},
		); err != nil {
			return fmt.Errorf("failed to migrate database: %w", err)
		}

		log.Println("Database migration completed")
	} else {
		// 空の DB に対して黙って起動すると、テーブルが無いまま全クエリが
		// 失敗して原因が分かりにくい。スキップしたことは必ず残す。
		log.Println("RUN_MIGRATIONS is not \"true\": skipped AutoMigrate")
	}

	log.Println("Database connected successfully")
	return nil
}

// CORS で許可する origin。FRONTEND_ORIGINS にカンマ区切りで入れる。
//
// 本番は Cloudflare Workers 上の pos / mobile。プレビューはデプロイごとに
// URL が変わって列挙できないので "*" を入れている（infra の
// cloud_run_preview.tf を参照）。未設定ならローカル開発用のポートだけ許可する。
func getAllowedOrigins() []string {
	originsEnv := os.Getenv("FRONTEND_ORIGINS")

	if originsEnv == "" {
		return []string{
			"http://localhost:5173",
			"http://localhost:3000",
		}
	}

	origins := strings.Split(originsEnv, ",")
	result := make([]string, 0, len(origins))

	for _, origin := range origins {
		origin = strings.TrimSpace(origin)
		if origin != "" {
			result = append(result, origin)
		}
	}

	return result
}

func statusHandler(c *gin.Context) {
	dbStatus := "connected"

	// DB接続確認
	sqlDB, err := db.DB()
	if err != nil {
		dbStatus = "disconnected"
	} else {
		ctx, cancel := context.WithTimeout(c.Request.Context(), 3*time.Second)
		defer cancel()

		if err := sqlDB.PingContext(ctx); err != nil {
			dbStatus = "disconnected"
		}
	}

	response := StatusResponse{
		Status:    "ok",
		Timestamp: time.Now(),
		Version:   "1.0.0",
		Database:  dbStatus,
	}

	c.JSON(http.StatusOK, response)
}

func healthHandler(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 3*time.Second)
	defer cancel()

	var result int

	err := db.WithContext(ctx).
		Raw("SELECT 1").
		Scan(&result).
		Error

	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"status": "unhealthy",
			"error":  err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"status":   "healthy",
		"database": "connected",
	})
}

func main() {
	// 環境変数読み込み。Cloud Run では環境変数がサービス側から渡るので、
	// .env を探すのはローカル（GIN_MODE が release 以外）のときだけにする。
	if os.Getenv("GIN_MODE") != "release" {
		if err := godotenv.Load(); err != nil {
			log.Println("Warning: .env file not found")
		}
	}

	// データベース初期化
	if err := initDB(); err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}

	// Ginルーター
	r := gin.Default()

	// CORS設定
	r.Use(cors.New(cors.Config{
		AllowOrigins: getAllowedOrigins(),
		AllowMethods: []string{
			"GET",
			"POST",
			"PUT",
			"PATCH",
			"DELETE",
			"OPTIONS",
		},
		AllowHeaders: []string{
			"Origin",
			"Content-Type",
			"Authorization",
		},
		ExposeHeaders: []string{
			"Content-Length",
		},
		AllowCredentials: true,
		MaxAge:           12 * time.Hour,
	}))

	hub := handlers.NewHub()
	go hub.Run()

	// ハンドラー初期化
	itemHandler := handlers.NewItemHandler(db)
	menuHandler := handlers.NewMenuHandler(db)
	itemTypeHandler := handlers.NewItemTypeHandler(db)
	// 在庫の通知先。SLACK_WEBHOOK_URL が無ければ通知せずログに残すだけ。
	//
	// 残量確認のリマインド（POST /api/inventory/remind）を叩けるのは、
	// INVENTORY_REMIND_INVOKER の SA が audience INVENTORY_REMIND_AUDIENCE で
	// 発行した Google ID トークンを持つ相手（本番の Cloud Scheduler）か、
	// X-Cron-Secret が INVENTORY_CRON_SECRET と一致する相手（ローカル・手動実行）。
	remindAuth := handlers.RemindAuth{CronSecret: os.Getenv("INVENTORY_CRON_SECRET")}
	if invoker, audience := os.Getenv("INVENTORY_REMIND_INVOKER"), os.Getenv("INVENTORY_REMIND_AUDIENCE"); invoker != "" && audience != "" {
		remindAuth.Scheduler = auth.NewGoogleIDTokenVerifier(audience, invoker)
	}
	inventory := handlers.NewInventory(
		db,
		notify.NewSlack(os.Getenv("SLACK_WEBHOOK_URL")),
		remindAuth,
		os.Getenv("POS_BASE_URL"),
	)
	inventoryHandler := handlers.NewInventoryHandler(inventory)
	// CaOS（ドリップ管制）の盤面。注文の変更を同じトランザクションでカードに反映する
	caosStore := caos.NewStore(db, handlers.SetOrderReady)
	orderHandler := handlers.NewOrderHandler(db, hub, inventory, caosStore)
	caosHandler := handlers.NewCaosHandler(caosStore, orderHandler)
	// API 以外（SQL で直接直すなど）やほかのインスタンスでの注文・CaOS のカードの変更も画面へ届けるため、DB の通知を待ち受ける。
	// LISTEN はトランザクションプーラーでは使えないので、別の接続文字列を渡せるようにしている。
	listenCtx, stopListening := context.WithCancel(context.Background())
	defer stopListening()
	listenDSN := os.Getenv("DATABASE_LISTEN_URL")
	if listenDSN == "" {
		listenDSN = os.Getenv("DATABASE_URL")
	}
	go orderHandler.ListenOrderChanges(listenCtx, listenDSN)
	commentHandler := handlers.NewCommentHandler(db, hub)
	masterStateHandler := handlers.NewMasterStateHandler(db, hub)
	colorSettingHandler := handlers.NewColorSettingHandler(db)

	// エンドポイント
	r.GET("/status", statusHandler)
	r.GET("/health", healthHandler)

	// API エンドポイント
	api := r.Group("/api")
	{
		api.GET("/items", itemHandler.GetItems)
		api.POST("/items", itemHandler.CreateItem)
		api.GET("/items/:id", itemHandler.GetItem)
		api.PUT("/items/:id", itemHandler.UpdateItem)
		api.DELETE("/items/:id", itemHandler.DeleteItem)

		api.GET("/menus", menuHandler.GetMenus)
		api.POST("/menus", menuHandler.CreateMenu)
		api.GET("/menus/:id", menuHandler.GetMenu)
		api.PUT("/menus/:id", menuHandler.UpdateMenu)
		api.DELETE("/menus/:id", menuHandler.DeleteMenu)

		api.GET("/item-types", itemTypeHandler.GetItemTypes)
		api.POST("/item-types", itemTypeHandler.CreateItemType)
		api.GET("/item-types/:id", itemTypeHandler.GetItemType)
		api.PUT("/item-types/:id", itemTypeHandler.UpdateItemType)
		api.DELETE("/item-types/:id", itemTypeHandler.DeleteItemType)

		api.GET("/orders", orderHandler.GetOrders)
		api.GET("/ws/orders", orderHandler.WSHandler)
		api.POST("/orders", orderHandler.CreateOrder)
		api.GET("/orders/:id", orderHandler.GetOrder)
		api.PUT("/orders/:id", orderHandler.UpdateOrder)
		api.DELETE("/orders/:id", orderHandler.DeleteOrder)
		api.PATCH("/orders/:id/ready", orderHandler.MarkOrderReady)
		api.PATCH("/orders/:id/served", orderHandler.MarkOrderServed)
		api.PATCH("/orders/:id/cups/:cupId/ready", orderHandler.MarkOrderCupReady)
		api.PATCH("/orders/:id/cups/:cupId/served", orderHandler.MarkOrderCupServed)

		api.GET("/orders/:id/comments", commentHandler.GetOrderComments)
		api.POST("/orders/:id/comments", commentHandler.CreateComment)

		api.POST("/caos/ops", caosHandler.ApplyOp)

		api.GET("/master-status", masterStateHandler.GetMasterStatus)
		api.POST("/master-status", masterStateHandler.UpdateMasterStatus)

		api.GET("/inventory", inventoryHandler.GetInventory)
		api.POST("/inventory/resources", inventoryHandler.CreateStockResource)
		api.PUT("/inventory/resources/:id", inventoryHandler.UpdateStockResource)
		api.DELETE("/inventory/resources/:id", inventoryHandler.DeleteStockResource)
		api.POST("/inventory/resources/:id/events", inventoryHandler.CreateStockEvent)
		api.GET("/inventory/usages", inventoryHandler.GetStockUsages)
		api.PUT("/inventory/usages", inventoryHandler.ReplaceStockUsages)
		api.POST("/inventory/remind", inventoryHandler.RemindInventory)
		api.GET("/color-settings", colorSettingHandler.GetColorSettings)
		api.PUT("/color-settings", colorSettingHandler.UpsertColorSetting)
		api.DELETE("/color-settings/:id", colorSettingHandler.DeleteColorSetting)
	}

	// サーバー起動
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("Endpoints:")
	log.Printf("  GET  /status")
	log.Printf("  GET  /health")
	log.Printf("  GET  /api/items")
	log.Printf("  GET  /api/item-types")
	log.Printf("  GET  /api/color-settings")
	log.Printf("  GET  /api/orders")
	log.Printf("  GET  /api/orders/:id/comments")
	log.Printf("  GET  /api/ws/orders")

	server := &http.Server{
		Addr:              ":" + port,
		Handler:           r,
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		log.Printf("Server starting on :%s", port)

		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server failed: %v", err)
		}
	}()

	// Cloud Run はインスタンスを畳むときに SIGTERM を送る。受けずに落とすと
	// 処理中のリクエストと WebSocket がその場で切れる。
	quit := make(chan os.Signal, 1)

	signal.Notify(
		quit,
		syscall.SIGINT,
		syscall.SIGTERM,
	)

	<-quit

	log.Println("Shutting down server...")

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := server.Shutdown(ctx); err != nil {
		log.Printf("Server forced to shutdown: %v", err)
	}

	if sqlDB, err := db.DB(); err == nil {
		if err := sqlDB.Close(); err != nil {
			log.Printf("Failed to close database: %v", err)
		}
	}

	log.Println("Server stopped")
}
