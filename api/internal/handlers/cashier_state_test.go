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
	"menus": [],
	"total": 0,
	"comments": [],
	"billingAmount": 0,
	"received": 0,
	"discountOrderId": null,
	"discountOrderCups": 0,
	"DISCOUNT_PER_CUP": 100,
	"discount": 0,
	"estimateTime": 0
}`

func validateEdittingOrderJSON(t *testing.T, raw string) error {
	t.Helper()
	var order map[string]interface{}
	if err := json.Unmarshal([]byte(raw), &order); err != nil {
		t.Fatal(err)
	}
	return validateEdittingOrder(order, []byte(raw))
}

func TestValidateEdittingOrderAcceptsFrontendShape(t *testing.T) {
	if err := validateEdittingOrderJSON(t, validEdittingOrder); err != nil {
		t.Fatal(err)
	}
}

func TestValidateEdittingOrderRejectsBrokenShape(t *testing.T) {
	cases := map[string]func(map[string]interface{}){
		"missing key":       func(o map[string]interface{}) { delete(o, "orderId") },
		"missing nullable":  func(o map[string]interface{}) { delete(o, "readyAt") },
		"null not nullable": func(o map[string]interface{}) { o["menus"] = nil },
		"wrong type":        func(o map[string]interface{}) { o["total"] = "0" },
		"invalid date":      func(o map[string]interface{}) { o["createdAt"] = "yesterday" },
	}
	for name, mutate := range cases {
		var order map[string]interface{}
		if err := json.Unmarshal([]byte(validEdittingOrder), &order); err != nil {
			t.Fatal(err)
		}
		mutate(order)
		raw, err := json.Marshal(order)
		if err != nil {
			t.Fatal(err)
		}
		if validateEdittingOrder(order, raw) == nil {
			t.Errorf("%s: broken editting_order accepted", name)
		}
	}
}
