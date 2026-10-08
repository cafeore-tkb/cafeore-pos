package handlers

import (
	"errors"
	"log"
	"slices"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"cafeore-pos/api/internal/caos"
	"cafeore-pos/api/internal/models"
)

// CaOS の緊急の入れ直しの印刷。入れ直しを確定したら、CaOS の操作と同じトランザクションで（CaosStore.do）、
// 入れ直しのカードのカップ分の緊急の印刷（「緊急」のシール＋そのカップの本物と同じシール）を印刷キュー（print_job.go）に積む。
// 練習用の盤面（CaosPracticeStore）は CaosStore.do を通らないので積まない。

// enqueueRebrewEmergency は CaOS の緊急の入れ直しでできたカード（drips）の、カップ分の緊急の印刷を積む。
// CaOS の操作と同じトランザクションの中で呼ぶ。積んだ数を返す。
// カップを持たない古い注文や、消えた注文の明細は積まない（ログに残す）。
func enqueueRebrewEmergency(tx *gorm.DB, drips []caos.Drip, now time.Time) (int, error) {
	orders := map[string]*models.Order{}
	n := 0
	for _, d := range drips {
		if d.RebrewOf == nil {
			continue
		}
		used := map[uuid.UUID]bool{}
		for _, line := range d.Lines {
			order, ok := orders[line.OrderID]
			if !ok {
				id, err := uuid.Parse(line.OrderID)
				if err != nil {
					continue
				}
				var o models.Order
				err = preloadOrder(tx).First(&o, "id = ?", id).Error
				if errors.Is(err, gorm.ErrRecordNotFound) {
					log.Printf("print: the order %s of the rebrew card %s is gone, skipped the emergency labels", line.OrderID, d.ID)
					orders[line.OrderID] = nil
					continue
				}
				if err != nil {
					return 0, err
				}
				order = &o
				orders[line.OrderID] = order
			}
			if order == nil {
				continue
			}
			cups := pickRebrewCups(order, line, used)
			if len(cups) < line.Cups {
				log.Printf("print: the order %s has only %d of %d cups for the rebrew card %s", line.OrderID, len(cups), line.Cups, d.ID)
			}
			for _, cup := range cups {
				used[cup.ID] = true
				id := cup.ID
				row := newPrintJobRow(printJobKindEmergency, printJobSourceCaos, order, &id, now)
				if err := tx.Create(&row).Error; err != nil {
					return 0, err
				}
				n++
			}
		}
	}
	return n, nil
}

// pickRebrewCups は、入れ直しのカードの明細 1 行（注文・商品・指名・杯数）にあたる、その注文のカップを選ぶ。
//
// カードはどのカップかを持たないので、同じ商品・同じ指名（明細の番号。1〜6 以外は指名なし）でシールのあるカップから、
// まだ出していないもの（準備中 → 準備完了 → 提供済みの順）を先に、同じ状態なら注文の中の並び順で、杯数分だけ選ぶ。
// used のカップ（同じカードのほかの明細で選んだもの）は選ばない。
func pickRebrewCups(order *models.Order, line caos.DripLine, used map[uuid.UUID]bool) []models.OrderCup {
	dripperOf := map[uuid.UUID]*int{}
	for _, m := range order.OrderMenus {
		if m.Dripper != nil && *m.Dripper >= 1 && *m.Dripper <= maxDripper {
			dripperOf[m.ID] = m.Dripper
		}
	}
	sameDripper := func(a, b *int) bool {
		if a == nil || b == nil {
			return a == b
		}
		return *a == *b
	}
	var candidates []models.OrderCup
	for _, cup := range order.OrderCups {
		if used[cup.ID] || cup.ItemID.String() != line.ItemID || !isLabelCup(cup) || !sameDripper(dripperOf[cup.OrderMenuID], line.Dripper) {
			continue
		}
		candidates = append(candidates, cup)
	}
	rank := func(c models.OrderCup) int {
		switch {
		case c.ServedAt != nil:
			return 2
		case c.ReadyAt != nil:
			return 1
		default:
			return 0
		}
	}
	slices.SortStableFunc(candidates, func(a, b models.OrderCup) int {
		if d := rank(a) - rank(b); d != 0 {
			return d
		}
		return a.Position - b.Position
	})
	return candidates[:min(len(candidates), max(line.Cups, 0))]
}
