// api/cmd/server/main.go
package main

import (
	"encoding/json"
	"log"
	"net/http"
	"time"
)

type StatusResponse struct {
	Status    string    `json:"status"`
	Timestamp time.Time `json:"timestamp"`
	Version   string    `json:"version"`
}

func statusHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	
	response := StatusResponse{
		Status:    "ok",
		Timestamp: time.Now(),
		Version:   "1.0.0",
	}
	
	json.NewEncoder(w).Encode(response)
}

func main() {
	http.HandleFunc("/status", statusHandler)
	
	port := ":8080"
	log.Printf("Server starting on %s", port)
	log.Printf("Status endpoint: http://localhost%s/status", port)
	
	if err := http.ListenAndServe(port, nil); err != nil {
		log.Fatal(err)
	}
}
