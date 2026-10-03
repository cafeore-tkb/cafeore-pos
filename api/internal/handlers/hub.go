// api/internal/handlers/hub.go
package handlers

import (
	"encoding/json"
	"log"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const (
	// 書き込みがこれより長くかかる端末は切断する（スリープした端末などで配信全体が止まらないように）
	wsWriteTimeout = 5 * time.Second
	// 送れずに溜まったメッセージがこれを超えた端末も切断する。再接続すれば全件を受け取り直す
	wsSendBuffer = 64
)

type wsClient struct {
	conn *websocket.Conn
	send chan []byte
}

// 端末ごとに送信用のキューと goroutine を持ち、遅い端末が他の端末への配信を待たせないようにする。
type Hub struct {
	clients map[*websocket.Conn]*wsClient
	mu      sync.Mutex

	// 注文の読み込みから配信までを1つずつ行う。
	// 読んだ順に配信されるので、後から届いた配信が古い状態で上書きすることがない。
	publishMu sync.Mutex
}

func NewHub() *Hub {
	return &Hub{
		clients: make(map[*websocket.Conn]*wsClient),
	}
}

func (h *Hub) Register(conn *websocket.Conn) {
	client := &wsClient{conn: conn, send: make(chan []byte, wsSendBuffer)}
	h.mu.Lock()
	h.clients[conn] = client
	h.mu.Unlock()
	go client.writePump()
}

func (h *Hub) Unregister(conn *websocket.Conn) {
	h.mu.Lock()
	h.removeLocked(conn)
	h.mu.Unlock()
}

// h.mu を持った状態で呼ぶ
func (h *Hub) removeLocked(conn *websocket.Conn) {
	client, ok := h.clients[conn]
	if !ok {
		return
	}
	delete(h.clients, conn)
	close(client.send)
}

func (h *Hub) Broadcast(msg WSMessage) {
	data, err := json.Marshal(msg)
	if err != nil {
		log.Println("failed to marshal ws message:", err)
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	for conn, client := range h.clients {
		h.enqueueLocked(conn, client, data)
	}
}

// 1つの端末にだけ送る（接続直後の全件など）
func (h *Hub) SendTo(conn *websocket.Conn, msg WSMessage) {
	data, err := json.Marshal(msg)
	if err != nil {
		log.Println("failed to marshal ws message:", err)
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	if client, ok := h.clients[conn]; ok {
		h.enqueueLocked(conn, client, data)
	}
}

func (h *Hub) enqueueLocked(conn *websocket.Conn, client *wsClient, data []byte) {
	select {
	case client.send <- data:
	default:
		log.Println("ws client is too slow, disconnecting")
		h.removeLocked(conn)
	}
}

// load で最新の状態を読み、そのまま配信する。読み込みと配信の順番が入れ替わらないよう1つずつ行う。
func (h *Hub) Publish(load func() (WSMessage, error)) error {
	h.publishMu.Lock()
	defer h.publishMu.Unlock()
	msg, err := load()
	if err != nil {
		return err
	}
	h.Broadcast(msg)
	return nil
}

// 端末を登録し、その端末にだけ現在の状態を送る。
// Publish と順番をそろえるので、登録後の変更を取りこぼしたり古い全件で上書きしたりしない。
func (h *Hub) RegisterWithSnapshot(conn *websocket.Conn, load func() ([]WSMessage, error)) error {
	h.publishMu.Lock()
	defer h.publishMu.Unlock()
	h.Register(conn)
	msgs, err := load()
	if err != nil {
		return err
	}
	for _, msg := range msgs {
		h.SendTo(conn, msg)
	}
	return nil
}

func (c *wsClient) writePump() {
	for data := range c.send {
		if err := c.conn.SetWriteDeadline(time.Now().Add(wsWriteTimeout)); err != nil {
			break
		}
		if err := c.conn.WriteMessage(websocket.TextMessage, data); err != nil {
			break
		}
	}
	// 書き込めなくなったら接続を閉じる。読み込み側（WSHandler）が抜けて Unregister される
	if err := c.conn.Close(); err != nil {
		log.Println("failed to close connection:", err)
	}
	// キューが閉じられていなければ、閉じられるまで捨てて Unregister を待つ
	for range c.send {
	}
}
