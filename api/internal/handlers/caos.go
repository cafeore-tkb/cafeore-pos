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

// CaosHandler は CaOS（ドリップ管制）の盤面への操作の API。
//
// 盤面のカードは、注文と同じく /api/ws/orders の WebSocket で配る（{"type":"drips"}。broadcastDrips）。
// 注文の中身は既存の {"type":"orders"} から。準備完了は、操作と同じトランザクションで既存の準備完了の処理（SetOrderReady）で付ける。
type CaosHandler struct {
	store  *caos.Store
	orders *OrderHandler
}

func NewCaosHandler(store *caos.Store, orders *OrderHandler) *CaosHandler {
	return &CaosHandler{store: store, orders: orders}
}

// POST /api/caos/ops - 今日の盤面への操作（割当・戻す・次へ・統合・入れ直し・1つ戻す）
//
// 「次へ」で注文のカードが全部終わったら、同じトランザクションで準備完了にする（結果の readied）。
// 「1つ戻す」（undo）は、操作の結果の op_id を指定し、サーバーが残した操作の記録で戻す。
func (h *CaosHandler) ApplyOp(c *gin.Context) {
	var op caos.Op
	if err := c.ShouldBindJSON(&op); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	res, err := h.store.Apply(op)
	if err != nil {
		if caos.IsInvalid(err) {
			// ルールに合わない操作は 422（理由をそのまま画面に出す）
			c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error(), "code": "invalid"})
			return
		}
		log.Printf("caos: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, res)
	h.orders.broadcastDrips()
	// 準備完了を付けた・外した注文があれば、POS の画面にも配り直す
	if len(res.Readied) > 0 {
		h.orders.broadcastOrders()
	}
}

// lockCaos は注文を書き込む前に、その注文の日の CaOS の盤面をロックする。注文を書き込む tx の最初に呼ぶ。
//
// ロックの順番を CaOS の操作（盤面 → 注文）とそろえて、同じ注文を同時に触ったときのデッドロックを防ぐ。
// 失敗しても（CaOS の表が無い・ロック待ちの打ち切りなど）注文の書き込みは止めない。savepoint まで戻すので、取りかけたロックも残らない。
// 取れたかを返す。取れなかったときは syncCaos を呼ばないこと（注文の行を書いたあとに盤面をロックしに行くと、逆の順番になる）。
// そのときのカードのずれは、次に CaOS で操作したときに直る（操作の前にその日の注文と照らし合わせる）。
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

// syncCaos は注文の変更を CaOS の盤面に反映する。注文を書き込む tx の中で、lockCaos が取れたときだけ呼ぶ。
// CaOS の処理が失敗しても注文の書き込みは止めない（savepoint まで戻してログに残すだけ）。
//
// SQL のエラーだけでなく、ロック待ちの打ち切りやデッドロックの検出も、Postgres ではその savepoint の中のエラーなので
// 戻せば注文の tx は続けられる（caos_test.go で確かめている）。接続が切れたときは、CaOS と関係なく注文自体も失敗する。
func (h *OrderHandler) syncCaos(tx *gorm.DB, refs ...caos.OrderRef) {
	if err := tx.Transaction(func(sp *gorm.DB) error { return h.caos.OrdersChanged(sp, refs) }); err != nil {
		log.Printf("caos: failed to sync orders (the order itself is saved): %v", err)
	}
}

// broadcastDrips は今日のカードの配信を依頼する。すぐに戻り、少し待ってから 1 回だけ送る（broadcastOrders と同じ）。
// API で書き換えると、ハンドラー自身と DB の caos_drips_changed 通知（ListenOrderChanges）の両方から依頼が来る。
func (h *OrderHandler) broadcastDrips() {
	if h.caos == nil {
		return
	}
	select {
	case h.dripsRequests <- struct{}{}:
	default:
		// 既に依頼が溜まっている。その配信に今の状態も含まれる
	}
}

func (h *OrderHandler) runDripsBroadcaster() {
	for range h.dripsRequests {
		time.Sleep(orderBroadcastDelay)
		select {
		case <-h.dripsRequests:
		default:
		}
		h.sendDrips()
	}
}

// 今日のカードを DB から読み直して WebSocket へ送る（カードが 0 枚のときは drips が省かれて届く）。
func (h *OrderHandler) sendDrips() {
	if msg, ok := h.dripsMessage(); ok {
		h.hub.Broadcast(msg)
	}
}

// 今日のカードを WSMessage にする。CaOS を使っていない・読めなかったら ok = false
func (h *OrderHandler) dripsMessage() (WSMessage, bool) {
	if h.caos == nil {
		return WSMessage{}, false
	}
	drips, err := h.caos.Drips(h.caos.Today())
	if err != nil {
		log.Printf("caos: failed to read the cards: %v", err)
		return WSMessage{}, false
	}
	return WSMessage{Type: WSMessageTypeDrips, Drips: drips}, true
}
