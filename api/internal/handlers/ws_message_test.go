package handlers

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"

	"cafeore-pos/api/internal/models"
)

func TestWSMessageOrderDeletedJSON(t *testing.T) {
	id := uuid.New()
	data, err := json.Marshal(WSMessage{Type: WSMessageTypeOrderDeleted, OrderID: &id})
	if err != nil {
		t.Fatal(err)
	}
	var got map[string]any
	if err := json.Unmarshal(data, &got); err != nil {
		t.Fatal(err)
	}
	if got["type"] != "order_deleted" || got["order_id"] != id.String() {
		t.Fatalf("unexpected message: %s", data)
	}
	if _, ok := got["order"]; ok {
		t.Fatalf("order must be omitted: %s", data)
	}
}

// 全注文は 0 件でも orders を空配列で送る
func TestWSMessageEmptyOrdersJSON(t *testing.T) {
	data, err := json.Marshal(WSMessage{Type: WSMessageTypeOrders, Orders: []models.OrderResponse{}})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), `"orders":[]`) {
		t.Fatalf("orders must be an empty array: %s", data)
	}
}

// 1杯の操作では、そのカップの行だけを書き換える
func TestSaveOrderStatusWritesOnlyChangedRows(t *testing.T) {
	db, err := gorm.Open(postgres.New(postgres.Config{DSN: "host=localhost dbname=unused", PreferSimpleProtocol: true}), &gorm.Config{DryRun: true, DisableAutomaticPing: true, SkipDefaultTransaction: true})
	if err != nil {
		t.Fatal(err)
	}
	var tables []string
	if err := db.Callback().Update().After("gorm:update").Register("test:count", func(tx *gorm.DB) {
		tables = append(tables, tx.Statement.Table)
	}); err != nil {
		t.Fatal(err)
	}

	order := models.Order{ID: uuid.New(), OrderCups: []models.OrderCup{
		{ID: uuid.New()}, {ID: uuid.New()}, {ID: uuid.New()},
	}}
	before := order
	before.OrderCups = append([]models.OrderCup(nil), order.OrderCups...)
	toggleCupReady(&order, &order.OrderCups[1], time.Now())

	if err := saveOrderStatus(db, &before, &order); err != nil {
		t.Fatal(err)
	}
	if len(tables) != 1 || tables[0] != "order_cups" {
		t.Fatalf("only the toggled cup must be updated, got %v", tables)
	}

	// 最後の1杯で注文の状態も変わったときは、注文も書き換える
	tables = nil
	before = order
	before.OrderCups = append([]models.OrderCup(nil), order.OrderCups...)
	toggleCupReady(&order, &order.OrderCups[0], time.Now())
	toggleCupReady(&order, &order.OrderCups[2], time.Now())
	if err := saveOrderStatus(db, &before, &order); err != nil {
		t.Fatal(err)
	}
	if strings.Join(tables, ",") != "orders,order_cups,order_cups" {
		t.Fatalf("order and two cups must be updated, got %v", tables)
	}
}
