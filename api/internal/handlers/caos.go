// api/internal/handlers/caos.go
package handlers

import (
	"log"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"cafeore-pos/api/internal/caos"
)

// CaosHandler は CaOS（ドリップ管制）の盤面の API。
type CaosHandler struct {
	store  *caos.Store
	hub    *Hub
	orders *OrderHandler
}

func NewCaosHandler(store *caos.Store, hub *Hub, orders *OrderHandler) *CaosHandler {
	return &CaosHandler{store: store, hub: hub, orders: orders}
}

// GET /api/caos/boards/:day - その日の盤面（全カードと版）
//
// 読む前に、その日の注文と照らし合わせてカードをそろえる（つないだとき・読み直すときに取りこぼしがあっても追いつく）。
func (h *CaosHandler) GetBoard(c *gin.Context) {
	snap, applied, err := h.store.Load(c.Param("day"))
	if err != nil {
		caosError(c, err)
		return
	}
	c.JSON(http.StatusOK, snap)
	publishCaos(h.hub, h.orders, applied)
}

// POST /api/caos/boards/:day/ops - 盤面への操作（割当・戻す・次へ・統合・入れ直し・1つ戻す）
//
// 注文のカードが全部終わったら、同じトランザクションで注文を準備完了にする。
func (h *CaosHandler) ApplyOp(c *gin.Context) {
	var op caos.Op
	if err := c.ShouldBindJSON(&op); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	applied, err := h.store.Apply(c.Param("day"), op)
	if err != nil {
		caosError(c, err)
		return
	}
	c.JSON(http.StatusOK, applied.Result())
	publishCaos(h.hub, h.orders, applied)
}

// ルールに合わない操作は 422（理由をそのまま画面に出す）
func caosError(c *gin.Context, err error) {
	if caos.IsInvalid(err) {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error(), "code": "invalid"})
		return
	}
	log.Printf("caos: %v", err)
	c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
}

// publishCaos はコミットした盤面の変更を、このインスタンスにつないでいる画面へ配る。
// ほかのインスタンスへは DB の通知（caos_drips_changed）で版だけが届く（ListenOrderChanges）。
// 注文を準備完了にした・取り消したときは、POS の画面にも全注文を配り直す。
func publishCaos(hub *Hub, orders *OrderHandler, applied ...*caos.Applied) {
	ordersChanged := false
	for _, a := range applied {
		if a == nil || (len(a.Changed) == 0 && len(a.Deleted) == 0) {
			continue
		}
		hub.Broadcast(WSMessage{Type: WSMessageTypeDrips, Day: a.Day, Version: a.Version, Drips: a.Changed, Deleted: a.Deleted})
		ordersChanged = ordersChanged || len(a.Readied) > 0 || len(a.Unreadied) > 0
	}
	if ordersChanged && orders != nil {
		orders.broadcastOrders()
	}
}

// lockCaos は注文を書き込む前に、その注文の日の CaOS の盤面をロックする。注文を書き込む tx の最初に呼ぶ。
//
// ロックの順番を CaOS の操作（盤面 → 注文の ready_at）とそろえて、同じ注文を同時に触ったときのデッドロックを防ぐ。
// 失敗しても（CaOS の表が無い・ロック待ちの打ち切りなど）注文の書き込みは止めない。savepoint まで戻すので、取りかけたロックも残らない。
// 取れたかを返す。取れなかったときは syncCaos を呼ばないこと（注文の行を書いたあとに盤面をロックしに行くと、逆の順番になる）。
// そのときのカードのずれは、次にその日の盤面を読んだとき（GET /api/caos/boards/{day}）に直る。
func (h *OrderHandler) lockCaos(tx *gorm.DB, orderCreatedAt time.Time) bool {
	if h.caos == nil {
		return false
	}
	if err := tx.Transaction(func(sp *gorm.DB) error { return h.caos.LockBoard(sp, orderCreatedAt) }); err != nil {
		log.Printf("caos: failed to lock the board, skipped syncing the cards (the order is still saved): %v", err)
		return false
	}
	return true
}

// syncCaos は注文の変更を CaOS の盤面に反映する。注文を書き込む tx の中で呼ぶ。
// CaOS の処理が失敗しても注文の書き込みは止めない（savepoint まで戻してログに残すだけ。
// カードは次にその日の盤面を読んだときにそろう）。返した変更は、コミットのあとに publishCaos で配る。
//
// SQL のエラーだけでなく、ロック待ちの打ち切りやデッドロックの検出も、Postgres ではその savepoint の中のエラーなので
// 戻せば注文の tx は続けられる（caos_test.go で確かめている）。接続が切れたときは、CaOS と関係なく注文自体も失敗する。
func (h *OrderHandler) syncCaos(tx *gorm.DB, refs ...caos.OrderRef) []*caos.Applied {
	if h.caos == nil {
		return nil
	}
	var applied []*caos.Applied
	if err := tx.Transaction(func(sp *gorm.DB) error {
		a, err := h.caos.OrdersChanged(sp, refs)
		applied = a
		return err
	}); err != nil {
		log.Printf("caos: failed to sync orders (the order itself is saved): %v", err)
		return nil
	}
	return applied
}
