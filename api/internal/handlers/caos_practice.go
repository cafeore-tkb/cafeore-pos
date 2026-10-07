package handlers

import (
	"errors"
	"log"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"cafeore-pos/api/internal/caos"
)

// CaosPracticeHandler は CaOS の練習用の盤面（実データテスト）の API。
//
// 本番の盤面と同じルールで、本番とは別の盤面を動かす（caos.PracticeStore）。本番の盤面・注文・在庫・統計には触らず、
// WebSocket でも配らない（練習している画面が、応答の盤面をそのまま使う）。
type CaosPracticeHandler struct {
	store *caos.PracticeStore
}

func NewCaosPracticeHandler(store *caos.PracticeStore) *CaosPracticeHandler {
	return &CaosPracticeHandler{store: store}
}

// 練習を始めるときに送れる大きさ（1 時間の注文で数十 KB。上限の 3000 件でも収まる）
const practiceMaxBody = 4 << 20

type practiceAdvanceRequest struct {
	At time.Time `json:"at" binding:"required"`
}

type practiceOpRequest struct {
	At time.Time `json:"at" binding:"required"`
	Op caos.Op   `json:"op"`
}

type practiceOpResponse struct {
	OpID  string             `json:"op_id"`
	State caos.PracticeState `json:"state"`
}

func (h *CaosPracticeHandler) fail(c *gin.Context, err error) {
	switch {
	case errors.Is(err, caos.ErrPracticeNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": "練習の盤面が見つかりません（終わったか、時間がたって片付けられました）"})
	case caos.IsInvalid(err):
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error(), "code": "invalid"})
	default:
		log.Printf("caos practice: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
	}
}

// POST /api/caos/practice - 練習用の盤面を作る（放置された練習の盤面は、ここで片付ける）
func (h *CaosPracticeHandler) Create(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, practiceMaxBody)
	var in caos.PracticeInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	state, err := h.store.Create(in)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, state)
}

// GET /api/caos/practice/:id - 練習用の盤面を読む（時計は進めない）
func (h *CaosPracticeHandler) Get(c *gin.Context) {
	state, err := h.store.Get(c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, state)
}

// POST /api/caos/practice/:id/advance - 練習の時計を進め、それまでに来た注文を盤面に入れる
func (h *CaosPracticeHandler) Advance(c *gin.Context) {
	var req practiceAdvanceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	state, err := h.store.Advance(c.Param("id"), req.At)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, state)
}

// POST /api/caos/practice/:id/ops - 練習の時計を進めてから、操作を 1 つ行う（本番の POST /api/caos/ops と同じ操作）
func (h *CaosPracticeHandler) ApplyOp(c *gin.Context) {
	var req practiceOpRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	opID, state, err := h.store.Apply(c.Param("id"), req.At, req.Op)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, practiceOpResponse{OpID: opID, State: state})
}

// DELETE /api/caos/practice/:id - 練習用の盤面を消す（終わった・やめたとき。無くても 204）
func (h *CaosPracticeHandler) Delete(c *gin.Context) {
	if err := h.store.Delete(c.Param("id")); err != nil {
		h.fail(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}
