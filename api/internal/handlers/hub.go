// api/internal/handlers/hub.go
package handlers

import (
	"cafeore-pos/api/internal/models"
	"log"
	"sync"

	"github.com/gorilla/websocket"
)

type Hub struct {
	clients   map[*websocket.Conn]bool
	broadcast chan []models.OrderResponse
	mu        sync.Mutex
}

func NewHub() *Hub {
	return &Hub{
		clients:   make(map[*websocket.Conn]bool),
		broadcast: make(chan []models.OrderResponse, 10),
	}
}

func (h *Hub) Run() {
	for orders := range h.broadcast {
		h.mu.Lock()
		for conn := range h.clients {
			if err := conn.WriteJSON(orders); err != nil {
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

func (h *Hub) Broadcast(orders []models.OrderResponse) {
	h.broadcast <- orders
}
