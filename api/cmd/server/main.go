// api/cmd/server/main.go
package main

import (
	"log"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

type StatusResponse struct {
	Status    string    `json:"status"`
	Timestamp time.Time `json:"timestamp"`
	Version   string    `json:"version"`
}

func statusHandler(c *gin.Context) {
	response := StatusResponse{
		Status:    "ok",
		Timestamp: time.Now(),
		Version:   "1.0.0",
	}
	
	c.JSON(http.StatusOK, response)
}

func main() {
	r := gin.Default()
	
	r.GET("/status", statusHandler)
	
	port := ":8080"
	log.Printf("Server starting on %s", port)
	log.Printf("Status endpoint: http://localhost%s/status", port)
	
	if err := r.Run(port); err != nil {
		log.Fatal(err)
	}
}
