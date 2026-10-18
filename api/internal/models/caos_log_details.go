package models

import (
	"bytes"
	"encoding/json"
)

const caosLogDetailsEncoding = "_caos_original_details_json_v1"

// EncodeCaosClientLogDetails keeps NUL-containing legacy comment keys lossless.
// PostgreSQL jsonb rejects \u0000, even though it is valid JSON. Store the
// original JSON as a string in that case; GET/export unwrap it before use.
func EncodeCaosClientLogDetails(details map[string]interface{}) (json.RawMessage, error) {
	raw, err := json.Marshal(details)
	if err != nil {
		return nil, err
	}
	_, encodedShape := decodeCaosClientLogDetails(raw)
	if !bytes.Contains(raw, []byte(`\u0000`)) && !encodedShape {
		return raw, nil
	}
	// Also wrap a literal user value shaped like our envelope, so decoding once
	// cannot mistake that value for an internally encoded record.
	return json.Marshal(map[string]string{caosLogDetailsEncoding: string(raw)})
}

func decodeCaosClientLogDetails(raw json.RawMessage) (json.RawMessage, bool) {
	var envelope map[string]json.RawMessage
	if json.Unmarshal(raw, &envelope) != nil || len(envelope) != 1 {
		return raw, false
	}
	encoded, exists := envelope[caosLogDetailsEncoding]
	if !exists {
		return raw, false
	}
	var original string
	if json.Unmarshal(encoded, &original) != nil || !json.Valid([]byte(original)) {
		return raw, false
	}
	return json.RawMessage(original), true
}
