package handlers

import (
	"encoding/json"
	"testing"
)

// フロントの cashierStateToUpdateRequest が送る editting_order（保存前の注文なので id は無い）
const validEdittingOrder = `{
	"orderId": 1,
	"createdAt": "2026-09-11T00:00:00.000Z",
	"readyAt": null,
	"servedAt": null,
	"menus": [{
		"id": "00000000-0000-4000-8000-000000000001",
		"name": "ブレンド",
		"abbr": "ブ",
		"price": 400,
		"key": "q",
		"items": [{
			"item": {
				"id": "00000000-0000-4000-8000-000000000002",
				"name": "ブレンド",
				"abbr": "ブ",
				"item_type": {"id": "hot", "name": "hot", "display_name": "ホット"}
			},
			"quantity": 1
		}],
		"assignee": null
	}],
	"total": 400,
	"comments": [{"author": "cashier", "text": "氷少なめ", "createdAt": "2026-09-11T00:00:00.000Z"}],
	"billingAmount": 400,
	"received": 0,
	"discountOrderId": null,
	"discountOrderCups": 0,
	"DISCOUNT_PER_CUP": 100,
	"discount": 0,
	"estimateTime": 0
}`

func parseEdittingOrder(t *testing.T) map[string]interface{} {
	t.Helper()
	var order map[string]interface{}
	if err := json.Unmarshal([]byte(validEdittingOrder), &order); err != nil {
		t.Fatal(err)
	}
	return order
}

func firstMenu(o map[string]interface{}) map[string]interface{} {
	return o["menus"].([]interface{})[0].(map[string]interface{})
}

func firstComment(o map[string]interface{}) map[string]interface{} {
	return o["comments"].([]interface{})[0].(map[string]interface{})
}

func TestValidateEdittingOrderAcceptsFrontendShape(t *testing.T) {
	if err := validateEdittingOrder(parseEdittingOrder(t)); err != nil {
		t.Fatal(err)
	}
}

func TestValidateEdittingOrderAcceptsOptionalKeys(t *testing.T) {
	order := parseEdittingOrder(t)
	order["id"] = "00000000-0000-4000-8000-000000000003"
	firstMenu(order)["orderMenuId"] = "00000000-0000-4000-8000-000000000004"
	itemType := firstMenu(order)["items"].([]interface{})[0].(map[string]interface{})["item"].(map[string]interface{})["item_type"].(map[string]interface{})
	itemType["makes_cup"], itemType["needs_brew"], itemType["senior_only"] = true, true, false
	if err := validateEdittingOrder(order); err != nil {
		t.Fatal(err)
	}
}

func TestValidateEdittingOrderRejectsBrokenShape(t *testing.T) {
	cases := map[string]func(map[string]interface{}){
		"missing key":         func(o map[string]interface{}) { delete(o, "orderId") },
		"missing nullable":    func(o map[string]interface{}) { delete(o, "readyAt") },
		"null not nullable":   func(o map[string]interface{}) { o["menus"] = nil },
		"wrong type":          func(o map[string]interface{}) { o["total"] = "0" },
		"invalid date":        func(o map[string]interface{}) { o["createdAt"] = "yesterday" },
		"menu not object":     func(o map[string]interface{}) { o["menus"] = []interface{}{1} },
		"menu without id":     func(o map[string]interface{}) { delete(firstMenu(o), "id") },
		"menu id not uuid":    func(o map[string]interface{}) { firstMenu(o)["id"] = "blend" },
		"menu price fraction": func(o map[string]interface{}) { firstMenu(o)["price"] = 1.5 },
		"menu without items":  func(o map[string]interface{}) { firstMenu(o)["items"] = []interface{}{} },
		"menu item zero qty": func(o map[string]interface{}) {
			firstMenu(o)["items"].([]interface{})[0].(map[string]interface{})["quantity"] = 0
		},
		"menu item without item_type": func(o map[string]interface{}) {
			item := firstMenu(o)["items"].([]interface{})[0].(map[string]interface{})["item"]
			delete(item.(map[string]interface{}), "item_type")
		},
		"item_type flag not bool": func(o map[string]interface{}) {
			item := firstMenu(o)["items"].([]interface{})[0].(map[string]interface{})["item"]
			item.(map[string]interface{})["item_type"].(map[string]interface{})["makes_cup"] = "true"
		},
		"comment not object":    func(o map[string]interface{}) { o["comments"] = []interface{}{"x"} },
		"comment bad author":    func(o map[string]interface{}) { firstComment(o)["author"] = "guest" },
		"comment invalid date":  func(o map[string]interface{}) { firstComment(o)["createdAt"] = "now" },
		"comment text not text": func(o map[string]interface{}) { firstComment(o)["text"] = 1 },
	}
	for name, mutate := range cases {
		order := parseEdittingOrder(t)
		mutate(order)
		if validateEdittingOrder(order) == nil {
			t.Errorf("%s: broken editting_order accepted", name)
		}
	}
}
