package handlers

import (
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"

	"cafeore-pos/api/internal/caos"
	"cafeore-pos/api/internal/models"
)

// 入れ直しのカードの明細から、その注文のカップを選ぶ：同じ商品・同じ指名でシールのあるカップから、
// 準備中 → 準備完了 → 提供済みの順、同じ状態なら並び順で、杯数分。同じカードのほかの明細で選んだカップは選ばない。
func TestPickRebrewCups(t *testing.T) {
	hot := models.ItemType{Name: "hot"}
	milkType := models.ItemType{Name: "milk"}
	champ := models.Item{ID: uuid.New(), Name: "優勝", ItemType: hot}
	kenya := models.Item{ID: uuid.New(), Name: "ケニア", ItemType: hot}
	milk := models.Item{ID: uuid.New(), Name: "ミルク", ItemType: milkType}
	two := 2
	plain, named, legacy := uuid.New(), uuid.New(), uuid.New()
	now := time.Now()
	cup := func(pos int, line uuid.UUID, item models.Item, ready, served bool) models.OrderCup {
		c := models.OrderCup{ID: uuid.New(), OrderMenuID: line, ItemID: item.ID, Item: item, Position: pos}
		if ready || served {
			c.ReadyAt = &now
		}
		if served {
			c.ServedAt = &now
		}
		return c
	}
	order := &models.Order{
		OrderMenus: []models.OrderMenu{{ID: plain}, {ID: named, Dripper: &two}, {ID: legacy, Assignee: ptrTo("山田")}},
		OrderCups: []models.OrderCup{
			cup(0, plain, champ, true, true),   // 提供済み
			cup(1, plain, champ, true, false),  // 準備完了
			cup(2, plain, champ, false, false), // 準備中
			cup(3, plain, kenya, false, false),
			cup(4, named, champ, false, false),  // 指名 2nd
			cup(5, plain, milk, false, false),   // シールなし
			cup(6, legacy, champ, false, false), // 自由記述だけの古い指名は指名なし
		},
	}
	ids := func(cups []models.OrderCup) []int {
		var out []int
		for _, c := range cups {
			out = append(out, c.Position)
		}
		return out
	}
	line := caos.DripLine{ItemID: champ.ID.String(), Cups: 2}
	if got := ids(pickRebrewCups(order, line, map[uuid.UUID]bool{})); fmt.Sprint(got) != "[2 6]" {
		t.Fatalf("指名なしの優勝 2 杯は、準備中のカップから並び順に選ぶ：%v", got)
	}
	line.Cups = 4
	if got := ids(pickRebrewCups(order, line, map[uuid.UUID]bool{})); fmt.Sprint(got) != "[2 6 1 0]" {
		t.Fatalf("準備中 → 準備完了 → 提供済みの順：%v", got)
	}
	line.Cups = 2
	used := map[uuid.UUID]bool{order.OrderCups[2].ID: true}
	if got := ids(pickRebrewCups(order, line, used)); fmt.Sprint(got) != "[6 1]" {
		t.Fatalf("同じカードのほかの明細で選んだカップは選ばない：%v", got)
	}
	if got := ids(pickRebrewCups(order, caos.DripLine{ItemID: champ.ID.String(), Dripper: &two, Cups: 2}, map[uuid.UUID]bool{})); fmt.Sprint(got) != "[4]" {
		t.Fatalf("指名 2nd の明細は、指名 2nd のカップだけ（足りなければあるだけ）：%v", got)
	}
	if got := pickRebrewCups(order, caos.DripLine{ItemID: milk.ID.String(), Cups: 1}, map[uuid.UUID]bool{}); len(got) != 0 {
		t.Fatalf("シールの無いカップは選ばない：%v", ids(got))
	}
}

// CaOS の緊急の入れ直しは、入れ直しのカードのカップ分の緊急の印刷を、操作と同じトランザクションで積む
func TestCaosRebrewQueuesEmergencyLabels(t *testing.T) {
	e := newCaosEnv(t)
	two := 2
	o := e.createOrderWith(t, map[string]any{"order_id": 1, "billing_amount": 1500, "received": 1500,
		"menu_ids": []map[string]any{{"menu_id": e.menu}, {"menu_id": e.menu}, {"menu_id": e.menu, "dripper": two}}})
	if len(o.Cups) != 3 {
		t.Fatalf("3 杯の注文：%+v", o.Cups)
	}
	var plain, named caos.Drip
	for _, d := range e.cards(t) {
		if d.Lines[0].Dripper == nil {
			plain = d
		} else {
			named = d
		}
	}
	if plain.Cups != 2 || named.Cups != 1 {
		t.Fatalf("指名なし 2 杯と指名 1 杯のカード：%+v", e.cards(t))
	}
	e.op(t, map[string]any{"name": "assign", "drip_id": plain.ID, "dripper": 1}, nil)
	// 1 杯目のカップはもう準備完了
	e.call(t, http.MethodPatch, "/api/orders/"+o.Id.String()+"/cups/"+o.Cups[0].Id.String()+"/ready", nil, nil)

	// 抽出中のカードを 1 杯だけ入れ直す → まだ準備中の 2 杯目
	var res caos.Result
	if code := e.op(t, map[string]any{"name": "rebrew", "source_id": plain.ID, "cups": 1, "interrupt": true}, &res); code != http.StatusOK {
		t.Fatalf("入れ直し：%d", code)
	}
	jobs := e.printJobs(t)
	if len(jobs) != 1 || jobs[0].Kind != "emergency" || jobs[0].Source != "caos" || jobs[0].OrderID != uuid.UUID(o.Id) || jobs[0].CupID == nil || *jobs[0].CupID != uuid.UUID(o.Cups[1].Id) {
		t.Fatalf("入れ直しのカップ分の緊急の印刷を積む：%+v", jobs)
	}
	// 2 杯の入れ直し → 準備中の 2 杯目、準備完了の 1 杯目の順（指名のカップは選ばない）
	if code := e.op(t, map[string]any{"name": "rebrew", "source_id": plain.ID, "cups": 2}, nil); code != http.StatusOK {
		t.Fatalf("入れ直し：%d", code)
	}
	jobs = e.printJobs(t)
	if len(jobs) != 3 || *jobs[1].CupID != uuid.UUID(o.Cups[1].Id) || *jobs[2].CupID != uuid.UUID(o.Cups[0].Id) {
		t.Fatalf("2 杯分を、まだ出していないカップから積む：%+v", jobs)
	}
	// 指名のカードの入れ直しは、指名のカップ
	e.op(t, map[string]any{"name": "assign", "drip_id": named.ID, "dripper": 2}, nil)
	if code := e.op(t, map[string]any{"name": "rebrew", "source_id": named.ID, "cups": 1, "dripper": 2}, &res); code != http.StatusOK {
		t.Fatalf("入れ直し：%d", code)
	}
	jobs = e.printJobs(t)
	if len(jobs) != 4 || *jobs[3].CupID != uuid.UUID(o.Cups[2].Id) {
		t.Fatalf("指名のカードは指名のカップ：%+v", jobs)
	}
	// 1つ戻しても、積んだ印刷は取り消さない（もう印刷しているかもしれない）
	if code := e.op(t, map[string]any{"name": "undo", "op_id": res.OpID}, nil); code != http.StatusOK {
		t.Fatalf("1つ戻す：%d", code)
	}
	if jobs = e.printJobs(t); len(jobs) != 4 {
		t.Fatalf("1つ戻しても積んだ印刷はそのまま：%+v", jobs)
	}
	// 入れ直し以外の操作では積まない
	if code := e.op(t, map[string]any{"name": "next", "dripper": 2}, nil); code != http.StatusOK {
		t.Fatalf("次へ：%d", code)
	}
	if jobs = e.printJobs(t); len(jobs) != 4 {
		t.Fatalf("入れ直し以外では積まない：%+v", jobs)
	}
	// 断られた入れ直しは何も積まない
	if code := e.op(t, map[string]any{"name": "rebrew", "source_id": plain.ID, "cups": 3}, nil); code != http.StatusUnprocessableEntity {
		t.Fatalf("杯数が多すぎる入れ直しは 422：%d", code)
	}
	if jobs = e.printJobs(t); len(jobs) != 4 {
		t.Fatalf("断られた入れ直しは積まない：%+v", jobs)
	}
}
