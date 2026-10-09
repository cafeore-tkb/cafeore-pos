package main

import (
	"os"
	"regexp"
	"sort"
	"strings"
	"testing"

	"cafeore-pos/api/internal/handlers"

	"github.com/gin-gonic/gin"
	"github.com/goccy/go-yaml"
)

// openapi.yaml に書いていないが登録しているルート。
var routesOutsideOpenAPI = map[string]bool{
	"GET /health":        true, // Cloud Run などの疎通確認
	"GET /api/ws/orders": true, // WebSocket
}

var openAPIPathParam = regexp.MustCompile(`\{([^}]+)\}`)

// paths の下でメソッドとして扱うキー。parameters などはメソッドではない。
var openAPIMethods = map[string]bool{
	"get": true, "post": true, "put": true, "patch": true,
	"delete": true, "head": true, "options": true,
}

// openapi.yaml の paths にある操作を「METHOD /path/:param」の形で返す。
func openAPIOperations(t *testing.T) map[string]bool {
	t.Helper()

	b, err := os.ReadFile("../../../openapi/openapi.yaml")
	if err != nil {
		t.Fatalf("openapi.yaml を開けない: %v", err)
	}
	var doc struct {
		Paths map[string]map[string]any `yaml:"paths"`
	}
	if err := yaml.Unmarshal(b, &doc); err != nil {
		t.Fatalf("openapi.yaml を読めない: %v", err)
	}

	ops := map[string]bool{}
	for path, item := range doc.Paths {
		ginPath := openAPIPathParam.ReplaceAllString(path, ":$1")
		for method := range item {
			if openAPIMethods[method] {
				ops[strings.ToUpper(method)+" "+ginPath] = true
			}
		}
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
	// ハンドラーは登録するだけで呼ばないので、DB などは nil のままでよい
	registerStatusRoutes(r)
	handlers.RegisterRoutes(r, nil, nil, nil)

	registered := map[string]bool{}
	for _, route := range r.Routes() {
		registered[route.Method+" "+route.Path] = true
	}

	documented := openAPIOperations(t)
	for op := range routesOutsideOpenAPI {
		documented[op] = true
	}

	var missing, undocumented []string
	for op := range documented {
		if !registered[op] {
			missing = append(missing, op)
		}
	}
	for op := range registered {
		if !documented[op] {
			undocumented = append(undocumented, op)
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
