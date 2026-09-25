package handlers

import (
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func newTestWSServer(t *testing.T) (*Hub, string) {
	t.Helper()
	// DryRun なので DB にはつながず、初期データは空のオーダー一覧になる
	db, err := gorm.Open(postgres.New(postgres.Config{DSN: "host=localhost dbname=unused", PreferSimpleProtocol: true}), &gorm.Config{DryRun: true, DisableAutomaticPing: true})
	if err != nil {
		t.Fatal(err)
	}
	hub := NewHub()
	go hub.Run()
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/ws", NewOrderHandler(db, hub).WSHandler)
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)
	return hub, "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws"
}

func dialWS(t *testing.T, url string) *websocket.Conn {
	t.Helper()
	conn, _, err := websocket.DefaultDialer.Dial(url, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = conn.Close() })
	return conn
}

func readWS(t *testing.T, conn *websocket.Conn) WSMessage {
	t.Helper()
	if err := conn.SetReadDeadline(time.Now().Add(2 * time.Second)); err != nil {
		t.Fatal(err)
	}
	var msg WSMessage
	if err := conn.ReadJSON(&msg); err != nil {
		t.Fatal(err)
	}
	return msg
}

// 接続直後の初期データ（orders, master_state の順）を読み切る。
// DryRun の DB は空の結果を返すので、どちらも中身は空で届く
func readInitialWS(t *testing.T, conn *websocket.Conn) {
	t.Helper()
	for _, want := range []WSMessageType{WSMessageTypeOrders, WSMessageTypeMasterState} {
		if msg := readWS(t, conn); msg.Type != want {
			t.Fatalf("initial message must be %s: %+v", want, msg)
		}
	}
}

func clientCount(h *Hub) int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(h.clients)
}

func waitFor(t *testing.T, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatal("condition not met in time")
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func TestWSInitialDataGoesOnlyToNewClient(t *testing.T) {
	hub, url := newTestWSServer(t)

	first := dialWS(t, url)
	readInitialWS(t, first)
	second := dialWS(t, url)
	readInitialWS(t, second)
	waitFor(t, func() bool { return clientCount(hub) == 2 })

	// 2台目の接続で1台目へ初期データが配り直されていないこと。
	// どちらも次に届くのはこの目印のはず
	const marker WSMessageType = "test_marker"
	hub.Broadcast(WSMessage{Type: marker})
	if msg := readWS(t, first); msg.Type != marker {
		t.Fatalf("existing client got an extra message: %+v", msg)
	}
	if msg := readWS(t, second); msg.Type != marker {
		t.Fatalf("broadcast not delivered: %+v", msg)
	}
}

func TestWSDisconnectedClientIsUnregistered(t *testing.T) {
	hub, url := newTestWSServer(t)

	conn := dialWS(t, url)
	readInitialWS(t, conn)
	waitFor(t, func() bool { return clientCount(hub) == 1 })

	if err := conn.Close(); err != nil {
		t.Fatal(err)
	}
	waitFor(t, func() bool { return clientCount(hub) == 0 })
}

func TestHubDropsSlowClientWithoutBlockingOthers(t *testing.T) {
	hub := NewHub()
	go hub.Run()

	// 送信 goroutine を持たない（= 一切読み出されない）遅い端末
	slow := &Client{hub: hub, send: make(chan []byte, 1)}
	hub.add(slow)
	// 普通に読み出される端末
	fast := &Client{hub: hub, send: make(chan []byte, 1)}
	hub.add(fast)

	const n = 5
	received := make(chan struct{}, n)
	go func() {
		for range fast.send {
			received <- struct{}{}
		}
	}()

	for i := 0; i < n; i++ {
		hub.Broadcast(WSMessage{Type: WSMessageTypeOrders})
		select {
		case <-received:
		case <-time.After(2 * time.Second):
			t.Fatalf("broadcast %d was blocked by the slow client", i)
		}
	}

	hub.mu.Lock()
	_, stillRegistered := hub.clients[slow]
	hub.mu.Unlock()
	if stillRegistered {
		t.Fatal("slow client must be dropped")
	}
	// 外された端末の送信キューは閉じられ、送信 goroutine が終われるようになっている
	<-slow.send
	if _, ok := <-slow.send; ok {
		t.Fatal("send channel of dropped client must be closed")
	}

	// 外したあとの Send や Unregister で panic しない
	slow.Send(WSMessage{Type: WSMessageTypeOrders})
	hub.Unregister(slow)
}
