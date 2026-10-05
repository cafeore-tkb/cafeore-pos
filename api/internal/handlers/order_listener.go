// api/internal/handlers/order_listener.go
package handlers

import (
	"context"
	"errors"
	"log"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"gorm.io/gorm"
)

// DB の orders_changed 通知を待ち受けるチャンネル名。api/sql/2026-10_orders_notify.sql のトリガーが送る。
const ordersChangedChannel = "orders_changed"

// ListenOrderChanges は、DB で注文が変わるたびに、その注文を読み直して配信する。
//
// 注文は API 以外からも書き換わる（SQL で直接直すなど）し、ほかのインスタンスでも書き換わる。
// そうした変更も DB のトリガーが注文 ID を載せて通知するので、ここで受けて POS の画面へ届ける。
// インスタンスが何台あっても、それぞれが待ち受けて自分につないでいる画面へ配る。
// API 自身の書き換えでは、ハンドラーの配信と合わせて同じ注文が 2 回届くが、どちらも読み直した
// 最新の注文なので、画面は同じ状態のまま変わらない。
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
		h.publishChangedOrder(n.Payload)
	}
}

// 通知に載った注文を読み直して配信する。消えていれば削除を配信する。
func (h *OrderHandler) publishChangedOrder(payload string) {
	orderID, err := uuid.Parse(payload)
	if err != nil {
		// 注文 ID を載せない古いトリガー（2026-10_orders_notify.sql の以前の版）からの通知
		h.publishAllOrders()
		return
	}
	_, err = publishOrder(h.db, h.hub, orderID)
	switch {
	case errors.Is(err, gorm.ErrRecordNotFound):
		publishOrderDeleted(h.hub, orderID)
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
