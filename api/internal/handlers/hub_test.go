package handlers

import (
	"encoding/json"
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
	slow.SendInitial(WSMessage{Type: WSMessageTypeOrders})
	hub.Unregister(slow)
}

func TestHubHoldsBroadcastUntilInitialDataIsSent(t *testing.T) {
	hub := NewHub()
	go hub.Run()

	// Register 直後と同じ、初期データを読んでいる途中の端末
	c := &Client{hub: hub, send: make(chan []byte, wsSendBufferSize), initializing: true}
	hub.add(c)

	// 初期データを読んでいる間に来た新しい broadcast
	const marker WSMessageType = "test_marker"
	hub.Broadcast(WSMessage{Type: marker})
	waitFor(t, func() bool {
		hub.mu.Lock()
		defer hub.mu.Unlock()
		return len(c.held) == 1
	})
	if len(c.send) != 0 {
		t.Fatal("broadcast must not be sent before the initial data")
	}

	c.SendInitial(WSMessage{Type: WSMessageTypeOrders})

	// 古い初期データが先、新しい broadcast があとに届く
	for _, want := range []WSMessageType{WSMessageTypeOrders, marker} {
		var msg WSMessage
		if err := json.Unmarshal(<-c.send, &msg); err != nil {
			t.Fatal(err)
		}
		if msg.Type != want {
			t.Fatalf("want %s, got %+v", want, msg)
		}
	}
}

func TestHubKeepsClientWhenHeldBroadcastsFillTheBuffer(t *testing.T) {
	hub := NewHub()
	go hub.Run()

	// 送信 goroutine を持たない、初期データを読んでいる途中の端末
	c := newClient(hub, nil)
	hub.add(c)

	// 初期データを読んでいる間に、ためられる上限まで broadcast が来る
	for i := 0; i < wsSendBufferSize; i++ {
		hub.Broadcast(WSMessage{Type: WSMessageTypeOrders})
	}
	waitFor(t, func() bool {
		hub.mu.Lock()
		defer hub.mu.Unlock()
		return len(c.held) == wsSendBufferSize
	})

	c.SendInitial(WSMessage{Type: WSMessageTypeOrders}, WSMessage{Type: WSMessageTypeMasterState})

	hub.mu.Lock()
	_, stillRegistered := hub.clients[c]
	hub.mu.Unlock()
	if !stillRegistered {
		t.Fatal("client must not be dropped by its own initial data")
	}
	if got, want := len(c.send), wsSendBufferSize+2; got != want {
		t.Fatalf("want %d queued messages, got %d", want, got)
	}
}
