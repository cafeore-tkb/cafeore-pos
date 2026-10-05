package main

import (
	"fmt"
	"sort"

	"gorm.io/gorm"
)

// findSchemaDrift は、DB の public スキーマにあってモデル（schemaModels）に無いもの、
// またはその逆を、人が読める形で並べて返す。何も無ければ空。
//
// スキーマの正本はモデルだけなので、ここで見つかるのは手で DB を触った跡
// （本番に直接作ったテーブル・列・トリガー・関数）。起動時に調べて /status に出し、
// デプロイの CI が空でなければ落とす。
//
// 見るのはテーブル・列・トリガー・関数。CaOS（caos スキーマ）のものは今は対象外にしている。
func findSchemaDrift(db *gorm.DB) ([]string, error) {
	expected := map[string]map[string]bool{}
	for _, m := range schemaModels() {
		stmt := &gorm.Statement{DB: db}
		if err := stmt.Parse(m); err != nil {
			return nil, fmt.Errorf("failed to parse model %T: %w", m, err)
		}
		cols := map[string]bool{}
		for _, name := range stmt.Schema.DBNames {
			cols[name] = true
		}
		expected[stmt.Schema.Table] = cols
	}

	var columns []struct {
		TableName  string
		ColumnName string
	}
	if err := db.Raw(`
		SELECT c.table_name, c.column_name
		FROM information_schema.columns c
		JOIN information_schema.tables t
		  ON t.table_schema = c.table_schema AND t.table_name = c.table_name
		WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'`).
		Scan(&columns).Error; err != nil {
		return nil, fmt.Errorf("failed to list columns: %w", err)
	}

	drift := []string{}
	actual := map[string]map[string]bool{}
	for _, c := range columns {
		if actual[c.TableName] == nil {
			actual[c.TableName] = map[string]bool{}
		}
		actual[c.TableName][c.ColumnName] = true
	}
	for table, cols := range actual {
		want, ok := expected[table]
		if !ok {
			drift = append(drift, fmt.Sprintf("モデルに無いテーブル: %s", table))
			continue
		}
		for col := range cols {
			if !want[col] {
				drift = append(drift, fmt.Sprintf("モデルに無い列: %s.%s", table, col))
			}
		}
	}
	for table, cols := range expected {
		have, ok := actual[table]
		if !ok {
			drift = append(drift, fmt.Sprintf("DB に無いテーブル: %s", table))
			continue
		}
		for col := range cols {
			if !have[col] {
				drift = append(drift, fmt.Sprintf("DB に無い列: %s.%s", table, col))
			}
		}
	}

	// モデルからはトリガーも関数も作らないので、public にあれば全部ズレ。
	// CaOS の関数（caos スキーマ）を呼ぶトリガーは対象外。拡張の関数（uuid-ossp など）も除く。
	var triggers []string
	if err := db.Raw(`
		SELECT c.relname || '.' || t.tgname
		FROM pg_trigger t
		JOIN pg_class c ON c.oid = t.tgrelid
		JOIN pg_namespace n ON n.oid = c.relnamespace
		JOIN pg_proc p ON p.oid = t.tgfoid
		JOIN pg_namespace pn ON pn.oid = p.pronamespace
		WHERE NOT t.tgisinternal AND n.nspname = 'public' AND pn.nspname <> 'caos'`).
		Scan(&triggers).Error; err != nil {
		return nil, fmt.Errorf("failed to list triggers: %w", err)
	}
	for _, t := range triggers {
		drift = append(drift, fmt.Sprintf("モデルに無いトリガー: %s", t))
	}

	var functions []string
	if err := db.Raw(`
		SELECT p.proname
		FROM pg_proc p
		JOIN pg_namespace n ON n.oid = p.pronamespace
		WHERE n.nspname = 'public'
		  AND NOT EXISTS (
		    SELECT 1 FROM pg_depend d
		    WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e'
		  )`).
		Scan(&functions).Error; err != nil {
		return nil, fmt.Errorf("failed to list functions: %w", err)
	}
	for _, f := range functions {
		drift = append(drift, fmt.Sprintf("モデルに無い関数: %s", f))
	}

	sort.Strings(drift)
	return drift, nil
}
