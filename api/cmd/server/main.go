// api/cmd/server/main.go
package main

import (
	"log"
	"net/http"
	"os"
	"time"

	"cafeore-pos/api/internal/handlers"
	"cafeore-pos/api/internal/models"

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

	// 接続テスト
	sqlDB, err := db.DB()
	if err != nil {
		return err
	}

	if err = sqlDB.Ping(); err != nil {
		return err
	}

    err = db.AutoMigrate(
        &models.ItemType{},
        &models.Item{},
        &models.Order{},
        &models.Comment{},
    )
    if err != nil {
        panic(err)
    }

	log.Println("Database connected successfully")
	return nil
}

func statusHandler(c *gin.Context) {
	dbStatus := "connected"

	// DB接続確認
	sqlDB, err := db.DB()
	if err != nil || sqlDB.Ping() != nil {
		dbStatus = "disconnected"
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
	var result int
	err := db.Raw("SELECT 1").Scan(&result).Error

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
	if err := godotenv.Load(); err != nil {
		log.Println("Warning: .env file not found")
	}

	// データベース初期化
	if err := initDB(); err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}

	// Ginルーター
	r := gin.Default()

	// CORS設定
	r.Use(func(c *gin.Context) {
		c.Writer.Header().Set("Access-Control-Allow-Origin", "*")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}

		c.Next()
	})

    // ハンドラー初期化
	itemHandler := handlers.NewItemHandler(db)
	itemTypeHandler := handlers.NewItemTypeHandler(db)
	orderHandler := handlers.NewOrderHandler(db)
	commentHandler := handlers.NewCommentHandler(db)

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
		api.GET("/orders", orderHandler.GetOrders)
		api.POST("/orders", orderHandler.CreateOrder)
		api.GET("/orders/:id", orderHandler.GetOrder)
		api.PUT("/orders/:id", orderHandler.UpdateOrder)
		api.DELETE("/orders/:id", orderHandler.DeleteOrder)
		api.PATCH("/orders/:id/ready", orderHandler.MarkOrderReady)
		api.PATCH("/orders/:id/served", orderHandler.MarkOrderServed)
		api.GET("/orders/:id/comments", commentHandler.GetOrderComments)
		api.POST("/orders/:id/comments", commentHandler.CreateComment)
	}

	// サーバー起動
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("Server starting on :%s", port)
	log.Printf("Endpoints:")
	log.Printf("  GET  /status")
	log.Printf("  GET  /health")
	log.Printf("  GET  /api/items")
	log.Printf("  GET  /api/item-types")
	log.Printf("  GET  /api/orders")
	log.Printf("  GET  /api/orders/:id/comments")

	if err := r.Run(":" + port); err != nil {
		log.Fatal(err)
	}
}
