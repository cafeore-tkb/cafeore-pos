# syntax=docker/dockerfile:1

# POS の画面を Cloud Run（cafeore-pos-web）で配るイメージ。PR のプレビューは今までどおり
# Workers（wrangler.jsonc）。デプロイは本番が .github/workflows/pos-deploy-cloudrun.yml、
# staging と sandbox（cafeore-pos-stg-web など）が deploy-environment.yml で、環境ごとにビルドする。
#
# 中に入れるのは、画面（build/client）と、それを配るサーバー（server/ を esbuild で 1 つの
# ファイルにまとめたもの。send・@google-cloud/storage もその中に入る）だけ。node_modules は持たない。
#
# ビルドのコンテキストはリポジトリのルート（pnpm のワークスペースの modules/common を使うため）:
#
#   docker build -f services/pos/Dockerfile \
#     --build-arg VITE_API_BASE_URL=https://pos.cafeore.cafe .
#
# 環境変数（PORT・CALL_VOICES_BUCKET・ELEVENLABS_API_KEY）は server/main.ts を参照。

ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-bookworm-slim AS build

WORKDIR /repo

# pnpm は package.json の packageManager の版を corepack で使う。
# husky（ルートの prepare）は git が無いと動かないので止める。
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    HUSKY=0
RUN corepack enable

# 依存を先に取ってくる。lockfile が変わらなければ、この層はキャッシュが効く
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch

COPY . .
RUN pnpm install --frozen-lockfile --offline

# 画面に焼き込む値。.github/workflows/pos-deploy-workers.yml の「ビルドする」と同じものを渡す。
# ここに入れた値はブラウザから読める。
#
#   - VITE_API_BASE_URL … API のオリジン。本番は画面と同じ https://pos.cafeore.cafe
#     （LB が /api・/status・/health を API に送る）。無いと localhost を向くので、止める
#   - VITE_BUILD_PR・VITE_BUILD_COMMIT … どの PR・コミットのビルドか（トップページに出す）
#   - VITE_DEPLOY_ENV … どこに出したビルドか。既定は production（レジの「常に返金」を出さない）。
#     staging と sandbox は staging・sandbox を渡す（こちらも出さない）
#   - VITE_WEBHOOK_URL … Slack の Webhook。secret で渡す（--secret id=VITE_WEBHOOK_URL,env=...）。
#     ビルド引数にするとイメージのビルドの記録に残るため。無ければ空
ARG VITE_API_BASE_URL
ARG VITE_BUILD_PR=""
ARG VITE_BUILD_COMMIT=""
ARG VITE_DEPLOY_ENV=production

WORKDIR /repo/services/pos
RUN test -n "$VITE_API_BASE_URL" \
    || (echo "VITE_API_BASE_URL を --build-arg で渡す（本番は https://pos.cafeore.cafe）" >&2 && exit 1)
RUN --mount=type=secret,id=VITE_WEBHOOK_URL,env=VITE_WEBHOOK_URL \
    pnpm run build \
    && pnpm run build:server \
    && node build/node/precompress-cli.cjs build/client

# シェルも npm も無い、Node だけの小さなイメージ。uid 65532（nonroot）で動く。
# ファイルは root のものなので、サーバーからは読むだけになる
FROM gcr.io/distroless/nodejs${NODE_VERSION}-debian12:nonroot

WORKDIR /app

COPY --from=build /repo/services/pos/build/client ./build/client
COPY --from=build /repo/services/pos/build/node/main.cjs /repo/services/pos/build/node/main.cjs.map ./build/node/

ENV NODE_ENV=production

EXPOSE 8080

# ENTRYPOINT は node（distroless の nodejs イメージが決めている）
CMD ["--enable-source-maps", "build/node/main.cjs"]
