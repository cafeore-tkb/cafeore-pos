// api/internal/handlers/order_listener.go
package handlers

import (
	"context"
	"log"
	"time"

	"github.com/jackc/pgx/v5"

	"cafeore-pos/api/internal/caos"
)

// DB の orders_changed 通知を待ち受けるチャンネル名。api/sql/2026-10_orders_notify.sql のトリガーが送る。
const ordersChangedChannel = "orders_changed"

// ListenOrderChanges は、DB で注文が変わるたびに全注文を配信し直す。
//
// 注文は API 以外からも書き換わる（SQL で直接直すなど）し、ほかのインスタンスでも書き換わる。
// そうした変更も DB のトリガーが通知するので、ここで受けて POS の画面へ届ける。
// インスタンスが何台あっても、それぞれが待ち受けて自分につないでいる画面へ配る。
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
	// CaOS のカードの変更（どのインスタンスで操作しても、ここで受けて DB から読み直し、自分につないでいる画面へ配る）
	if _, err := conn.Exec(ctx, "LISTEN "+caos.ChangedChannel); err != nil {
		return err
	}
	onListening()
	log.Printf("listening for %s, %s", ordersChangedChannel, caos.ChangedChannel)

	// 待ち受けを始める前の変更を取りこぼさないよう、つないだ時点で一度配る
	h.broadcastOrders()
	h.broadcastDrips()
	for {
		n, err := conn.WaitForNotification(ctx)
		if err != nil {
			return err
		}
		if n.Channel == caos.ChangedChannel {
			h.broadcastDrips()
			continue
		}
		h.broadcastOrders()
	}
}
