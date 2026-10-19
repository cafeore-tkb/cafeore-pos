package handlers

import (
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"cafeore-pos/api/internal/models"
)

// 分けた注文（分割グループ）
//
// レジは 1 人の注文を注文番号ごとに分け（POST /api/orders の split_orders）、まとめて 1 回で払う。
// 1 つ目の注文が支払い（お預かり・payments・Square の決済）をまとめて持ち、2 つ目以降は split_parent_id で
// 1 つ目を指す（お預かりは 0）。作る画面には別々の注文として出るが、お金はグループで 1 つなので、
// キャンセル・現金の返金・Square の返金・削除はどの注文を指定してもグループをまとめて扱う。

// splitOrdersFromRequest は作成リクエストの分けた注文を確かめ、作る注文を返す（明細はトランザクションの中で作る）。
// 分けていなければ nil。支払いは parent がまとめて持つので payments が要る（合計は orderPaymentsFromRequest が確かめる）。
func splitOrdersFromRequest(req models.CreateOrderJSONRequestBody, parent *models.Order) ([]models.Order, error) {
	if req.SplitOrders == nil {
		return nil, nil
	}
	requests := *req.SplitOrders
	if len(requests) == 0 {
		return nil, errors.New("split_orders を空にはできません")
	}
	if req.Payments == nil {
		return nil, errors.New("split_orders を指定するときは payments も指定してください")
	}
	children := make([]models.Order, len(requests))
	for i, request := range requests {
		if len(request.MenuIds) == 0 {
			return nil, fmt.Errorf("split_orders[%d] の menu_ids が空です", i)
		}
		child := models.Order{
			ID:            uuid.New(),
			OrderId:       request.OrderId,
			CreatedAt:     parent.CreatedAt,
			BillingAmount: request.BillingAmount,
			PaymentMethod: parent.PaymentMethod,
			SplitParentID: &parent.ID,
		}
		if request.DiscountOrderId != nil {
			child.DiscountOrderId = *request.DiscountOrderId
		}
		if request.DiscountOrderCups != nil {
			child.DiscountOrderCups = *request.DiscountOrderCups
		}
		child.Comments = commentsFromRequest(request.Comments, parent.CreatedAt)
		children[i] = child
	}
	return children, nil
}

// splitPaymentsTotal は支払いの合計が届くべき額（この注文と分けた注文の請求額の合計）。
func splitPaymentsTotal(req models.CreateOrderJSONRequestBody) int {
	total := req.BillingAmount
	if req.SplitOrders != nil {
		for _, child := range *req.SplitOrders {
			total += child.BillingAmount
		}
	}
	return total
}

// commentsFromRequest は作成リクエストのコメントを作る。コメントの主キーは (order_id, created_at) なので、
// 同じ注文のコメントは 1 マイクロ秒ずつずらす（Postgres の時刻はマイクロ秒まで）。
func commentsFromRequest(requests *[]models.CommentCreateRequest, createdAt time.Time) []models.Comment {
	if requests == nil || len(*requests) == 0 {
		return nil
	}
	comments := make([]models.Comment, len(*requests))
	for i, request := range *requests {
		comments[i] = models.Comment{
			Author:    request.Author,
			Text:      request.Text,
			CreatedAt: createdAt.Add(time.Duration(i) * time.Microsecond),
		}
	}
	return comments
}

// splitGroupRoot は、その注文が入っている分割グループの 1 つ目の注文の ID（分けていなければその注文の ID）。
// 注文が無ければ gorm.ErrRecordNotFound を返す。
func splitGroupRoot(db *gorm.DB, orderID uuid.UUID) (uuid.UUID, error) {
	var order models.Order
	if err := db.Select("id", "split_parent_id").First(&order, "id = ?", orderID).Error; err != nil {
		return uuid.Nil, err
	}
	if order.SplitParentID != nil {
		return *order.SplitParentID, nil
	}
	return order.ID, nil
}

// splitGroupIDs は、その注文が入っている分割グループの注文の ID（1 つ目、続けて番号の順）。
// 分けていなければその注文だけ。注文が無ければ gorm.ErrRecordNotFound を返す。
func splitGroupIDs(db *gorm.DB, orderID uuid.UUID) ([]uuid.UUID, error) {
	root, err := splitGroupRoot(db, orderID)
	if err != nil {
		return nil, err
	}
	var children []uuid.UUID
	if err := db.Model(&models.Order{}).Where("split_parent_id = ?", root).
		Order("order_id, id").Pluck("id", &children).Error; err != nil {
		return nil, err
	}
	return append([]uuid.UUID{root}, children...), nil
}

// otherOrders は ids から orderID を除いたもの（指定した注文は応答と一緒に配る）。
func otherOrders(ids []uuid.UUID, orderID uuid.UUID) []uuid.UUID {
	others := make([]uuid.UUID, 0, len(ids))
	for _, id := range ids {
		if id != orderID {
			others = append(others, id)
		}
	}
	return others
}

// publishOrders は注文を 1 つずつ配る（分割グループのほかの注文）。消えていた注文は飛ばす。
func publishOrders(db *gorm.DB, hub *Hub, orderIDs []uuid.UUID) error {
	for _, id := range orderIDs {
		if _, err := publishOrder(db, hub, id); err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
	}
	return nil
}
