package handlers

import (
	"bytes"
	"crypto/sha256"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestStreamCaosExportOver32MiB(t *testing.T) {
	payload := bytes.Repeat([]byte("CaOS log export\n"), (33<<20)/15+1)
	router := gin.New()
	router.GET("/export", func(c *gin.Context) {
		c.Header("Content-Type", "application/json; charset=utf-8")
		c.Header("Content-Disposition", `attachment; filename="caos-logs-mixed.json"`)
		if err := streamCaosExport(c, bytes.NewReader(payload)); err != nil {
			t.Errorf("stream export: %v", err)
		}
	})
	server := httptest.NewServer(router)
	defer server.Close()
	response, err := server.Client().Get(server.URL + "/export")
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := response.Body.Close(); err != nil {
			t.Errorf("close export response: %v", err)
		}
	}()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", response.StatusCode)
	}
	if response.ContentLength != -1 || response.Header.Get("Content-Length") != "" {
		t.Fatal("export must not have a Content-Length")
	}
	if len(response.TransferEncoding) != 1 || response.TransferEncoding[0] != "chunked" {
		t.Fatalf("transfer encoding = %v", response.TransferEncoding)
	}
	if response.Header.Get("Content-Disposition") != `attachment; filename="caos-logs-mixed.json"` {
		t.Fatal("missing download filename")
	}
	hash := sha256.New()
	n, err := io.Copy(hash, response.Body)
	if err != nil {
		t.Fatal(err)
	}
	wantHash := sha256.Sum256(payload)
	if n != int64(len(payload)) || !bytes.Equal(hash.Sum(nil), wantHash[:]) {
		t.Fatalf("incomplete export: received %d of %d bytes", n, len(payload))
	}
}
