package main

import "testing"

// DB_MAX_OPEN_CONNS は未設定なら既定値、正の整数ならその値。
// それ以外は起動を止める（黙って既定値にすると、Cloud SQL の上限を超えても気づけない）。
func TestDBMaxOpenConnsFromEnv(t *testing.T) {
	tests := []struct {
		value   string
		want    int
		wantErr bool
	}{
		{value: "", want: defaultDBMaxOpenConns},
		{value: "3", want: 3},
		{value: "0", wantErr: true},
		{value: "-1", wantErr: true},
		{value: "abc", wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.value, func(t *testing.T) {
			t.Setenv("DB_MAX_OPEN_CONNS", tt.value)
			got, err := dbMaxOpenConnsFromEnv()
			if tt.wantErr {
				if err == nil {
					t.Fatalf("エラーにならなかった（%d）", got)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if got != tt.want {
				t.Fatalf("got %d, want %d", got, tt.want)
			}
		})
	}
}
