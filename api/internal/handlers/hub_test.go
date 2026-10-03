package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"

	"cafeore-pos/api/internal/models"
)

// 接続直後の全件が、その後の変更より先に、その端末にだけ届く
func TestHubSendsSnapshotOnlyToNewClientBeforeLaterBroadcasts(t *testing.T) {
	hub := NewHub()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer hub.Unregister(conn)
		if err := hub.RegisterWithSnapshot(conn, func() ([]WSMessage, error) {
			return []WSMessage{{Type: WSMessageTypeOrders}}, nil
		}); err != nil {
			return
		}
		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				return
			}
		}
	}))
	defer server.Close()
	url := "ws" + strings.TrimPrefix(server.URL, "http")

	dial := func() *websocket.Conn {
		conn, _, err := websocket.DefaultDialer.Dial(url, nil)
		if err != nil {
			t.Fatal(err)
		}
		return conn
	}
	read := func(conn *websocket.Conn) WSMessageType {
		if err := conn.SetReadDeadline(time.Now().Add(2 * time.Second)); err != nil {
			t.Fatal(err)
		}
		var msg WSMessage
		if err := conn.ReadJSON(&msg); err != nil {
			t.Fatal(err)
		}
		return msg.Type
	}

	first := dial()
	defer func() { _ = first.Close() }()
	if got := read(first); got != WSMessageTypeOrders {
		t.Fatalf("first message must be the snapshot, got %q", got)
	}
	second := dial()
	defer func() { _ = second.Close() }()
	if got := read(second); got != WSMessageTypeOrders {
		t.Fatalf("first message must be the snapshot, got %q", got)
	}

	if err := hub.Publish(func() (WSMessage, error) {
		return WSMessage{Type: WSMessageTypeOrder}, nil
	}); err != nil {
		t.Fatal(err)
	}
	// 2台目の接続で1台目に全件が送り直されていれば、ここで orders が届く
	for _, conn := range []*websocket.Conn{first, second} {
		if got := read(conn); got != WSMessageTypeOrder {
			t.Fatalf("want the changed order, got %q", got)
		}
	}
}

// 送信が詰まった端末があっても、配信は待たずにその端末を外す
func TestHubDropsClientWithFullQueue(t *testing.T) {
	hub := NewHub()
	stuck := &websocket.Conn{}
	hub.clients[stuck] = &wsClient{conn: stuck, send: make(chan []byte, 1)}
	hub.clients[stuck].send <- []byte("{}")

	done := make(chan struct{})
	go func() {
		hub.Broadcast(WSMessage{Type: WSMessageTypeOrder})
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("broadcast must not block on a stuck client")
	}
	if _, ok := hub.clients[stuck]; ok {
		t.Fatal("stuck client must be removed")
	}
}

func TestWSMessageOrderDeletedJSON(t *testing.T) {
	id := uuid.New()
	data, err := json.Marshal(WSMessage{Type: WSMessageTypeOrderDeleted, OrderID: &id})
	if err != nil {
		t.Fatal(err)
	}
	if got, want := string(data), `{"type":"order_deleted","order_id":"`+id.String()+`"}`; got != want {
		t.Fatalf("got %s, want %s", got, want)
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
