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

	"cafeore-pos/api/internal/handlers"
	"cafeore-pos/api/internal/models"

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
      PrepareStmt: false,
      DisableForeignKeyConstraintWhenMigrating: true,
	})
	if err != nil {
		return fmt.Errorf("failed to open database: %w", err)
	}

	// 接続テスト
	sqlDB, err := db.DB()
	if err != nil {
		return err
	}

	if err = sqlDB.Ping(); err != nil {
		return fmt.Errorf("failed to get database connection: %w", err)
	}

	// Cloud Runの各インスタンスが使用するDB接続数を制限
	sqlDB.SetMaxOpenConns(5)
	sqlDB.SetMaxIdleConns(2)
	sqlDB.SetConnMaxLifetime(30 * time.Minute)
	sqlDB.SetConnMaxIdleTime(5 * time.Minute)

	// 起動時のDB接続確認
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := sqlDB.PingContext(ctx); err != nil {
		return fmt.Errorf("failed to ping database: %w", err)
	}

	// 環境変数がtrueの場合だけマイグレーションを実行
	if os.Getenv("RUN_MIGRATIONS") == "true" {
		err = db.AutoMigrate(
			&models.ItemType{},
			&models.Item{},
			&models.Order{},
			&models.Comment{},
			&models.OrderItem{},
			&models.MasterState{},
		)
		if err != nil {
			return fmt.Errorf("failed to migrate database: %w", err)
		}

		log.Println("Database migration completed")
	}

	log.Println("Database connected successfully")
	return nil
}

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
	// 環境変数読み込み
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
	itemTypeHandler := handlers.NewItemTypeHandler(db)
	orderHandler := handlers.NewOrderHandler(db, hub)
	commentHandler := handlers.NewCommentHandler(db, hub)
	masterStateHandler := handlers.NewMasterStateHandler(db)


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

		api.GET("/orders/:id/comments", commentHandler.GetOrderComments)
		api.POST("/orders/:id/comments", commentHandler.CreateComment)

		api.GET("/master-status", masterStateHandler.GetMasterStatus)
		api.POST("/master-status", masterStateHandler.UpdateMasterStatus)
	}

	// サーバー起動
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("  GET /status")
	log.Printf("  GET /health")
	log.Printf("  GET /api/items")
	log.Printf("  GET /api/item-types")
	log.Printf("  GET /api/orders")
	log.Printf("  GET /api/orders/:id/comments")
	log.Printf("  GET /api/ws/orders")

	server := &http.Server{
		Addr:              ":" + port,
		Handler:           r,
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		log.Printf("Server starting on :%s", port)

		if err := server.ListenAndServe(); err != nil &&
			err != http.ErrServerClosed {
			log.Fatalf("Server failed: %v", err)
		}
	}()

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

	sqlDB, err := db.DB()
	if err == nil {
		if err := sqlDB.Close(); err != nil {
			log.Printf("Failed to close database: %v", err)
		}
	}

	log.Println("Server stopped")
}
