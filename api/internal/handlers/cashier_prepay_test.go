package handlers

import (
	"encoding/json"
	"testing"
)

// フロントの prepaySnapshot が送る形。2 杯のうち 1 杯を個別小計で現金で払い、残りの小計を金額で分けて
// Square で一部払った途中
const validCashierPrepay = `{
	"orderId": 12,
	"lines": [
		{"key": 0, "menu": {
			"id": "00000000-0000-4000-8000-000000000001",
			"name": "ブレンド", "abbr": "ブ", "price": 400, "key": "q", "priority": 0,
			"items": [{"item": {
				"id": "00000000-0000-4000-8000-000000000002",
				"name": "ブレンド", "abbr": "ブ",
				"item_type": {"id": "hot", "name": "hot", "display_name": "ホット", "needs_brew": true}
			}, "quantity": 1}],
			"assignee": null, "dripper": null
		}},
		{"key": 1, "menu": {
			"id": "00000000-0000-4000-8000-000000000001",
			"name": "ブレンド", "abbr": "ブ", "price": 400, "key": "q", "priority": 0,
			"items": [{"item": {
				"id": "00000000-0000-4000-8000-000000000002",
				"name": "ブレンド", "abbr": "ブ",
				"item_type": {"id": "hot", "name": "hot", "display_name": "ホット", "needs_brew": true}
			}, "quantity": 1}],
			"assignee": "山田", "dripper": 2
		}}
	],
	"nextKey": 2,
	"coupon": "",
	"special": false,
	"memo": "",
	"split": {
		"subtotals": [
			{"id": 0, "kind": "items", "lineKeys": [0], "total": 400, "discountCups": 0, "discount": 0, "amount": 400},
			{"id": 2, "kind": "rest", "lineKeys": [1], "total": 400, "discountCups": 0, "discount": 0, "amount": 400}
		],
		"tenders": [
			{"id": 1, "subtotalId": 0, "method": "cash", "amount": 400, "received": 1000},
			{"id": 3, "subtotalId": 2, "method": "square", "amount": 150, "received": 150,
				"squareCheckoutId": "00000000-0000-4000-8000-000000000005", "squarePaymentType": "QR_CODE"}
		],
		"current": 2,
		"part": null,
		"discountFirst": [],
		"nextId": 4
	}
}`

func parseCashierPrepay(t *testing.T) map[string]interface{} {
	t.Helper()
	var prepay map[string]interface{}
	if err := json.Unmarshal([]byte(validCashierPrepay), &prepay); err != nil {
		t.Fatal(err)
	}
	return prepay
}

func prepaySplit(p map[string]interface{}) map[string]interface{} {
	return p["split"].(map[string]interface{})
}

func firstTender(p map[string]interface{}) map[string]interface{} {
	return prepaySplit(p)["tenders"].([]interface{})[0].(map[string]interface{})
}

func firstSubtotal(p map[string]interface{}) map[string]interface{} {
	return prepaySplit(p)["subtotals"].([]interface{})[0].(map[string]interface{})
}

func TestValidateCashierPrepayAcceptsFrontendShape(t *testing.T) {
	prepay := parseCashierPrepay(t)
	if err := validateCashierPrepay(prepay); err != nil {
		t.Fatal(err)
	}
	// 小計分割で、先に払う額を入れている
	prepaySplit(prepay)["part"] = float64(100)
	// 会計の段階でない（個別小計を払い終えて、入れる段階に戻った）
	prepaySplit(prepay)["current"] = nil
	if err := validateCashierPrepay(prepay); err != nil {
		t.Fatal(err)
	}
}

func TestValidateCashierPrepayRejectsBrokenShape(t *testing.T) {
	cases := map[string]func(map[string]interface{}){
		"missing orderId":        func(p map[string]interface{}) { delete(p, "orderId") },
		"orderId zero":           func(p map[string]interface{}) { p["orderId"] = float64(0) },
		"no lines":               func(p map[string]interface{}) { p["lines"] = []interface{}{} },
		"line key fraction":      func(p map[string]interface{}) { p["lines"].([]interface{})[0].(map[string]interface{})["key"] = 0.5 },
		"line menu without id":   func(p map[string]interface{}) { delete(p["lines"].([]interface{})[0].(map[string]interface{})["menu"].(map[string]interface{}), "id") },
		"special not bool":       func(p map[string]interface{}) { p["special"] = "false" },
		"missing split":          func(p map[string]interface{}) { delete(p, "split") },
		"no tenders":             func(p map[string]interface{}) { prepaySplit(p)["tenders"] = []interface{}{} },
		"no subtotals":           func(p map[string]interface{}) { prepaySplit(p)["subtotals"] = []interface{}{} },
		"part zero":              func(p map[string]interface{}) { prepaySplit(p)["part"] = float64(0) },
		"missing current":        func(p map[string]interface{}) { delete(prepaySplit(p), "current") },
		"tender bad method":      func(p map[string]interface{}) { firstTender(p)["method"] = "card" },
		"tender amount string":   func(p map[string]interface{}) { firstTender(p)["amount"] = "400" },
		"tender checkout uuid":   func(p map[string]interface{}) { firstTender(p)["squareCheckoutId"] = "checkout-1" },
		"tender bad pay type":    func(p map[string]interface{}) { firstTender(p)["squarePaymentType"] = "CASH" },
		"subtotal bad kind":      func(p map[string]interface{}) { firstSubtotal(p)["kind"] = "all" },
		"subtotal no line keys":  func(p map[string]interface{}) { firstSubtotal(p)["lineKeys"] = []interface{}{} },
		"discountFirst not ints": func(p map[string]interface{}) { prepaySplit(p)["discountFirst"] = []interface{}{"0"} },
	}
	for name, mutate := range cases {
		prepay := parseCashierPrepay(t)
		mutate(prepay)
		if validateCashierPrepay(prepay) == nil {
			t.Errorf("%s: broken prepay accepted", name)
		}
	}
}
