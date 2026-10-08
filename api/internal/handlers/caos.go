// api/internal/handlers/caos.go
package handlers

import (
	"errors"
	"log"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"

	"cafeore-pos/api/internal/caos"
	"cafeore-pos/api/internal/models"
)

// CaosHandler は CaOS（ドリップ管制）の盤面への操作の API。
//
// 盤面のカードと列の担当者は、注文と同じく /api/ws/orders の WebSocket で配る（{"type":"drips"}。broadcastDrips）。
// 注文の中身は既存の {"type":"orders"}・{"type":"order"} から。準備完了は、操作と同じトランザクションで
// 既存の準備完了の処理（setOrderReady。PATCH /ready と同じ切り替え）で付ける。保存と注文との連動は caos_store.go（CaosStore）。
type CaosHandler struct {
	store  *CaosStore
	orders *OrderHandler
}

func NewCaosHandler(store *CaosStore, orders *OrderHandler) *CaosHandler {
	return &CaosHandler{store: store, orders: orders}
}

// POST /api/caos/ops - 今日の盤面への操作（割当・戻す・次へ・統合・入れ直し・列の担当者の交代と入れ替え・1つ戻す）
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
	if op.Name == "rebrew" {
		// 緊急の入れ直しで積んだ緊急の印刷を、印刷する端末へ届ける
		publishPrintJobs(h.orders.db, h.orders.hub)
	}
	// 準備完了を付けた・外した注文は、POS の画面にもその注文を配る
	readied := make([]uuid.UUID, 0, len(res.Readied))
	for _, id := range res.Readied {
		readied = append(readied, uuid.MustParse(id))
	}
	h.orders.publishCaosChanges(readied)
}

// setOrderReady は CaOS が注文の準備完了を付ける・外す処理（CaOS の「次へ」「1つ戻す」・統合相手の準備完了）。
// PATCH /api/orders/{id}/ready と同じ切り替え（toggleOrderReady）を、今の状態と違うときだけ行う。注文の行をロックしてから今の状態を見る。
// 付けるとまだのカップにも同じ時刻を付け、外すとその時刻で付いたカップを外す（先に個別に付けたカップは残る）。
// 書いたときは、新しい注文の ready_at（外したときは nil）と true を返す。注文が無ければ gorm.ErrRecordNotFound。
func setOrderReady(tx *gorm.DB, orderID uuid.UUID, ready bool, now time.Time) (*time.Time, bool, error) {
	order, err := lockOrderWith(tx, orderID)
	if err != nil {
		return nil, false, err
	}
	if (order.ReadyAt != nil) == ready {
		return order.ReadyAt, false, nil
	}
	before := order
	before.OrderCups = append([]models.OrderCup(nil), order.OrderCups...)
	// DB に保存される精度にそろえておくと、記録した時刻と読み直した時刻を比べられる（「1つ戻す」の確かめ）
	toggleOrderReady(&order, now.Truncate(time.Microsecond))
	if err := saveOrderStatus(tx, &before, &order); err != nil {
		return nil, false, err
	}
	return order.ReadyAt, true, nil
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

// lockCaosForOrder は、既にある注文を書き換える前に lockCaos を呼ぶ（注文を受けた日を読んでから）。
// 注文が無ければ gorm.ErrRecordNotFound。
func (h *OrderHandler) lockCaosForOrder(tx *gorm.DB, orderID uuid.UUID) (bool, error) {
	if h.caos == nil {
		return false, nil
	}
	var order models.Order
	if err := tx.Select("id", "created_at").First(&order, "id = ?", orderID).Error; err != nil {
		return false, err
	}
	return h.lockCaos(tx, order.CreatedAt), nil
}

// syncCaos は注文の変更を CaOS の盤面に反映する。注文を書き込む tx の中で、lockCaos が取れたときだけ呼ぶ。
// それで準備完了にした注文（統合していた相手の注文）を返す。
// CaOS の処理が失敗しても注文の書き込みは止めない（savepoint まで戻してログに残すだけ）。
//
// SQL のエラーだけでなく、ロック待ちの打ち切りやデッドロックの検出も、Postgres ではその savepoint の中のエラーなので
// 戻せば注文の tx は続けられる（caos_test.go で確かめている）。接続が切れたときは、CaOS と関係なく注文自体も失敗する。
func (h *OrderHandler) syncCaos(tx *gorm.DB, refs ...caosOrderRef) []uuid.UUID {
	var readied []uuid.UUID
	if err := tx.Transaction(func(sp *gorm.DB) error {
		var err error
		readied, err = h.caos.OrdersChanged(sp, refs)
		return err
	}); err != nil {
		log.Printf("caos: failed to sync orders (the order itself is saved): %v", err)
		return nil
	}
	return readied
}

// publishCaosChanges は、注文の変更や CaOS の操作のあとに、今日のカードと、準備完了を付け外しした注文を画面へ配る。
// ほかのインスタンスにも DB の通知で知らせる（注文は publishOrder が、カードは notifyDripsChanged が送る）。
func (h *OrderHandler) publishCaosChanges(readied []uuid.UUID) {
	if h.caos != nil {
		h.broadcastDrips()
		notifyDripsChanged(h.db)
	}
	for _, id := range readied {
		if _, err := publishOrder(h.db, h.hub, id); err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			log.Printf("caos: failed to publish order %s: %v", id, err)
		}
	}
}

// notifyDripsChanged は、カードが変わったことをほかのインスタンスへ知らせる（注文の notifyOrderChanged と同じ）。
// 通知には送ったインスタンスの ID だけを載せる。受けた側は ListenChanges で受けて今日のカードを全部読み直して配る。
// 失敗しても、このインスタンスの画面にはもう配ってあるので、ログに残すだけにする。
func notifyDripsChanged(db *gorm.DB) {
	notifyChanged(db, dripsChangedChannel, instanceID)
}

// カードの配信の依頼を受けてから実際に送るまでの待ち時間。この間に来た依頼は 1 回にまとめる。
//
// カードは今日の分を全部送るので、続けて書き換えたとき（POS の注文の連動と CaOS の操作が続くときや、
// ほかのインスタンスからの通知が続くとき）の依頼を、まとめて 1 回にしている。
const dripsBroadcastDelay = 30 * time.Millisecond

// broadcastDrips は今日のカードの配信を依頼する。すぐに戻り、少し待ってから 1 回だけ送る。
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
		time.Sleep(dripsBroadcastDelay)
		select {
		case <-h.dripsRequests:
		default:
		}
		h.sendDrips()
	}
}

// 今日のカードと列の担当者を DB から読み直して WebSocket へ送る（カードが 0 枚のときは drips が省かれて届く）。
func (h *OrderHandler) sendDrips() {
	if msg, ok := h.dripsMessage(); ok {
		h.hub.Broadcast(msg)
	}
}

// 今日のカードと列の担当者（1〜6 の全部）を WSMessage にする。CaOS を使っていない・読めなかったら ok = false
func (h *OrderHandler) dripsMessage() (WSMessage, bool) {
	if h.caos == nil {
		return WSMessage{}, false
	}
	day := h.caos.Today()
	drips, err := h.caos.Drips(day)
	if err != nil {
		log.Printf("caos: failed to read the cards: %v", err)
		return WSMessage{}, false
	}
	lanes, err := h.caos.Lanes(day)
	if err != nil {
		log.Printf("caos: failed to read the lanes: %v", err)
		return WSMessage{}, false
	}
	return WSMessage{Type: WSMessageTypeDrips, Drips: drips, Lanes: lanes}, true
}
