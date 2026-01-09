// api/cmd/server/main.go
package main

import (
	"log"
	"net/http"
	"os"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/joho/godotenv"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

type Item struct {
	ID       uuid.UUID `gorm:"type:uuid;primary_key;default:uuid_generate_v4()" json:"id"`
	Name     string    `json:"name"`
	ItemType string    `gorm:"column:item_type" json:"item_type"`
}

type MenuItem struct {
	ID    uuid.UUID `gorm:"type:uuid;primary_key;default:uuid_generate_v4()" json:"id"`
	Name  string    `json:"name"`
	Price int       `json:"price"`
}

type ItemMenuItem struct {
	MenuItemID uuid.UUID `gorm:"type:uuid" json:"menu_item_id"`
	ItemID     uuid.UUID `gorm:"type:uuid" json:"item_id"`
}

type Order struct {
	ID        uuid.UUID `gorm:"type:uuid;primary_key;default:uuid_generate_v4()" json:"id"`
	OrderNum  int       `json:"order_num"`
	CreatedAt time.Time `json:"created_at"`
}

type OrderMenuItem struct {
	ID         uuid.UUID `gorm:"type:uuid;primary_key;default:uuid_generate_v4()" json:"id"`
	OrderID    uuid.UUID `gorm:"type:uuid" json:"order_id"`
	MenuItemID uuid.UUID `gorm:"type:uuid" json:"menu_item_id"`
}

type OrderWorkItem struct {
	ID              uuid.UUID `gorm:"type:uuid;primary_key;default:uuid_generate_v4()" json:"id"`
	OrderMenuItemID uuid.UUID `gorm:"type:uuid" json:"order_menu_item_id"`
	ItemID          uuid.UUID `gorm:"type:uuid" json:"item_id"`
	Status          string    `json:"status"`
	UpdatedAt       time.Time `json:"updated_at"`
}

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
	db, err = gorm.Open(postgres.Open(dsn), &gorm.Config{
		PrepareStmt: false,
	})

	// 接続テスト
	sqlDB, err := db.DB()
	if err != nil {
		return err
	}

	if err = sqlDB.Ping(); err != nil {
		return err
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

// アイテム一覧取得
func getItems(c *gin.Context) {
	var items []Item
	if err := db.Find(&items).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, items)
}

// メニューアイテム一覧取得
func getMenuItems(c *gin.Context) {
	var menuItems []MenuItem
	if err := db.Find(&menuItems).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, menuItems)
}

// 注文一覧取得
func getOrders(c *gin.Context) {
	var orders []Order
	if err := db.Order("created_at DESC").Find(&orders).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, orders)
}

// 作業アイテム一覧取得（ステータスでフィルタ可能）
func getWorkItems(c *gin.Context) {
	status := c.Query("status") // ?status=pending

	var workItems []OrderWorkItem
	query := db.Model(&OrderWorkItem{})

	if status != "" {
		query = query.Where("status = ?", status)
	}

	if err := query.Find(&workItems).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, workItems)
}

// 作業アイテムのステータス更新
func updateWorkItemStatus(c *gin.Context) {
	id := c.Param("id")

	var req struct {
		Status string `json:"status" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	result := db.Model(&OrderWorkItem{}).
		Where("id = ?", id).
		Updates(map[string]interface{}{
			"status":     req.Status,
			"updated_at": time.Now(),
		})

	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": result.Error.Error()})
		return
	}

	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "work item not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "updated successfully"})
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

	// エンドポイント
	r.GET("/status", statusHandler)
	r.GET("/health", healthHandler)

	// API エンドポイント
	api := r.Group("/api")
	{
		api.GET("/items", getItems)
		api.GET("/menu-items", getMenuItems)
		api.GET("/orders", getOrders)
		api.GET("/work-items", getWorkItems)
		api.PUT("/work-items/:id/status", updateWorkItemStatus)
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
	log.Printf("  GET  /api/menu-items")
	log.Printf("  GET  /api/orders")
	log.Printf("  GET  /api/work-items?status=pending")
	log.Printf("  PUT  /api/work-items/:id/status")

	if err := r.Run(":" + port); err != nil {
		log.Fatal(err)
	}
}
