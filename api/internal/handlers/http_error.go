package handlers

import (
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
)

// respondInternalError は 500 でエラー文を返し、同じものをサーバーのログにも残す。
// 内部の人しか使わない API なので、開発中に原因が見えるよう応答にもエラー文を載せる。
func respondInternalError(c *gin.Context, err error) {
	log.Printf("internal error: %s %s: %v", c.Request.Method, c.FullPath(), err)
	c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
}
