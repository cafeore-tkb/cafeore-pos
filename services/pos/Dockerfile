# POS の画面を返す web のコンテナ（Cloud Run の cafeore-pos-web と、PR のプレビューの cafeore-pos-web-preview）。
#
# 中では何もビルドしない。先に services/pos で
#
#   pnpm run build         … build/client（VITE_* を焼き込む）
#   pnpm run build:server  … build/web-server.mjs（server/ を 1 ファイルに束ねたもの）
#
# を作り、それをコピーするだけ（CI は .github/workflows/pos-deploy-cloudrun.yml）。VITE_* はビルドのときに
# 焼き込まれるので、本番と PR のプレビューで別のイメージになる。手元では上の 2 つのあと docker build -t pos-web . する。
#
# 束ねたサーバーは node: のもの以外を使わないので、node_modules は要らない。
FROM node:22-slim

ENV NODE_ENV=production

WORKDIR /app

# root の持ち物のまま置き、走らせる node からは読むだけにする。
# web-server.mjs は隣の client/ を返す（server/index.ts）。
COPY build/client ./client
COPY build/web-server.mjs ./web-server.mjs

USER node

# Cloud Run が PORT を入れる（既定 8080）
EXPOSE 8080

CMD ["node", "web-server.mjs"]
