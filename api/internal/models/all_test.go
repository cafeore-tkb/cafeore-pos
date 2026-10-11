package models

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"reflect"
	"sort"
	"strings"
	"testing"
)

// テーブルではない struct。models パッケージに足したらここに書く。
var notTables = map[string]bool{}

// models パッケージの struct は全部テーブルなので、All() に入っていなければならない。
// 入っていないと AutoMigrate されず、本番にテーブルが作られない（/status の schema_drift も
// All() を基準に比べるので気づけない）。#729 の order_cups と同じ 500 になる。
func TestAllCoversEveryModel(t *testing.T) {
	inAll := map[string]bool{}
	for _, m := range All() {
		inAll[reflect.TypeOf(m).Elem().Name()] = true
	}

	entries, err := os.ReadDir(".")
	if err != nil {
		t.Fatal(err)
	}
	fset := token.NewFileSet()
	var missing []string
	for _, e := range entries {
		name := e.Name()
		if e.IsDir() || !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") {
			continue
		}
		file, err := parser.ParseFile(fset, name, nil, parser.ParseComments)
		if err != nil {
			t.Fatal(err)
		}
		// api.go（oapi-codegen の出力）はリクエストとレスポンスの型で、テーブルではない
		if ast.IsGenerated(file) {
			continue
		}
		for _, decl := range file.Decls {
			gen, ok := decl.(*ast.GenDecl)
			if !ok || gen.Tok != token.TYPE {
				continue
			}
			for _, spec := range gen.Specs {
				ts := spec.(*ast.TypeSpec)
				if _, isStruct := ts.Type.(*ast.StructType); !isStruct || !ts.Name.IsExported() {
					continue
				}
				if !inAll[ts.Name.Name] && !notTables[ts.Name.Name] {
					missing = append(missing, ts.Name.Name+"（"+name+"）")
				}
			}
		}
	}

	sort.Strings(missing)
	if len(missing) > 0 {
		t.Fatalf("models.All() に入っていないモデルがある。テーブルなら All() に、そうでなければ notTables に足すこと:\n%s",
			strings.Join(missing, "\n"))
	}
}
