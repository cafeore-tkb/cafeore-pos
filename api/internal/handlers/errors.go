package handlers

import (
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
)

// respondInternalError は元のエラーをサーバーのログに出し、クライアントには固定の文面だけを返す。
// DB のエラー文などの内部情報を応答に含めないためのもの。
func respondInternalError(c *gin.Context, err error) {
	log.Printf("internal error: %s %s: %v", c.Request.Method, c.FullPath(), err)
	c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal server error"})
}
