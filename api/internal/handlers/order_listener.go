// api/internal/handlers/order_listener.go
package handlers

import (
	"context"
	"errors"
	"log"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"gorm.io/gorm"
)

// 注文が変わったことをインスタンス同士で知らせる DB の通知チャンネル。
const ordersChangedChannel = "orders_changed"

// このプロセスの ID。自分が送った通知を、自分で受けて配り直さないために使う。
var instanceID = uuid.NewString()

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
// LISTEN はセッションを保ったまま待つので、Supabase のトランザクションプーラー
// （ポート 6543）経由では通知が届かない。直接接続かセッションプーラーの接続文字列を渡すこと。
// 切れたら間隔を空けてつなぎ直す。ctx が終わると戻る。
func (h *OrderHandler) ListenOrderChanges(ctx context.Context, dsn string) {
	retryDelay := time.Second
	for {
		err := h.listenOrderChangesOnce(ctx, dsn, func() { retryDelay = time.Second })
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

func (h *OrderHandler) listenOrderChangesOnce(ctx context.Context, dsn string, onListening func()) error {
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

	// 待ち受けていなかった間の変更を取りこぼさないよう、つないだ時点で全注文を配り直す
	h.publishAllOrders()
	for {
		n, err := conn.WaitForNotification(ctx)
		if err != nil {
			return err
		}
		h.handleOrderChanged(n.Payload)
	}
}

// 通知（"<送ったインスタンスの ID> <注文 ID>"）を受けて、注文を読み直して配信する。
// 消えていれば削除を配信する。
func (h *OrderHandler) handleOrderChanged(payload string) {
	sender, rawOrderID, ok := strings.Cut(payload, " ")
	if !ok {
		// 形の分からない通知。何が変わったか分からないので全注文を配り直す
		h.publishAllOrders()
		return
	}
	if sender == instanceID {
		return
	}
	orderID, err := uuid.Parse(rawOrderID)
	if err != nil {
		h.publishAllOrders()
		return
	}
	_, err = broadcastOrder(h.db, h.hub, orderID)
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
