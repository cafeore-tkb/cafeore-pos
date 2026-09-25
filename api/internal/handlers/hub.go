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
	// 1回の書き込みにかけてよい時間。応答しない端末で送信 goroutine が止まり続けないようにする
	wsWriteWait = 10 * time.Second
	// この間に pong（かメッセージ）が来なければ切れたとみなす
	wsPongWait = 60 * time.Second
	// ping を送る間隔。wsPongWait より短くする
	wsPingPeriod = 30 * time.Second
	// クライアントからは今は何も送られてこないので小さく抑える
	wsMaxMessageSize = 4096
	// 接続ごとの送信待ちの上限。溢れたら遅い端末とみなして切る
	wsSendBufferSize = 32
)

// Client は WebSocket の1接続。
//
// 書き込みは送信用 goroutine（writePump）だけが行い、Hub は send に積むだけにする。
// こうすると応答しない端末が1台あっても、他の端末への配信やハンドラが巻き込まれて止まらない。
type Client struct {
	hub  *Hub
	conn *websocket.Conn
	send chan []byte
}

type Hub struct {
	clients   map[*Client]struct{}
	broadcast chan WSMessage
	mu        sync.Mutex
}

func NewHub() *Hub {
	return &Hub{
		clients:   make(map[*Client]struct{}),
		broadcast: make(chan WSMessage, 10),
	}
}

func (h *Hub) Run() {
	for msg := range h.broadcast {
		data, err := json.Marshal(msg)
		if err != nil {
			log.Println("failed to encode ws message:", err)
			continue
		}
		h.mu.Lock()
		for c := range h.clients {
			h.enqueueLocked(c, data)
		}
		h.mu.Unlock()
	}
}

// Register は conn を Hub に加え、送信用 goroutine を起動する。
// 呼んだ側はそのあと ReadPump で切断まで待つ。
func (h *Hub) Register(conn *websocket.Conn) *Client {
	c := &Client{hub: h, conn: conn, send: make(chan []byte, wsSendBufferSize)}
	h.add(c)
	go c.writePump()
	return c
}

func (h *Hub) add(c *Client) {
	h.mu.Lock()
	h.clients[c] = struct{}{}
	h.mu.Unlock()
}

// Unregister は c を Hub から外す。送信用 goroutine は接続を閉じて終わる。
func (h *Hub) Unregister(c *Client) {
	h.mu.Lock()
	h.removeLocked(c)
	h.mu.Unlock()
}

func (h *Hub) Broadcast(msg WSMessage) {
	h.broadcast <- msg
}

func (h *Hub) removeLocked(c *Client) {
	if _, ok := h.clients[c]; !ok {
		return
	}
	delete(h.clients, c)
	close(c.send)
}

// 送信待ちが溢れている端末は、待たずに切る
func (h *Hub) enqueueLocked(c *Client, data []byte) {
	if _, ok := h.clients[c]; !ok {
		return
	}
	select {
	case c.send <- data:
	default:
		log.Println("ws client is too slow, disconnecting")
		h.removeLocked(c)
	}
}

// Send は msg をこの接続にだけ送る（接続直後の初期データ用）。
func (c *Client) Send(msg WSMessage) {
	data, err := json.Marshal(msg)
	if err != nil {
		log.Println("failed to encode ws message:", err)
		return
	}
	c.hub.mu.Lock()
	c.hub.enqueueLocked(c, data)
	c.hub.mu.Unlock()
}

// ReadPump は切断されるまで受信を続け、抜けたら Hub から外す。
// pong を受けるたびに読み込み期限を延ばすので、ping に応えない端末もここで抜ける。
func (c *Client) ReadPump() {
	defer c.hub.Unregister(c)

	c.conn.SetReadLimit(wsMaxMessageSize)
	extend := func() error { return c.conn.SetReadDeadline(time.Now().Add(wsPongWait)) }
	if err := extend(); err != nil {
		return
	}
	c.conn.SetPongHandler(func(string) error { return extend() })

	// クライアントからのメッセージは今は無視
	for {
		if _, _, err := c.conn.ReadMessage(); err != nil {
			return
		}
	}
}

func (c *Client) writePump() {
	ticker := time.NewTicker(wsPingPeriod)
	defer func() {
		ticker.Stop()
		// 閉じると ReadPump の ReadMessage も失敗して抜け、Hub から外れる
		if err := c.conn.Close(); err != nil {
			log.Println("failed to close connection:", err)
		}
	}()

	for {
		select {
		case data, ok := <-c.send:
			if err := c.conn.SetWriteDeadline(time.Now().Add(wsWriteWait)); err != nil {
				return
			}
			if !ok {
				// Hub から外された
				_ = c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := c.conn.WriteMessage(websocket.TextMessage, data); err != nil {
				return
			}
		case <-ticker.C:
			if err := c.conn.SetWriteDeadline(time.Now().Add(wsWriteWait)); err != nil {
				return
			}
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}
