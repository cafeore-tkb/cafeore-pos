// api/internal/handlers/order_listener.go
package handlers

import (
	"context"
	"errors"
	"log"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"gorm.io/gorm"
)

// 注文が変わったことをインスタンス同士で知らせる DB の通知チャンネル。
const ordersChangedChannel = "orders_changed"

// このプロセスの ID。自分が送った通知を、自分で受けて配り直さないために使う。
var instanceID = uuid.NewString()

// 待ち受けを始めたときに自分宛てに送る、通知が届くかの確認の接頭辞。
// 注文の通知とは別物なので、受けても配信はしない。
const listenProbePrefix = "probe "

// 確認の通知がこの時間内に届かなければ、通知が届かない設定だとみなして警告する。
const listenProbeTimeout = 10 * time.Second

// 通知がこの時間来なければ、待ち受けの接続が生きているかを確かめる。
// Cloud Run は画面がつないでいないインスタンスの CPU を絞るので、その間に接続が
// 黙って切れていることがある。画面がつないで CPU が戻ったら、この確認で気づいて張り直す。
const listenPingInterval = 30 * time.Second

// notifyOrderChanged は、注文が変わったことをほかのインスタンスへ知らせる。
//
// Cloud Run のインスタンスはそれぞれ自分につないでいる画面にしか配れないので、
// 注文を書き換えたインスタンスが DB の通知を送り、ほかのインスタンスが
// ListenOrderChanges で受けて自分の画面へ配る。DB のトリガーは使わない
// （スキーマは Go のモデルだけで決める。README の「DB のスキーマ」を参照）。
//
// 通知に失敗しても、このインスタンスの画面にはもう配ってあるので、ログに残すだけにする。
// ほかのインスタンスの画面は、つなぎ直したときに全注文を受け取って追いつく。
func notifyOrderChanged(db *gorm.DB, orderID uuid.UUID) {
	payload := instanceID + " " + orderID.String()
	if err := db.Exec("SELECT pg_notify(?, ?)", ordersChangedChannel, payload).Error; err != nil {
		log.Printf("failed to notify %s for order %s: %v", ordersChangedChannel, orderID, err)
	}
}

// ListenOrderChanges は、ほかのインスタンスで注文が変わるたびに、その注文を読み直して配信する。
//
// 自分が送った通知は無視する（書き換えたときに配信済み）。ほかのインスタンスから届いたものは
// このインスタンスの画面へだけ配り、通知を送り返さない。
//
// 通知の受信と配信は別の goroutine で行う。DB の読み直しが遅くても受信は止めず、
// 配り終わるまでに同じ注文の通知が重なったら 1 回の読み直しにまとめる。
//
// LISTEN はセッションを保ったまま待つので、Supabase のトランザクションプーラー
// （ポート 6543）経由では通知が届かない。直接接続かセッションプーラーの接続文字列を渡すこと。
// 切れたら間隔を空けてつなぎ直す。ctx が終わると戻る。
func (h *OrderHandler) ListenOrderChanges(ctx context.Context, dsn string) {
	changes := newOrderChanges()
	go h.publishOrderChanges(ctx, changes)

	retryDelay := time.Second
	for {
		err := h.listenOrderChangesOnce(ctx, dsn, changes, func() { retryDelay = time.Second })
		if ctx.Err() != nil {
			return
		}
		log.Printf("orders_changed listener stopped, retrying in %s: %v", retryDelay, err)
		select {
		case <-ctx.Done():
			return
		case <-time.After(retryDelay):
		}
		retryDelay = min(retryDelay*2, 30*time.Second)
	}
}

func (h *OrderHandler) listenOrderChangesOnce(ctx context.Context, dsn string, changes *orderChanges, onListening func()) error {
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		return err
	}
	defer func() {
		closeCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = conn.Close(closeCtx)
	}()

	if _, err := conn.Exec(ctx, "LISTEN "+ordersChangedChannel); err != nil {
		return err
	}
	onListening()
	log.Printf("listening for %s", ordersChangedChannel)

	// トランザクションプーラー（Supabase の 6543 や Neon の -pooler）経由だと、LISTEN は
	// エラーにならないのに通知だけが届かない。注文の通知と同じ経路（h.db）で自分宛てに
	// 確認の通知を送り、届かなければ警告して設定ミスに気づけるようにする。
	connCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	probe := listenProbePrefix + instanceID + " " + uuid.NewString()
	var probed atomic.Bool
	go func() {
		select {
		case <-connCtx.Done():
		case <-time.After(listenProbeTimeout):
			if !probed.Load() {
				log.Printf("WARNING: %s の確認の通知が %s 待っても届かない。ほかのインスタンスの注文の変更が配られない。"+
					"DATABASE_LISTEN_URL（無ければ DATABASE_URL）がトランザクションプーラーを指していないか確かめること",
					ordersChangedChannel, listenProbeTimeout)
			}
		}
	}()
	if err := h.db.Exec("SELECT pg_notify(?, ?)", ordersChangedChannel, probe).Error; err != nil {
		log.Printf("failed to send %s probe: %v", ordersChangedChannel, err)
	}

	// 待ち受けていなかった間の変更を取りこぼさないよう、つないだ時点で全注文を配り直す
	changes.addAll()
	for {
		waitCtx, cancelWait := context.WithTimeout(ctx, listenPingInterval)
		n, err := conn.WaitForNotification(waitCtx)
		cancelWait()
		if err != nil {
			if ctx.Err() != nil || !errors.Is(err, context.DeadlineExceeded) {
				return err
			}
			// しばらく通知が無い。接続が生きているかを確かめ、切れていれば張り直す
			pingCtx, cancelPing := context.WithTimeout(ctx, 5*time.Second)
			err = conn.Ping(pingCtx)
			cancelPing()
			if err != nil {
				return err
			}
			continue
		}
		switch {
		case n.Payload == probe:
			probed.Store(true)
			log.Printf("%s: notifications are delivered", ordersChangedChannel)
		case strings.HasPrefix(n.Payload, listenProbePrefix):
			// ほかのインスタンスの確認の通知
		default:
			changes.addPayload(n.Payload)
		}
	}
}

// 受けたけれどまだ配っていない注文の変更。同じ注文の通知が重なれば 1 つにまとめる。
type orderChanges struct {
	mu   sync.Mutex
	ids  map[uuid.UUID]struct{}
	all  bool
	wake chan struct{}
}

func newOrderChanges() *orderChanges {
	return &orderChanges{ids: map[uuid.UUID]struct{}{}, wake: make(chan struct{}, 1)}
}

// 通知（"<送ったインスタンスの ID> <注文 ID>"）を積む。自分が送ったものは積まない。
// 形の分からない通知は、何が変わったか分からないので全注文を配り直す。
func (q *orderChanges) addPayload(payload string) {
	sender, rawOrderID, ok := strings.Cut(payload, " ")
	if ok && sender == instanceID {
		return
	}
	orderID, err := uuid.Parse(rawOrderID)
	if !ok || err != nil {
		q.addAll()
		return
	}
	q.mu.Lock()
	q.ids[orderID] = struct{}{}
	q.mu.Unlock()
	q.notify()
}

func (q *orderChanges) addAll() {
	q.mu.Lock()
	q.all = true
	q.mu.Unlock()
	q.notify()
}

func (q *orderChanges) notify() {
	select {
	case q.wake <- struct{}{}:
	default:
	}
}

// 積まれた変更を取り出して空にする。all なら全注文を配り直せばよいので、ids は返さない。
func (q *orderChanges) take() (ids []uuid.UUID, all bool) {
	q.mu.Lock()
	defer q.mu.Unlock()
	all = q.all
	if !all {
		ids = make([]uuid.UUID, 0, len(q.ids))
		for id := range q.ids {
			ids = append(ids, id)
		}
	}
	q.ids = map[uuid.UUID]struct{}{}
	q.all = false
	return ids, all
}

// 積まれた変更を、注文を読み直して配信する。ctx が終わると戻る。
func (h *OrderHandler) publishOrderChanges(ctx context.Context, changes *orderChanges) {
	for {
		select {
		case <-ctx.Done():
			return
		case <-changes.wake:
		}
		ids, all := changes.take()
		if all {
			h.publishAllOrders()
			continue
		}
		for _, id := range ids {
			h.publishChangedOrder(id)
		}
	}
}

// ほかのインスタンスで変わった注文を読み直して配信する。消えていれば削除を配信する。
func (h *OrderHandler) publishChangedOrder(orderID uuid.UUID) {
	_, err := broadcastOrder(h.db, h.hub, orderID)
	switch {
	case errors.Is(err, gorm.ErrRecordNotFound):
		broadcastOrderDeleted(h.hub, orderID)
	case err != nil:
		log.Printf("failed to publish order %s: %v", orderID, err)
	}
}

func (h *OrderHandler) publishAllOrders() {
	_ = h.hub.Publish(func() (WSMessage, error) {
		msg, ok := ordersMessage(h.db)
		if !ok {
			return WSMessage{}, errors.New("failed to load orders")
		}
		return msg, nil
	})
}
