package handlers

import (
	"strings"
	"testing"

	"cafeore-pos/api/internal/models"
	"cafeore-pos/api/internal/square"
	"github.com/google/uuid"
)

func TestSquareDeviceStatusFor(t *testing.T) {
	cases := map[string]string{
		"PAIRED":   squareDevicePaired,
		"EXPIRED":  squareDeviceExpired,
		"UNPAIRED": squareDeviceUnpaired,
		"UNKNOWN":  squareDeviceUnpaired,
		"":         squareDeviceUnpaired,
	}
	for status, want := range cases {
		if got := squareDeviceStatusFor(status); got != want {
			t.Fatalf("%q: got %s, want %s", status, got, want)
		}
	}
}

func TestLatestPairedCodes(t *testing.T) {
	codes := []square.DeviceCode{
		{ID: "a-old", Name: "古い名前", DeviceID: "dev-a", Status: "PAIRED", StatusChangedAt: "2026-10-01T10:00:00.000Z"},
		{ID: "b", Name: "レジB", DeviceID: "dev-b", Status: "PAIRED", StatusChangedAt: "2026-10-02T10:00:00Z"},
		{ID: "a-new", Name: "レジA", DeviceID: "dev-a", Status: "PAIRED", StatusChangedAt: "2026-10-03T10:00:00.000Z"},
		// ペアリングされていないコードは取り込まない。
		{ID: "unpaired", Name: "未使用", Status: "UNPAIRED"},
		{ID: "expired", Name: "期限切れ", Status: "EXPIRED"},
		{ID: "no-device", Name: "device_id が無い", Status: "PAIRED"},
	}
	got := latestPairedCodes(codes)
	if len(got) != 2 {
		t.Fatalf("expected one code per device, got %+v", got)
	}
	// ペアリングした順に並び、同じ端末は最後にペアリングしたコードを使う。
	if got[0].ID != "b" || got[1].ID != "a-new" {
		t.Fatalf("unexpected order or choice: %+v", got)
	}
}

func TestLatestPairedCodesFallsBackToCreatedAt(t *testing.T) {
	got := latestPairedCodes([]square.DeviceCode{
		{ID: "new", DeviceID: "dev", Status: "PAIRED", CreatedAt: "2026-10-03T10:00:00Z"},
		{ID: "old", DeviceID: "dev", Status: "PAIRED", CreatedAt: "2026-10-01T10:00:00Z"},
	})
	if len(got) != 1 || got[0].ID != "new" {
		t.Fatalf("unexpected choice: %+v", got)
	}
}

func TestValidateSquareDeviceName(t *testing.T) {
	if name, err := validateSquareDeviceName("  レジ1 "); err != nil || name != "レジ1" {
		t.Fatalf("got %q, %v", name, err)
	}
	// 文字数で数える（日本語の 64 文字は通す）。
	if _, err := validateSquareDeviceName(strings.Repeat("レ", squareDeviceNameMaxLength)); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"", "   ", strings.Repeat("a", squareDeviceNameMaxLength+1)} {
		if _, err := validateSquareDeviceName(name); err == nil {
			t.Fatalf("%q must be rejected", name)
		}
	}
}

func TestToSquareDeviceResponseShowsCodeOnlyWhilePairing(t *testing.T) {
	code, codeID := "ABCDEF", "code-1"
	// ペアリング待ちの行と、ペアリング済みの端末にコードを発行し直した行は、コードを見せる。
	for _, status := range []string{squareDeviceUnpaired, squareDevicePaired} {
		device := &models.SquareDevice{ID: uuid.New(), Name: "レジ1", Status: status, CodeID: &codeID, Code: &code}
		if response := toSquareDeviceResponse(device); response.Code == nil || *response.Code != code || string(response.Status) != status {
			t.Fatalf("%s device waiting for its code must show it: %+v", status, response)
		}
	}
	// 入力されたか期限が切れてコードを消した行は見せない（code_id は残る）。
	for _, status := range []string{squareDevicePaired, squareDeviceExpired} {
		device := &models.SquareDevice{ID: uuid.New(), Name: "レジ1", Status: status, CodeID: &codeID}
		if response := toSquareDeviceResponse(device); response.Code != nil {
			t.Fatalf("%s device must not show a code: %+v", status, response)
		}
	}
}

func TestParseSquareTime(t *testing.T) {
	if parseSquareTime("") != nil || parseSquareTime("not a time") != nil {
		t.Fatal("empty or invalid time must be nil")
	}
	parsed := parseSquareTime("2026-10-11T06:05:00.123Z")
	if parsed == nil || parsed.Minute() != 5 {
		t.Fatalf("unexpected time: %v", parsed)
	}
}
