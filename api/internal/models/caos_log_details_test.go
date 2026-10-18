package models

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

func TestCaosClientLogDetailsRoundTrip(t *testing.T) {
	for _, tc := range []struct {
		name    string
		details map[string]interface{}
		wrapped bool
	}{
		{"normal", map[string]interface{}{"text": "了解 ☕", "count": float64(2), "mode": "practice", "isTrusted": false}, false},
		{"empty", map[string]interface{}{}, false},
		{"nul_in_nested_values_and_keys", map[string]interface{}{"key": "1041\x00serve", "nested": []interface{}{map[string]interface{}{"a\x00b": "x\x00y"}}, "mode": "practice", "isTrusted": false}, true},
		{"literal_backslash_u0000", map[string]interface{}{"key": `1041\u0000serve`}, true},
		{"envelope_shaped_value", map[string]interface{}{caosLogDetailsEncoding: `{"text":"inner","mode":"practice"}`}, true},
		{"envelope_nested_twice", map[string]interface{}{caosLogDetailsEncoding: `{"_caos_original_details_json_v1":"{}"}`}, true},
		{"marker_with_other_fields", map[string]interface{}{caosLogDetailsEncoding: `{}`, "text": "keep"}, false},
		{"marker_is_not_string", map[string]interface{}{caosLogDetailsEncoding: float64(1)}, false},
		{"marker_is_not_json", map[string]interface{}{caosLogDetailsEncoding: "plain text"}, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			original, err := json.Marshal(tc.details)
			if err != nil {
				t.Fatal(err)
			}
			stored, err := EncodeCaosClientLogDetails(tc.details)
			if err != nil {
				t.Fatal(err)
			}
			// jsonb must receive JSON whose decoded strings and keys contain no NUL.
			var databaseValue interface{}
			if err := json.Unmarshal(stored, &databaseValue); err != nil {
				t.Fatal(err)
			}
			assertCaosDetailsHaveNoNUL(t, databaseValue)
			restored, wrapped := decodeCaosClientLogDetails(stored)
			if wrapped != tc.wrapped || string(restored) != string(original) {
				t.Fatalf("decode = %s, wrapped=%v; want %s, wrapped=%v", restored, wrapped, original, tc.wrapped)
			}
			// Public GET/export serializer must decode before classifying the event.
			data, err := json.Marshal(CaosClientLog{Event: "ui.click", Details: stored})
			if err != nil {
				t.Fatal(err)
			}
			var response struct {
				Details map[string]interface{} `json:"details"`
			}
			if err := json.Unmarshal(data, &response); err != nil {
				t.Fatal(err)
			}
			category := "human"
			if tc.details["isTrusted"] == false {
				category = "system"
			}
			if response.Details["category"] != category {
				t.Fatalf("category = %v, want %s", response.Details["category"], category)
			}
			delete(response.Details, "category")
			if !reflect.DeepEqual(response.Details, tc.details) {
				t.Fatalf("GET/export = %#v, want %#v", response.Details, tc.details)
			}
			unchanged, _ := json.Marshal(tc.details)
			if string(unchanged) != string(original) {
				t.Fatal("encoding mutated input details")
			}
		})
	}
}

func assertCaosDetailsHaveNoNUL(t *testing.T, value interface{}) {
	t.Helper()
	switch v := value.(type) {
	case string:
		if strings.ContainsRune(v, 0) {
			t.Fatal("stored JSON contains a NUL string")
		}
	case []interface{}:
		for _, child := range v {
			assertCaosDetailsHaveNoNUL(t, child)
		}
	case map[string]interface{}:
		for key, child := range v {
			assertCaosDetailsHaveNoNUL(t, key)
			assertCaosDetailsHaveNoNUL(t, child)
		}
	}
}
