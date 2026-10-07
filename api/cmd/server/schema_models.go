package main

import (
	"cafeore-pos/api/internal/caos"
	"cafeore-pos/api/internal/models"
)

// schemaModels は、起動時に DB へ反映し（migrate）、ズレを調べる（findSchemaDrift）モデルの一覧。
//
// models.All() に、models を使う側のパッケージが持つモデル（CaOS の盤面の caos.Models()）を足したもの。
// caos は models を import しているので、models.All() には入れられない。
func schemaModels() []any {
	return append(models.All(), caos.Models()...)
}
