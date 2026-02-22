// api/internal/handlers/orders.go
package handlers

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	openapi_types "github.com/oapi-codegen/runtime/types"
	"gorm.io/gorm"

	"cafeore-pos/api/internal/models"
)

type OrderHandler struct {
	db *gorm.DB
}

func NewOrderHandler(db *gorm.DB) *OrderHandler {
	return &OrderHandler{db: db}
}

// DB models → API models 変換関数
func toOrderResponse(order *models.Order) models.OrderResponse {
	resp := models.OrderResponse{
		Id:                openapi_types.UUID(order.ID),
		OrderId:           order.OrderId,
		CreatedAt:         order.CreatedAt,
		ReadyAt:           order.ReadyAt,
		ServedAt:          order.ServedAt,
		BillingAmount:     order.BillingAmount,
		Received:          order.Received,
		DiscountOrderId:   (*openapi_types.UUID)(&order.DiscountOrderId),
		DiscountOrderCups: &order.DiscountOrderCups,
	}
	// Items変換
	if len(order.OrderItems) > 0 {
		items := make([]models.ItemInfo, 0, len(order.OrderItems))
		for _, oi := range order.OrderItems {
			itemInfo := models.ItemInfo{Assignee: oi.Assignee, Item: toItemResponse(&oi.Item)} 
			items = append(items, itemInfo)
		}
		resp.Items = items
	}
	// Comments変換
	if len(order.Comments) > 0 {
		comments := make([]models.CommentResponse, len(order.Comments))
		for i, comment := range order.Comments {
			comments[i] = toCommentResponse(&comment)
		}
		resp.Comments = &comments
	}

	return resp
}

// GET /api/orders - オーダー一覧取得
func (h *OrderHandler) GetOrders(c *gin.Context) {
	var orders []models.Order
	if err := h.db.Preload("OrderItems.Item.ItemType").Preload("Comments").Find(&orders).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// API型に変換
	responses := make([]models.OrderResponse, len(orders))
	for i, order := range orders {
		responses[i] = toOrderResponse(&order)
	}

	c.JSON(http.StatusOK, responses)
}

// POST /api/orders - オーダー作成
func (h *OrderHandler) CreateOrder(c *gin.Context) {
	var req models.CreateOrderJSONRequestBody

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// API型 → DB型に変換
	order := models.Order{
		OrderId:           req.OrderId,
		CreatedAt:         time.Now(),
		BillingAmount:     req.BillingAmount,
		Received:          req.Received,
		DiscountOrderCups: 0,
	}

	if req.DiscountOrderId != nil {
		u, err := uuid.Parse(req.DiscountOrderId.String())
			if err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid discount_order_id"})
				return
			}
        order.DiscountOrderId = u
	}

	if req.DiscountOrderCups != nil {
		order.DiscountOrderCups = *req.DiscountOrderCups
	}

	// コメントの作成
	if req.Comments != nil && len(*req.Comments) > 0 {
		comments := make([]models.Comment, len(*req.Comments))
		for i, commentReq := range *req.Comments {
			comments[i] = models.Comment{
				Author:    commentReq.Author,
				Text:      commentReq.Text,
				CreatedAt: time.Now(),
			}
		}
		order.Comments = comments
	}

	// Orederを先に作る
	if err := h.db.Create(&order).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if len(req.ItemIds) == 0 {
    c.JSON(http.StatusBadRequest, gin.H{"error": "item_ids is required"})
    return
	}

	// ItemIDを収集
	itemIDs := make([]uuid.UUID, 0, len(req.ItemIds))
	for _, itemInfo := range req.ItemIds {
    u, err := uuid.Parse(itemInfo.ItemId.String())
    if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid item_id"})
			return
    }
    itemIDs = append(itemIDs, u)
	}

	// アイテムの存在確認（重複を除いてユニークなIDのみチェック）
	uniqueItemIDs := make(map[uuid.UUID]bool)
	for _, id := range itemIDs {
    uniqueItemIDs[id] = true
	}

	var items []models.Item
	if err := h.db.Where("id IN ?", itemIDs).Find(&items).Error; err != nil {
    c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid item IDs"})
    return
	}
	if len(items) != len(uniqueItemIDs) {
    c.JSON(http.StatusBadRequest, gin.H{"error": "Some item IDs not found"})
    return
	}
	// OrderItemを作成
	orderItems := make([]models.OrderItem, 0, len(req.ItemIds))
	for _, itemInfo := range req.ItemIds {
    itemID, _ := uuid.Parse(itemInfo.ItemId.String())  
    orderItems = append(orderItems, models.OrderItem{
			OrderID:  order.ID,
			ItemID:   itemID,
			Assignee: itemInfo.Assignee,
    })
	}

	// OrderItemsを一括作成
	if len(orderItems) > 0 {
    if err := h.db.Create(&orderItems).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
    }
	}

	// 関連データをロード
	var loaded models.Order
	if err := h.db.
		Preload("OrderItems.Item.ItemType").
		Preload("Comments").
		First(&loaded, "id = ?", order.ID).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
    }

	c.JSON(http.StatusCreated, toOrderResponse(&loaded))
}

// GET /api/orders/:id - オーダー取得
func (h *OrderHandler) GetOrder(c *gin.Context) {
	id := c.Param("id")

	orderID, err := uuid.Parse(id)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid ID format"})
		return
	}

	var order models.Order
	if err := h.db.Preload("OrderItems.Item.ItemType").Preload("Comments").First(&order, "id = ?", orderID).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Order not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, toOrderResponse(&order))
}

// PUT /api/orders/:id - オーダー更新
func (h *OrderHandler) UpdateOrder(c *gin.Context) {
	id := c.Param("id")

	orderID, err := uuid.Parse(id)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid ID format"})
		return
	}

	var req models.UpdateOrderJSONRequestBody

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var order models.Order
	if err := h.db.Preload("OrderItems.Item").First(&order, "id = ?", orderID).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Order not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// // 更新
	// order.OrderId = req.OrderId
	// order.ReadyAt = req.ReadyAt
	// order.ServedAt = req.ServedAt
	// order.BillingAmount = req.BillingAmount
	// order.Received = req.Received

	// if req.DiscountOrderId != nil {
	// 	order.DiscountOrderId, _ = uuid.Parse(req.DiscountOrderId.String())
	// }

	// if req.DiscountOrderCups != nil {
	// 	order.DiscountOrderCups = *req.DiscountOrderCups
	// }
	// // コメントの追加はここではしない（POST orders/:id/comments）

	// // ---- ここからトランザクション（注文と明細を同時に整合させる）----
	// err = h.db.Transaction(func(tx *gorm.DB) error {
	// 	if err := tx.Model(&order).Updates(map[string]any{
	// 		"order_id":            order.OrderId,
	// 		"ready_at":            order.ReadyAt,
	// 		"served_at":           order.ServedAt,
	// 		"billing_amount":      order.BillingAmount,
	// 		"received":            order.Received,
	// 		"discount_order_id":   order.DiscountOrderId,
	// 		"discount_order_cups": order.DiscountOrderCups,
	// 	}).Error; err != nil {
	// 		return err
	// 	}
	// 	// item_ids -> qtyMap
	// 	qtyMap := map[uuid.UUID]int{}
	// 	for _, id := range req.ItemIds {
	// 		u, err := uuid.Parse(id.String())
	// 		if err != nil {
	// 			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid item_id"})
	// 			return err
	// 		}
	// 		qtyMap[u]++
	// 	}

	// 	// 既存明細は一旦全部消す（PUTは置換）
	// 	if err := tx.Where("order_id = ?", order.ID).Delete(&models.OrderItem{}).Error; err != nil {
	// 		return err
	// 	}

	// 	// item が空なら明細なしで終了
	// 	if len(qtyMap) == 0 {
	// 			return nil
	// 	}

	// 	// Item をまとめて取得
	// 	itemIDs := make([]uuid.UUID, 0, len(qtyMap))
	// 	for id := range qtyMap {
	// 		itemIDs = append(itemIDs, id)
	// 	}
	// 	var items []models.Item
	// 	if err := h.db.Where("id IN ?", itemIDs).Find(&items).Error; err != nil {
	// 		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid item IDs"})
	// 		return err
	// 	}
	// 	if len(items) != len(itemIDs) {
	// 		c.JSON(http.StatusBadRequest, gin.H{"error": "Some item IDs not found"})
	// 		return err
	// 	}

  //   	// 新しい明細を作成
	// 		orderItems := make([]models.OrderItem, 0, len(items))
	// 		for _, it := range items {
	// 			orderItems = append(orderItems, models.OrderItem{
	// 			OrderID: order.ID,
	// 			ItemID:  it.ID,
	// 			Qty:     qtyMap[it.ID],
	// 			})
	// 		}
  //   	if err := tx.Create(&orderItems).Error; err != nil {
	// 			return err
	// 		}
	// 		return nil
	// })

	// if err != nil {
	// 	// Transaction 内で fmt.Errorf したものはここに来る
	// 	msg := err.Error()
	// 	if msg == "Invalid item_id" || msg == "Some item IDs not found" {
	// 		c.JSON(http.StatusBadRequest, gin.H{"error": msg})
	// 		return
	// 	}
	// 	c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
	// 	return
	// }
	// // ---- トランザクションここまで ----

	// // 更新後のデータをロード
	// var loaded models.Order
	// if err := h.db.
	// 	Preload("OrderItems.Item.ItemType").
	// 	Preload("Comments").
	// 	First(&loaded, "id = ?", order.ID).Error; err != nil {
	// 		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
	// 		return
  //   }

	c.JSON(http.StatusOK, toOrderResponse(&order))
}

// DELETE /api/orders/:id - オーダー削除
func (h *OrderHandler) DeleteOrder(c *gin.Context) {
	id := c.Param("id")

	orderID, err := uuid.Parse(id)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid ID format"})
		return
	}

	// オーダーアイテムの関連も削除
	var order models.Order
	if err := h.db.Preload("OrderItems.Item").First(&order, "id = ?", orderID).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Order not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// many2many の関連を削除
	if err := h.db.Model(&order).Association("Items").Clear(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// オーダーを削除
	result := h.db.Delete(&models.Order{}, "id = ?", orderID)
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": result.Error.Error()})
		return
	}

	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Order not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Order deleted successfully"})
}

// PATCH /api/orders/:id/ready - オーダーを準備完了にする
func (h *OrderHandler) MarkOrderReady(c *gin.Context) {
	id := c.Param("id")

	orderID, err := uuid.Parse(id)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid ID format"})
		return
	}

	var order models.Order
	if err := h.db.First(&order, "id = ?", orderID).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Order not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	now := time.Now()
	order.ReadyAt = &now

	if err := h.db.Save(&order).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, toOrderResponse(&order))
}

// PATCH /api/orders/:id/served - オーダーを提供済みにする
func (h *OrderHandler) MarkOrderServed(c *gin.Context) {
	id := c.Param("id")

	orderID, err := uuid.Parse(id)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid ID format"})
		return
	}

	var order models.Order
	if err := h.db.First(&order, "id = ?", orderID).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Order not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	now := time.Now()
	order.ServedAt = &now

	if err := h.db.Save(&order).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, toOrderResponse(&order))
}
