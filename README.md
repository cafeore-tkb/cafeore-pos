# cafeore

## Get Started

Run `pnpm i` to install dependencies.

## Commands
|command|description|
|--|--|
|`pnpm i`| Install dependencies|
|`pnpm pos` (`dev`\|`build`\|`preview`\|`typecheck`)| Run commands in `services/pos`|
|`pnpm mobile` (`dev`\|`build`\|`start`\|`typecheck`)| Run commands in `services/mobile`|
|`pnpm common` (`typecheck`\|`test:`(`unit`\|`db`)) | Run commands in `modules/common`|

## CI / CD

`.github/workflows` にある workflow。`*-ci` は検査のみ、`*-build` は成果物を
Artifact Registry に置く、`pos-deploy-*` は Firebase Hosting に出す。

| workflow | 対象 | 何をするか |
|--|--|--|
| `pos-ci` / `mobile-ci` / `common-ci` / `api-ci` | 各パッケージ | typecheck / lint / unit test |
| `pos-build` | `services/pos` | ビルドして静的ファイルを Artifact Registry へ upload |
| `mobile-build` | `services/mobile` | 同上 |
| `api-build` | `api` | コンテナイメージをビルドして Artifact Registry へ push |
| `pos-deploy-merge` / `pos-deploy-pull-request` | `services/pos` | Firebase Hosting へデプロイ |

### `*-build` について

main への push・PR・手動実行（`workflow_dispatch`）で動く。**デプロイはしない**。
成果物を置くところまで。

GCP への認証は Workload Identity Federation で、サービスアカウントキーは使わない。
そのため job に `permissions: id-token: write` が要る（消すと認証が落ちる）。
fork からの PR には OIDC トークンが発行されないので、job 自体をスキップしている。

GCP 側の構成（WIF プール・サービスアカウント・Artifact Registry リポジトリ）は
[infra リポジトリ](https://github.com/cafeore-tkb/infra) の `gcp/github_actions.tf`
にある。成果物のパスやタグの一覧もそちらの README にまとめてある。

### 設定値

Terraform を既定値のまま apply していれば、**追加設定なしで動く**。
値を変えたときだけリポジトリの Variables で上書きする（秘密情報ではないので Secrets ではない）。

`GCP_WORKLOAD_IDENTITY_PROVIDER` / `GCP_SERVICE_ACCOUNT` / `GCP_PROJECT_ID` /
`GCP_REGION` / `GCP_AR_CONTAINER_REPOSITORY` / `GCP_AR_WEB_REPOSITORY`

フロントのビルドに焼き込む値は別で、これらは**ブラウザから読める**ので注意。

| キー | 種別 | 使う workflow |
|--|--|--|
| `VITE_API_BASE_URL` | Variables | `pos-build` / `mobile-build` |
| `VITE_SOHOSAI_VOTE_URL` | Variables | `mobile-build` |
| `WEBHOOK_URL` | Secrets | `pos-build`（既存の `pos-deploy-*` と共用） |
