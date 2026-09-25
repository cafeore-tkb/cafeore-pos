package handlers

import (
	"testing"
	"time"

	"cafeore-pos/api/internal/models"
	"github.com/google/uuid"
)

// 1杯目, 2杯目, ... の状態を "p"(preparing) / "r"(ready) / "s"(served) で表す
func cupStates(order *models.Order) string {
	s := ""
	for _, cup := range order.OrderCups {
		switch {
		case cup.ServedAt != nil:
			s += "s"
		case cup.ReadyAt != nil:
			s += "r"
		default:
			s += "p"
		}
	}
	return s
}

func twoCupOrder() *models.Order {
	return &models.Order{OrderCups: []models.OrderCup{{ID: uuid.New()}, {ID: uuid.New()}}}
}

func TestToggleCupServedUpdatesOrderOnlyWhenAllCupsServed(t *testing.T) {
	order := twoCupOrder()
	t1, t2 := time.Now(), time.Now().Add(time.Minute)

	toggleCupServed(order, &order.OrderCups[0], t1)
	if cupStates(order) != "sp" || order.ServedAt != nil || order.ReadyAt != nil {
		t.Fatalf("partially served order must stay unserved: %s %+v", cupStates(order), order)
	}

	toggleCupServed(order, &order.OrderCups[1], t2)
	if cupStates(order) != "ss" || !sameTime(order.ServedAt, &t2) || !sameTime(order.ReadyAt, &t2) {
		t.Fatalf("order must be served when all cups are served: %s %+v", cupStates(order), order)
	}

	toggleCupServed(order, &order.OrderCups[1], t2)
	if cupStates(order) != "sp" || order.ServedAt != nil || order.ReadyAt != nil {
		t.Fatalf("unserving a cup must unserve the order: %s %+v", cupStates(order), order)
	}
}

func TestToggleCupServedKeepsEarlierReady(t *testing.T) {
	order := twoCupOrder()
	t0, t1 := time.Now(), time.Now().Add(time.Minute)
	toggleOrderReady(order, t0)
	toggleCupServed(order, &order.OrderCups[0], t1)
	if cupStates(order) != "sr" || !sameTime(order.ReadyAt, &t0) || order.ServedAt != nil {
		t.Fatalf("serving one cup of a calling order must keep it calling: %s %+v", cupStates(order), order)
	}
	toggleCupServed(order, &order.OrderCups[0], t1)
	if cupStates(order) != "rr" || !sameTime(order.ReadyAt, &t0) {
		t.Fatalf("unserving must return the cup to ready: %s %+v", cupStates(order), order)
	}
}

func TestToggleCupReady(t *testing.T) {
	order := twoCupOrder()
	t1, t2 := time.Now(), time.Now().Add(time.Minute)
	toggleCupReady(order, &order.OrderCups[0], t1)
	if cupStates(order) != "rp" || order.ReadyAt != nil {
		t.Fatalf("partially ready order must not be ready: %s %+v", cupStates(order), order)
	}
	toggleCupReady(order, &order.OrderCups[1], t2)
	if cupStates(order) != "rr" || !sameTime(order.ReadyAt, &t2) {
		t.Fatalf("order must be ready when all cups are ready: %s %+v", cupStates(order), order)
	}
	toggleCupServed(order, &order.OrderCups[0], t2)
	toggleCupReady(order, &order.OrderCups[0], t2)
	if cupStates(order) != "pr" || order.ReadyAt != nil || order.ServedAt != nil {
		t.Fatalf("un-readying a cup must also unserve it: %s %+v", cupStates(order), order)
	}
}

func TestToggleOrderReadyAppliesToCups(t *testing.T) {
	order := twoCupOrder()
	t0, t1 := time.Now(), time.Now().Add(time.Minute)
	toggleCupReady(order, &order.OrderCups[0], t0)

	toggleOrderReady(order, t1)
	if cupStates(order) != "rr" || !sameTime(order.ReadyAt, &t1) {
		t.Fatalf("ready order must make all cups ready: %s %+v", cupStates(order), order)
	}
	if !sameTime(order.OrderCups[0].ReadyAt, &t0) || !sameTime(order.OrderCups[1].ReadyAt, &t1) {
		t.Fatalf("already ready cups keep their time, others get the order's time: %+v", order.OrderCups)
	}

	toggleOrderReady(order, t1)
	if cupStates(order) != "rp" || order.ReadyAt != nil {
		t.Fatalf("undo must only revert cups the order made ready: %s %+v", cupStates(order), order)
	}
}

func TestToggleOrderReadyAlwaysCancels(t *testing.T) {
	// 全カップが個別に準備完了になって注文も準備完了になった状態から、呼び出しを取り消す
	order := twoCupOrder()
	t0, t1 := time.Now(), time.Now().Add(time.Minute)
	toggleCupReady(order, &order.OrderCups[0], t0)
	toggleCupReady(order, &order.OrderCups[1], t1)
	toggleOrderReady(order, t1)
	if order.ReadyAt != nil || cupStates(order) != "rp" {
		t.Fatalf("cancel must reset the order: %s %+v", cupStates(order), order)
	}

	// 注文の時刻とどのカップの時刻も一致しない場合でも取り消せる
	order = twoCupOrder()
	toggleCupReady(order, &order.OrderCups[0], t0)
	toggleCupReady(order, &order.OrderCups[1], t0)
	toggleCupServed(order, &order.OrderCups[0], t1)
	order.ReadyAt = &t1
	toggleOrderReady(order, t1)
	if order.ReadyAt != nil || cupStates(order) != "sp" {
		t.Fatalf("cancel must reset unserved cups: %s %+v", cupStates(order), order)
	}
}

func TestToggleOrderServedAppliesToCups(t *testing.T) {
	order := twoCupOrder()
	t1, t2 := time.Now(), time.Now().Add(time.Minute)
	toggleCupServed(order, &order.OrderCups[0], t1)

	toggleOrderServed(order, t2)
	if cupStates(order) != "ss" || !sameTime(order.ServedAt, &t2) || !sameTime(order.ReadyAt, &t2) {
		t.Fatalf("served order must serve all cups: %s %+v", cupStates(order), order)
	}
	if !sameTime(order.OrderCups[0].ServedAt, &t1) || !sameTime(order.OrderCups[1].ServedAt, &t2) {
		t.Fatalf("already served cups keep their time: %+v", order.OrderCups)
	}

	// 提供の取消では、先に個別で提供したカップは提供済みのまま残る
	toggleOrderServed(order, t2)
	if cupStates(order) != "sp" || order.ServedAt != nil || order.ReadyAt != nil {
		t.Fatalf("undo must restore the partially served state: %s %+v", cupStates(order), order)
	}
}

func TestToggleOrderServedUndoReturnsToCalling(t *testing.T) {
	order := twoCupOrder()
	t0, t1 := time.Now(), time.Now().Add(time.Minute)
	toggleOrderReady(order, t0)
	toggleOrderServed(order, t1)
	toggleOrderServed(order, t1)
	if cupStates(order) != "rr" || !sameTime(order.ReadyAt, &t0) || order.ServedAt != nil {
		t.Fatalf("undo must return to the calling state: %s %+v", cupStates(order), order)
	}

	// 注文の時刻とどのカップの時刻も一致しない場合でも取り消せる
	order = twoCupOrder()
	toggleOrderServed(order, t0)
	order.ServedAt = &t1
	toggleOrderServed(order, t1)
	if cupStates(order) != "pp" || order.ServedAt != nil || order.ReadyAt != nil {
		t.Fatalf("undo must always unserve: %s %+v", cupStates(order), order)
	}
}

func TestToggleOrderStatusWithoutCups(t *testing.T) {
	order := &models.Order{}
	now := time.Now()
	toggleOrderServed(order, now)
	if !sameTime(order.ServedAt, &now) || !sameTime(order.ReadyAt, &now) {
		t.Fatalf("order without cups must be served: %+v", order)
	}
	toggleOrderServed(order, now)
	if order.ServedAt != nil || order.ReadyAt != nil {
		t.Fatalf("order without cups must be unserved: %+v", order)
	}
	toggleOrderReady(order, now)
	toggleOrderReady(order, now)
	if order.ReadyAt != nil {
		t.Fatalf("order without cups must be un-readied: %+v", order)
	}
}
