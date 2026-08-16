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

`.github/workflows` にある workflow。`*-ci` は検査のみ、`api-build` は Artifact
Registry に成果物を置く、`*-deploy-*` はデプロイする。

| workflow | 対象 | 何をするか |
|--|--|--|
| `pos-ci` / `mobile-ci` / `common-ci` / `api-ci` | 各パッケージ | typecheck / lint / unit test |
| `api-build` | `api` | コンテナイメージをビルドして Artifact Registry へ push |
| `pos-deploy-workers` | `services/pos` | ビルドして Cloudflare Workers へデプロイ |
| `mobile-deploy-workers` | `services/mobile` | 同上 |
| `pos-deploy-merge` / `pos-deploy-pull-request` | `services/pos` | Firebase Hosting へデプロイ（**Workers と並行稼働中**） |
| `pr-cleanup` | — | PR を閉じたときに Artifact Registry の `pr-<番号>` タグを外す |

### フロントエンド（Cloudflare Workers）

POS と mobile はどちらも `ssr: false` の SPA。Worker のスクリプトは持たず、
`build/client` を静的アセットとして配信するだけの構成にしている
（`services/*/wrangler.jsonc`）。アセットに無いパスは `index.html` を返す
（`not_found_handling: single-page-application`）。

main への push と手動実行では本番へ `wrangler deploy` する。PR では
`wrangler versions upload` に切り替え、本番のトラフィックは向けずに
プレビュー URL 付きのバージョンだけ作る。URL は job の Summary に出る。

**初回だけ順番に注意。** `versions upload` は対象の Worker が既に存在している
ことが前提なので、いちばん最初は main へのマージか手動実行を先に通すこと。

| Worker 名 | 対象 |
|--|--|
| `cafeore-pos` | `services/pos` |
| `cafeore-mobile` | `services/mobile` |

ローカルからは `pnpm pos deploy` / `pnpm mobile deploy` で同じことができる。

### backend（Artifact Registry）

`api-build` が `api/Dockerfile` からイメージを作り、Artifact Registry へ push する。
デプロイはしない（イメージを置くだけ）。

GCP への認証は Workload Identity Federation で、サービスアカウントキーは使わない。
そのため job に `permissions: id-token: write` が要る（消すと認証が落ちる）。
GCP 側の構成は [infra リポジトリ](https://github.com/cafeore-tkb/infra) の
`gcp/github_actions.tf` にある。

fork からの PR には secrets も OIDC トークンも渡らないので、
デプロイ系の job は fork PR ではスキップしている。

### 誰がデプロイできるか（public リポジトリ前提）

**信頼の境界は「このリポジトリへの write 権限」。** write を持つ人はデプロイできる、
という前提で運用する。逆に言えば、**write を持たない人はデプロイできない。**

fork からの PR は二重に止まる。

1. GitHub 自体が、fork からの `pull_request` に secrets を渡さず `id-token: write` も
   与えない。`CLOUDFLARE_API_TOKEN` は空になり、WIF のトークンも発行されない
2. デプロイ系 job の `if` が `head.repo.full_name == github.repository` を見ていて、
   fork の PR では job ごとスキップされる

デプロイ系の workflow は `pull_request_target` を**使っていない**（全て `pull_request`）。
そのため fork の PR のコードがこのリポジトリの権限で走ることはない。

一方、**write 権限を持つ人は制限されない。** 同じリポジトリのブランチから PR を出せば
上の条件を通り、`pull_request` は PR 側の workflow 定義で走るので、workflow を書き換えれば
secrets も取り出せる。main への直 push もそのまま本番デプロイになる。これは想定どおりで、
権限の配り方でコントロールする。

そのため次の運用を守ること。

- 外部の人には write 権限を渡さない。コントリビュートは fork からの PR に統一する
- Settings → Actions → General の
  「Fork pull request workflows from outside collaborators」を
  **Require approval for all external contributors** にする
  （fork の PR はデプロイできないが、runner の使用自体を承認制にする）
- `main` にブランチ保護をかけ、直 push を禁止して PR 経由に統一する

Dependabot の PR はデプロイ系 job から除外している（`github.actor != 'dependabot[bot]'`）。
Dependabot が起点の実行には Actions の secrets が渡らず、権限も read-only なので、
除外しないと npm 更新のたびに落ちるため。依存更新の妥当性は `*-ci` の typecheck で見る。

### PR を閉じたときの後片付け

**Artifact Registry** … `pr-cleanup` がその PR の `pr-<番号>` タグを外す。
タグが外れたイメージは infra 側のクリーンアップポリシーが7日後に消す。
タグだけを外して本体を消さないのは、fast-forward マージなどで PR の head と
main の tip が同じコミットになったとき、同じダイジェストを `latest` が
指している可能性があるため。

そのため `api-build` は **PR のイメージに `pr-<番号>` しか付けない**
（sha タグも付けると、タグを外してもイメージが TAGGED のまま残り回収されない）。
workflow が落ちた PR や閉じられないまま放置された PR 用に、30日経った `pr-` タグを
消す保険のポリシーも入れてある。

**Cloudflare Workers** … 片付けていない。wrangler に `versions delete` が無く、
`versions upload` で作ったバージョンを個別に消す手段が今のところ無いため
（`wrangler preview delete` は private beta）。閉じた PR のプレビュー URL も
残り続ける。公開したままにしたくない場合は `wrangler.jsonc` の `preview_urls` を
`false` にして、プレビュー URL の配信自体を止めること。

### 必要な設定

| キー | 種別 | 使う workflow |
|--|--|--|
| `CLOUDFLARE_API_TOKEN` | Secrets | `pos-deploy-workers` / `mobile-deploy-workers` |
| `CLOUDFLARE_ACCOUNT_ID` | Secrets | 同上 |
| `WEBHOOK_URL` | Secrets | `pos-deploy-workers`（既存の `pos-deploy-*` と共用） |
| `VITE_API_BASE_URL` | Variables | `pos-deploy-workers` / `mobile-deploy-workers` |
| `VITE_SOHOSAI_VOTE_URL` | Variables | `mobile-deploy-workers` |

`VITE_*` は静的ファイルに焼き込まれるので**ブラウザから読める**。未設定だと
空文字が焼き込まれる。

GCP 側（`api-build`）は Terraform を既定値のまま apply していれば追加設定は不要。
値を変えたときだけ `GCP_WORKLOAD_IDENTITY_PROVIDER` / `GCP_SERVICE_ACCOUNT` /
`GCP_PROJECT_ID` / `GCP_REGION` / `GCP_AR_CONTAINER_REPOSITORY` を Variables で上書きする。
