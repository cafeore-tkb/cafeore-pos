#!/bin/bash
# openapi/generate.sh

set -e

echo "OpenAPIから型を生成します..."

# TypeScript型生成
echo "TypeScript型を生成中..."
mkdir -p ../modules/common/types
npx openapi-typescript openapi.yaml -o ../modules/common/types/api.ts
echo "TypeScript型を生成しました"

# Go型生成
echo "Go型を生成中..."
mkdir -p ../api/internal/models
mkdir -p ../api/internal/handlers
oapi-codegen -generate types -package models openapi.yaml > ../api/internal/models/api.go
oapi-codegen -generate gin -package handlers openapi.yaml > ../api/internal/handlers/api_gin.go
echo "Go型を生成しました"

echo ""
echo "型生成が完了しました！"
```
