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

// 変わったことをインスタンス同士で知らせる DB の通知チャンネル。
const (
	// 注文。通知の中身は "<送ったインスタンスの ID> <注文 ID>"
	ordersChangedChannel = "orders_changed"
	// オーダーストップ（master_states）。通知の中身は "<送ったインスタンスの ID>"
	masterStateChangedChannel = "master_state_changed"
	// レジの状態（cashier_states）。通知の中身は "<送ったインスタンスの ID>"
	cashierStateChangedChannel = "cashier_state_changed"
)

// 待ち受けるチャンネル。1本の接続でまとめて LISTEN する。
// CaOS の盤面のカード（dripsChangedChannel = caos_drips_changed。caos_store.go）も同じ接続で待ち受ける。
// 通知の中身は "<送ったインスタンスの ID>"（notifyDripsChanged）。
var listenChannels = []string{ordersChangedChannel, masterStateChangedChannel, cashierStateChangedChannel, dripsChangedChannel}

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

// notifyChanged は、channel のものが変わったことをほかのインスタンスへ知らせる。
//
// Cloud Run のインスタンスはそれぞれ自分につないでいる画面にしか配れないので、
// 書き換えたインスタンスが DB の通知を送り、ほかのインスタンスが
// ListenChanges で受けて DB から読み直し、自分の画面へ配る。DB のトリガーは使わない
// （スキーマは Go のモデルだけで決める。README の「DB のスキーマ」を参照）。
//
// 通知に失敗しても、このインスタンスの画面にはもう配ってあるので、ログに残すだけにする。
// ほかのインスタンスの画面は、つなぎ直したときに全部を受け取って追いつく。
func notifyChanged(db *gorm.DB, channel, payload string) {
	if err := db.Exec("SELECT pg_notify(?, ?)", channel, payload).Error; err != nil {
		log.Printf("failed to notify %s (%s): %v", channel, payload, err)
	}
}

// 注文が変わったことをほかのインスタンスへ知らせる。
func notifyOrderChanged(db *gorm.DB, orderID uuid.UUID) {
	notifyChanged(db, ordersChangedChannel, instanceID+" "+orderID.String())
}

// オーダーストップの状態が変わったことをほかのインスタンスへ知らせる。
func notifyMasterStateChanged(db *gorm.DB) {
	notifyChanged(db, masterStateChangedChannel, instanceID)
}

// レジの状態が変わったことをほかのインスタンスへ知らせる。
func notifyCashierStateChanged(db *gorm.DB) {
	notifyChanged(db, cashierStateChangedChannel, instanceID)
}

// ListenChanges は、ほかのインスタンスで注文・オーダーストップ・レジの状態・CaOS の盤面が変わるたびに、
// DB から読み直して配信する。
//
// 自分が送った通知は無視する（書き換えたときに配信済み）。ほかのインスタンスから届いたものは
// このインスタンスの画面へだけ配り、通知を送り返さない。
//
// 通知の受信と配信は別の goroutine で行う。DB の読み直しが遅くても受信は止めず、
// 配り終わるまでに同じものの通知が重なったら 1 回の読み直しにまとめる。
//
// LISTEN はセッションを保ったまま待つので、Supabase のトランザクションプーラー
// （ポート 6543）経由では通知が届かない。直接接続かセッションプーラーの接続文字列を渡すこと。
// 切れたら間隔を空けてつなぎ直す。ctx が終わると戻る。
func (h *OrderHandler) ListenChanges(ctx context.Context, dsn string) {
	changes := newPendingChanges()
	go h.publishChanges(ctx, changes)

	retryDelay := time.Second
	for {
		err := h.listenChangesOnce(ctx, dsn, changes, func() { retryDelay = time.Second })
		if ctx.Err() != nil {
			return
		}
		log.Printf("change listener stopped, retrying in %s: %v", retryDelay, err)
		select {
		case <-ctx.Done():
			return
		case <-time.After(retryDelay):
		}
		retryDelay = min(retryDelay*2, 30*time.Second)
	}
}

func (h *OrderHandler) listenChangesOnce(ctx context.Context, dsn string, changes *pendingChanges, onListening func()) error {
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		return err
	}
	defer func() {
		closeCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = conn.Close(closeCtx)
	}()

	for _, channel := range listenChannels {
		if _, err := conn.Exec(ctx, "LISTEN "+channel); err != nil {
			return err
		}
	}
	onListening()
	log.Printf("listening for %s", strings.Join(listenChannels, ", "))

	// トランザクションプーラー（Supabase の 6543 や Neon の -pooler）経由だと、LISTEN は
	// エラーにならないのに通知だけが届かない。変更の通知と同じ経路（h.db）で自分宛てに
	// 確認の通知を送り、届かなければ警告して設定ミスに気づけるようにする。
	// どのチャンネルも同じ接続で待ち受けているので、確認は orders_changed の1つで足りる。
	connCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	probe := listenProbePrefix + instanceID + " " + uuid.NewString()
	var probed atomic.Bool
	go func() {
		select {
		case <-connCtx.Done():
		case <-time.After(listenProbeTimeout):
			if !probed.Load() {
				log.Printf("WARNING: %s の確認の通知が %s 待っても届かない。ほかのインスタンスでの注文・オーダーストップ・レジの状態・CaOS の盤面の変更が配られない。"+
					"DATABASE_LISTEN_URL（無ければ DATABASE_URL）がトランザクションプーラーを指していないか確かめること",
					ordersChangedChannel, listenProbeTimeout)
			}
		}
	}()
	if err := h.db.Exec("SELECT pg_notify(?, ?)", ordersChangedChannel, probe).Error; err != nil {
		log.Printf("failed to send %s probe: %v", ordersChangedChannel, err)
	}

	// 待ち受けていなかった間の変更を取りこぼさないよう、つないだ時点で全部を配り直す
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
		case n.Channel == ordersChangedChannel && n.Payload == probe:
			probed.Store(true)
			log.Printf("%s: notifications are delivered", ordersChangedChannel)
		case n.Channel == ordersChangedChannel && strings.HasPrefix(n.Payload, listenProbePrefix):
			// ほかのインスタンスの確認の通知
		default:
			changes.add(n.Channel, n.Payload)
		}
	}
}

// 受けたけれどまだ配っていない変更。同じものの通知が重なれば 1 つにまとめる。
type pendingChanges struct {
	mu   sync.Mutex
	set  changeSet
	wake chan struct{}
}

// 配り直すもの。
type changeSet struct {
	orderIDs     map[uuid.UUID]struct{}
	allOrders    bool // true なら orderIDs は見ずに全注文を配り直す
	masterState  bool
	cashierState bool
	// CaOS の盤面（今日のカードと列の担当者。全部を読み直して配る）
	drips bool
}

func newPendingChanges() *pendingChanges {
	return &pendingChanges{set: changeSet{orderIDs: map[uuid.UUID]struct{}{}}, wake: make(chan struct{}, 1)}
}

// channel に届いた通知を積む。自分が送ったものは積まない。
func (q *pendingChanges) add(channel, payload string) {
	// どのチャンネルも、通知の中身は送ったインスタンスの ID から始まる
	sender, rest, _ := strings.Cut(payload, " ")
	if sender == instanceID {
		return
	}
	switch channel {
	case ordersChangedChannel:
		q.addOrder(rest)
	case masterStateChangedChannel:
		q.update(func(s *changeSet) { s.masterState = true })
	case cashierStateChangedChannel:
		q.update(func(s *changeSet) { s.cashierState = true })
	case dripsChangedChannel:
		q.update(func(s *changeSet) { s.drips = true })
	}
}

// 変わった注文を積む。形の分からない通知は、何が変わったか分からないので全注文を配り直す。
func (q *pendingChanges) addOrder(rawOrderID string) {
	orderID, err := uuid.Parse(rawOrderID)
	if rawOrderID == "" || err != nil {
		q.update(func(s *changeSet) { s.allOrders = true })
		return
	}
	q.update(func(s *changeSet) { s.orderIDs[orderID] = struct{}{} })
}

// 全部を配り直すよう積む（待ち受けを始めたとき）。
func (q *pendingChanges) addAll() {
	q.update(func(s *changeSet) {
		s.allOrders = true
		s.masterState = true
		s.cashierState = true
		s.drips = true
	})
}

func (q *pendingChanges) update(f func(*changeSet)) {
	q.mu.Lock()
	f(&q.set)
	q.mu.Unlock()
	select {
	case q.wake <- struct{}{}:
	default:
	}
}

// 積まれた変更を取り出して空にする。allOrders なら orderIDs は空で返す。
func (q *pendingChanges) take() changeSet {
	q.mu.Lock()
	defer q.mu.Unlock()
	s := q.set
	if s.allOrders {
		s.orderIDs = nil
	}
	q.set = changeSet{orderIDs: map[uuid.UUID]struct{}{}}
	return s
}

// 積まれた変更を、DB から読み直して配信する。ctx が終わると戻る。
func (h *OrderHandler) publishChanges(ctx context.Context, changes *pendingChanges) {
	for {
		select {
		case <-ctx.Done():
			return
		case <-changes.wake:
		}
		s := changes.take()
		if s.allOrders {
			h.publishAllOrders()
		}
		for id := range s.orderIDs {
			h.publishChangedOrder(id)
		}
		if s.masterState {
			broadcastMasterState(h.db, h.hub)
		}
		if s.cashierState {
			broadcastCashierState(h.db, h.hub)
		}
		if s.drips {
			// 依頼を積むだけ（少し待って 1 回にまとめて送る。CaOS を使っていなければ何もしない）
			h.broadcastDrips()
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
