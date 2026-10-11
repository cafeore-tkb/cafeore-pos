package handlers

import (
	"errors"
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"
)

// ハンドラで共通に使う、決まりに合わない書き込み（400）と、楽観ロックで断る書き込み（409）のエラー。

// errConflict は 409 で断るエラーの元（conflictError はこれを包む）。errors.Is で見分ける
var errConflict = errors.New("conflict")

// ruleError は決まりに合わない書き込み。理由を画面にそのまま出す（400。main の API で送られた内容がだめなときと同じ）
type ruleError struct{ message string }

func (e *ruleError) Error() string { return e.message }

func ruleErrorf(format string, args ...any) error {
	return &ruleError{message: fmt.Sprintf(format, args...)}
}

// conflictError は楽観ロックで断る理由。理由を画面にそのまま出す（409）
type conflictError struct{ message string }

func (e *conflictError) Error() string { return e.message }
func (e *conflictError) Unwrap() error { return errConflict }

func conflictErrorf(format string, args ...any) error {
	return &conflictError{message: fmt.Sprintf(format, args...)}
}

// respondError は err を応答に書き、書いたら true を返す（nil なら何もせず false）。
// ruleError は 400、errConflict は 409、それ以外は 500。
func respondError(c *gin.Context, err error) bool {
	var rule *ruleError
	switch {
	case err == nil:
		return false
	case errors.As(err, &rule):
		c.JSON(http.StatusBadRequest, gin.H{"error": rule.message})
	case errors.Is(err, errConflict):
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
	}
	return true
}
