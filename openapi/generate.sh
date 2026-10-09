#!/bin/bash
# openapi/generate.sh

set -e

echo "OpenAPIから型を生成します..."

# TypeScript型生成
echo "TypeScript型を生成中..."
mkdir -p ../modules/common/src/types
npx openapi-typescript openapi.yaml -o ../modules/common/src/types/api.ts
echo "TypeScript型を生成しました"

# 一括取り込みの検証に使うスキーマ（JSON）
pnpm -F @cafeore/common generate:schemas

# Go型生成
echo "Go型を生成中..."
# 型だけを生成する。ルートは api/internal/handlers/routes.go に手書きで登録し、
# openapi.yaml と食い違っていないかは api/cmd/server/routes_test.go で確かめる。
mkdir -p ../api/internal/models
oapi-codegen -generate types -package models openapi.yaml > ../api/internal/models/api.go
echo "Go型を生成しました"

echo ""
echo "型生成が完了しました！"
```
