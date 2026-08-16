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
| `api-build` | `api` | イメージをビルドして Artifact Registry へ push し、Cloud Run へデプロイ |
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
プレビュー URL 付きのバージョンだけ作る。

PR ではプレビュー URL を**コメントで貼る**。2回目以降は新しいコメントを足さず、
同じコメントを書き換える（本文に埋めた目印で自分のコメントを探している）。
POS と mobile は目印が別なので、それぞれ1件ずつ独立して更新される。

PR のビルドでは、`VITE_API_BASE_URL_PREVIEW` が設定されていればそれを
`VITE_API_BASE_URL` として焼き込む（Cloud Run の URL を入れる想定）。
未設定なら通常の `VITE_API_BASE_URL` にフォールバックする。値は次で取れる。

```
gcloud run services describe cafeore-pos-git \
  --project project-5d6e656b-4871-46ff-96f \
  --region asia-northeast1 --format='value(status.url)'
```

**初回だけ順番に注意。** `versions upload` は対象の Worker が既に存在している
ことが前提なので、まだ無いと失敗する。いちばん最初は main へのマージか手動実行を
先に通すこと。

それができない場合のために、Variables に `WORKERS_AUTO_DEPLOY_IF_NOT_EXIST` = `true`
を置くと、**Worker が存在しないときに限り** PR でも `wrangler deploy` に
フォールバックして Worker を作る。存在するかどうかは `wrangler versions list` で
先に確認しており、判定できなかった場合（認証エラーなど）は存在する前提で
`versions upload` を走らせる（誤って本番へ倒さないため）。

**この変数が有効な間は、PR から本番の Worker が作られる。** 立ち上げが済んだら
変数を消すこと。

| Worker 名 | 対象 |
|--|--|
| `cafeore-pos` | `services/pos` |
| `cafeore-mobile` | `services/mobile` |

ローカルからは `pnpm pos deploy` / `pnpm mobile deploy` で同じことができる。

### backend（Artifact Registry → Cloud Run）

`api-build` が `api/Dockerfile` からイメージを作り、Artifact Registry へ push する。
main への push と手動実行では、続けて Cloud Run サービス `cafeore-pos-git` を
そのイメージで更新する。**PR では本番に触らず、プレビュー用の別サービス**
（既定 `cafeore-pos-preview`）へデプロイし、その URL を PR にコメントする。

同じサービスにリビジョンタグ（`--no-traffic --tag`）を足す方法は取っていない。
それをやるとサービスのトラフィック設定が「常に最新リビジョン」から
「特定リビジョンへの固定」に変わり、main のデプロイが自動で切り替わらなくなるうえ、
Terraform の `traffic { type = LATEST }` と綱引きになるため。

プレビュー用サービスは**アクセスが無ければゼロまで縮む**ので、PR を放置しても
費用は増えない。

### PR ごとの Neon ブランチ

`NEON_PROJECT_ID` が設定されていれば、PR ごとに Neon のブランチ
`preview/pr-<番号>` を **0.25〜1 CU** で作り、その接続文字列を
プレビュー用 Cloud Run の `DATABASE_URL` に渡す。Cloud Run の環境変数は
リビジョン単位なので、PR ごとに違う DB を指せる。

ブランチは copy-on-write なので作成は即時。アイドル 5 分でゼロに縮む。
PR を閉じると `pr-cleanup` が compute ごと消す。

**ブランチ名の規則は `api-build.yml` の `NEON_BRANCH_PREFIX` と
`pr-cleanup.yml` の同名変数で揃えること。** ずれると閉じても消えず溜まる。

接続文字列は `::add-mask::` でログから伏せている。`gcloud` に渡すときは
区切り文字を `^@^` にしている（接続文字列に `=` と `&` が含まれ、既定の
カンマ区切りだと値が途中で切れるため）。

`NEON_PROJECT_ID` が未設定なら Neon まわりは丸ごとスキップする。その場合
`DATABASE_URL` が渡らないので、**プレビューのコンテナは起動時に落ちる**
（`initDB` が `log.Fatal` するため）。

イメージはタグではなく**ダイジェスト**で指定している。タグは後から別のイメージへ
付け替わりうるが、ダイジェストは今ビルドしたものを必ず指すため。

デプロイ先のサービスは既存の Cloud Build トリガー（infra の `cloud_build.tf`）も
更新している。あちらの発火条件は **`disable-auth` ブランチへの push** なので普段は
ぶつからないが、`disable-auth` に push するとそちらのビルドで上書きされる。
移行が済んだら Cloud Build トリガーを止めること。

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
| `WORKERS_CLOUDFLARE_API_TOKEN` | Secrets | `pos-deploy-workers` / `mobile-deploy-workers` |
| `WORKERS_CLOUDFLARE_ACCOUNT_ID` | Variables | 同上（アカウント ID は秘密情報ではない） |
| `WORKERS_AUTO_DEPLOY_IF_NOT_EXIST` | Variables | 同上（任意。`true` のときだけ上記のフォールバックが働く） |
| `WEBHOOK_URL` | Secrets | `pos-deploy-workers`（既存の `pos-deploy-*` と共用） |
| `VITE_API_BASE_URL` | Variables | `pos-deploy-workers` / `mobile-deploy-workers` |
| `VITE_API_BASE_URL_PREVIEW` | Variables | 任意。PR のビルドでのみ `VITE_API_BASE_URL` の代わりに使う |
| `NEON_API_KEY` | Secrets | PR ごとの Neon ブランチ作成・削除。project-scoped キー推奨 |
| `NEON_PROJECT_ID` | Variables | 同上。**未設定なら Neon 連携ごとスキップ** |
| `NEON_PREVIEW_CU` | Variables | 任意。既定 `0.25-1` |
| `VITE_SOHOSAI_VOTE_URL` | Variables | `mobile-deploy-workers` |

`VITE_*` は静的ファイルに焼き込まれるので**ブラウザから読める**。未設定だと
空文字が焼き込まれる。

GCP 側（`api-build`）は Terraform を既定値のまま apply していれば追加設定は不要。
値を変えたときだけ `GCP_WORKLOAD_IDENTITY_PROVIDER` / `GCP_SERVICE_ACCOUNT` /
`GCP_PROJECT_ID` / `GCP_REGION` / `GCP_AR_CONTAINER_REPOSITORY` / `GCP_CLOUD_RUN_SERVICE` /
`GCP_CLOUD_RUN_PREVIEW_SERVICE` を Variables で上書きする。
