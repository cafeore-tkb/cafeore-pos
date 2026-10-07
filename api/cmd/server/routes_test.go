package main

import (
	"bufio"
	"os"
	"regexp"
	"sort"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

// openapi.yaml に書いていないが登録しているルート。
var routesOutsideOpenAPI = map[string]bool{
	"GET /health":        true, // Cloud Run などの疎通確認
	"GET /api/ws/orders": true, // WebSocket
}

var (
	openAPIPathLine   = regexp.MustCompile(`^  (/\S*):\s*$`)
	openAPIMethodLine = regexp.MustCompile(`^    (get|post|put|patch|delete|head|options):\s*$`)
	openAPIPathParam  = regexp.MustCompile(`\{([^}]+)\}`)
)

// openapi.yaml の paths にある操作を「METHOD /path/:param」の形で返す。
// paths の下はキーを2字下げ、メソッドを4字下げで書いている前提で読む。
func openAPIOperations(t *testing.T) []string {
	t.Helper()

	f, err := os.Open("../../../openapi/openapi.yaml")
	if err != nil {
		t.Fatalf("openapi.yaml を開けない: %v", err)
	}
	defer func() { _ = f.Close() }()

	var ops []string
	inPaths := false
	path := ""
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := scanner.Text()
		if line == "" || strings.HasPrefix(strings.TrimSpace(line), "#") {
			continue
		}
		if !strings.HasPrefix(line, " ") {
			inPaths = strings.HasPrefix(line, "paths:")
			continue
		}
		if !inPaths {
			continue
		}
		if m := openAPIPathLine.FindStringSubmatch(line); m != nil {
			path = openAPIPathParam.ReplaceAllString(m[1], ":$1")
			continue
		}
		if m := openAPIMethodLine.FindStringSubmatch(line); m != nil && path != "" {
			ops = append(ops, strings.ToUpper(m[1])+" "+path)
		}
	}
	if err := scanner.Err(); err != nil {
		t.Fatalf("openapi.yaml を読めない: %v", err)
	}
	if len(ops) == 0 {
		t.Fatal("openapi.yaml から操作を1つも読めなかった")
	}
	return ops
}

// openapi.yaml の操作がすべて登録されていて、openapi.yaml に無いルートを
// 黙って足していないことを確かめる。
func TestRegisterRoutesMatchesOpenAPI(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	// ハンドラーは登録するだけで呼ばないので、nil のままでよい
	registerRoutes(r, routeHandlers{})

	registered := map[string]bool{}
	for _, route := range r.Routes() {
		registered[route.Method+" "+route.Path] = true
	}

	documented := map[string]bool{}
	for _, op := range openAPIOperations(t) {
		documented[op] = true
	}

	var missing, undocumented []string
	for op := range documented {
		if !registered[op] {
			missing = append(missing, op)
		}
	}
	for op := range registered {
		if !documented[op] && !routesOutsideOpenAPI[op] {
			undocumented = append(undocumented, op)
		}
	}
	for op := range routesOutsideOpenAPI {
		if !registered[op] {
			missing = append(missing, op)
		}
	}
	sort.Strings(missing)
	sort.Strings(undocumented)

	if len(missing) > 0 {
		t.Errorf("登録していないルート:\n  %s", strings.Join(missing, "\n  "))
	}
	if len(undocumented) > 0 {
		t.Errorf("openapi.yaml に無いルート（書くか routesOutsideOpenAPI に足す）:\n  %s", strings.Join(undocumented, "\n  "))
	}
}
