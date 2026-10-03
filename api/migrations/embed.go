// Package migrations は DB のスキーマ変更を連番の SQL として持つ。
//
// 起動時に database.Migrate がまだ流していないものだけを順に流す。
// 新しく足すときは README の「DB のマイグレーション」を参照。
package migrations

import "embed"

//go:embed *.sql
var FS embed.FS
