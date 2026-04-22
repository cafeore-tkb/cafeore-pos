// api/internal/handlers/hub.go
package handlers

import (
	"log"
	"sync"

	"github.com/gorilla/websocket"
)

type Hub struct {
	clients   map[*websocket.Conn]bool
	broadcast chan WSMessage
	mu        sync.Mutex
}

func NewHub() *Hub {
	return &Hub{
		clients:   make(map[*websocket.Conn]bool),
		broadcast: make(chan WSMessage, 10),
	}
}

func (h *Hub) Run() {
	for msg := range h.broadcast {
		h.mu.Lock()
		for conn := range h.clients {
			if err := conn.WriteJSON(msg); err != nil {
				if err := conn.Close(); err != nil {
					log.Println("failed to close connection:", err)
				}
				delete(h.clients, conn)
			}
		}
		h.mu.Unlock()
	}
}

func (h *Hub) Register(conn *websocket.Conn) {
	h.mu.Lock()
	h.clients[conn] = true
	h.mu.Unlock()
}

func (h *Hub) Unregister(conn *websocket.Conn) {
	h.mu.Lock()
	delete(h.clients, conn)
	h.mu.Unlock()
}

func (h *Hub) Broadcast(msg WSMessage) {
	h.broadcast <- msg
}
