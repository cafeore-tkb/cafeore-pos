# cafeore

## Get Started

Run `pnpm i` to install dependencies.

## Commands
|command|description|
|--|--|
|`pnpm i`| Install dependencies|
|`pnpm pos` (`dev`\|`build`\|`preview`\|`typecheck`)| Run commands in `services/pos`|
|`pnpm common` (`typecheck`\|`test:unit`) | Run commands in `modules/common`|

## CI / CD

`.github/workflows` にある workflow。`*-ci` は検査のみ、`api-build` は Artifact
Registry に成果物を置く、`*-deploy-*` はデプロイする。

| workflow | 対象 | 何をするか |
|--|--|--|
| `pos-ci` / `common-ci` / `api-ci` | 各パッケージ | typecheck / lint / unit test（`api-ci` と `pos-ci` は Docker イメージのビルドも見る。push はしない） |
| `api-build` | `api` | イメージをビルドして Artifact Registry へ push し、Cloud Run へデプロイ |
| `pos-deploy-workers` | `services/pos` | ビルドして Cloudflare Workers へデプロイ（PR のプレビューと、[GCP に移した](#本番を-gcp-に移すiap)後は非常用の `pos-cf.cafeore.cafe`） |
| `pos-deploy-cloudrun` | `services/pos` | 本番だけ。画面のイメージを作って Artifact Registry へ push し、Cloud Run `cafeore-pos-web` へデプロイ（既定で動く。変数 `POS_WEB_DEPLOY` を `false` にすると止まる） |
| `deploy-staging` | `api`・`services/pos` | main への push と手動実行（main だけ）で、[staging](#staging-と-sandbox) に API と画面を出す（変数 `STAGING_DEPLOY` を `false` にすると止まる） |
| `deploy-sandbox` | `api`・`services/pos` | 手動実行だけ。選んだブランチを [sandbox](#staging-と-sandbox) に出す |
| `deploy-environment` | — | `deploy-staging`・`deploy-sandbox` が呼ぶ中身（reusable workflow。これだけでは走らない） |
| `pr-cleanup` | — | PR を閉じたときと `preview` ラベルを外したときに、プレビュー用の backend（Artifact Registry・Cloud Run のタグ、Neon のブランチ）を片付ける |
| `preview-adopt` | — | 手動実行のみ。ラベル運用より前から立っているプレビューの PR に `preview` ラベルを付ける |

### PR のプレビューは `preview` ラベルで出す

PR のプレビュー（下のフロントエンドと backend）は、**`preview` ラベルが付いた open な PR にだけ**出す。
ラベルの無い PR では `api-build` / `pos-deploy-workers` の job がスキップされる。

| 操作 | 何が起きるか |
|--|--|
| ラベルを付ける | プレビューをデプロイし、URL を PR にコメントする |
| ラベルが付いている間に push / reopen | デプロイし直す（コメントは書き換わる） |
| ラベルを外す | `pr-cleanup` が backend を片付ける |
| PR を閉じる | `pr-cleanup` が backend を片付け、全部成功したらラベルも外す |

- ラベルは「プレビューが出ている」ことを表す。閉じたときの片付けが失敗した場合は外さず、残っているものがあることを示す
- 閉じたときはラベルの有無にかかわらず片付ける（ラベル運用より前に出したプレビューも回収するため）
- 各 workflow の `paths` は今までどおり効く。対象のパスを触っていない PR は、ラベルを付けてもその workflow が走らない
- ラベルの無い PR でも、Docker イメージが作れるかは `api-ci` で見る。DB のスキーマのずれの検査（`/status` の `schema_drift`）はプレビューを出したときと main へのデプロイ時だけ
- フロントの Cloudflare Workers 側は、ラベルを外しても消えない（[後片付け](#pr-を閉じたときラベルを外したときの後片付け)を参照）。焼き込んだ backend の URL は外れるので、API には繋がらなくなる
- デプロイ中にラベルを外すと、片付けはデプロイが終わるのを待ってから走る（`api-build` と `pr-cleanup` が同じ concurrency group `preview-backend-pr-<番号>` に入る）
- `pr-cleanup` は `pull_request_target` なので、ラベルを外したときの片付けは **main にある定義**で走る。`pull_request` で走るデプロイ側は PR 側の定義で走る
- ラベルは事前に作っておくこと（無いと付けられない）

#### ラベル運用より前から立っているプレビュー

ラベルで出す運用より前に出したプレビューは、ラベルが無いまま残る。そのままだと push しても更新されず、
外すラベルも無いので、PR を閉じるまで片付かない。運用を切り替えた直後に
`preview-adopt`（Actions の「pr / adopt existing previews」）を**一回だけ手動で流して**、ラベルを付けてそろえる。

1. `dry_run` を `true`（既定）のまま流し、Summary に出る一覧で付ける予定の PR を確かめる
2. `dry_run` を `false` にしてもう一度流す

- 「立っている」とみなすのは、プレビュー用の Cloud Run サービスに `pr-<番号>` のタグがある PR（コメントは片付けた後も残るので見ない）
- すでにラベルがある PR、`preview` ラベルを付け外しした履歴がある PR（外したのに片付けが失敗した場合など）、閉じた PR、fork の PR には付けない。閉じた PR のタグは pr-cleanup の取りこぼしとして一覧に出る
- `GITHUB_TOKEN` で付けるので、デプロイは走らない。プレビューは次の push で最新になる
- 何度流しても結果は同じ。`workflow_dispatch` だけの workflow は main に入ってからでないと Actions の画面から流せない

### フロントエンド（Cloudflare Workers）

**本番の画面は GCP（Cloud Run と IAP）に移す。** この節の Worker は、移した後は PR のプレビューと、
非常用の予備の `pos-cf.cafeore.cafe` に使う（[本番を GCP に移す](#本番を-gcp-に移すiap)）。

POS は `ssr: false` の SPA。画面は `build/client` を静的アセットとして
配信する（`services/pos/wrangler.jsonc`）。アセットに無いパスは `index.html` を返す
（`not_found_handling: single-page-application`）。

Worker のスクリプトで `/api/*`・`/status`・`/health` を本番の API へ
中継する（`services/pos/worker/index.ts`。理由は [API の認証](#api-の認証cloudflare-access)）。
中継先は本番のデプロイのときだけ `WORKERS_API_ORIGIN` を `--var API_ORIGIN:...` で渡す。
今の中継先は mice の LB（`https://pos-be-lb.cafeore.cafe`）で、本番の画面は `VITE_API_BASE_URL` が
Worker 自身（GCP に移すまでは `https://pos.cafeore.cafe`、移した後は `https://pos-cf.cafeore.cafe`）なので、API を Worker 経由で呼ぶ。
PR のプレビューでは渡さないので、プレビューの URL の `/api` は 503 を返す
（プレビューの画面は Cloud Run を直接呼ぶので使わない）。

main への push と手動実行では本番へ `wrangler deploy` する。PR（`preview` ラベル付きのみ）では
`wrangler versions upload` に切り替え、本番のトラフィックは向けずに
プレビュー URL 付きのバージョンだけ作る。

本番の URL は Cloudflare の `cafeore` アカウントの独自ドメイン。GCP に移すまでは `https://pos.cafeore.cafe`、
移した後は非常用の `https://pos-cf.cafeore.cafe`（`pos.cafeore.cafe` は GCP の LB が使う）。2026-10-24 に `cafeorepos` アカウントの `https://cafeore-pos.cafeorepos.workers.dev` から移した
（[POS の Worker を cafeore のアカウントに移す](#pos-の-worker-を-cafeore-のアカウントに移す)）。
移したのは本番だけで、PR のプレビューは今までどおり `cafeorepos` に出す。本番の deploy は
`WORKERS_PROD_CLOUDFLARE_*` があればそのアカウントへ、無ければプレビューと同じ `WORKERS_CLOUDFLARE_*` のアカウントへ出す
（今は `WORKERS_PROD_*` に `cafeore` を入れてある）。
独自ドメインは、本番の deploy のときだけ変数 `WORKERS_CUSTOM_DOMAIN` を `--domain` で渡して付ける。
渡すと wrangler が本番の workers.dev（`cafeore-pos.<subdomain>.workers.dev`）を止める
（プレビュー URL は `wrangler.jsonc` の `preview_urls` で別に決まる）。

PR のバージョンには `pr-<番号>` のエイリアス（`--preview-alias`）も付ける。
`https://pr-<番号>-cafeore-pos.<subdomain>.workers.dev` は push しても変わらず、
その PR で最後に上げたバージョンを指す。バージョンごとの URL
（`https://<バージョン ID の先頭 8 文字>-cafeore-pos.…`）も別に残る。

PR ではプレビュー URL を**コメントで貼る**（エイリアスの URL と、その commit の URL）。
2回目以降は新しいコメントを足さず、同じコメントを書き換える
（本文に埋めた目印で自分のコメントを探している）。

PR のビルドでは、**その PR のリビジョンの URL をビルド前に確定させて**
`VITE_API_BASE_URL` に焼き込む。

backend は PR ごとに `--no-traffic --tag=pr-<番号>` でデプロイされ、
`https://pr-<番号>---<service>-<hash>.<region>.run.app` という専用 URL を持つ。
まず実物を `status.traffic` から引き、まだ backend がデプロイされていなければ
サービス URL のホスト名に `pr-<番号>---` を足して組み立てる（形式は同じなので、
あとで backend が出れば有効になる）。これで**順序制御なしにビルドを先に走らせられる**。
`VITE_*` はビルド時に焼き込まれるので、この確定はビルドより前に置いてある。

引けなかった場合は**落とさず**、`VITE_API_BASE_URL_PREVIEW` →
`VITE_API_BASE_URL` の順にフォールバックする。サービス未作成・GCP 障害・
権限不足のいずれでも、Cloudflare へのデプロイ自体は止めない。

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

ローカルからは `pnpm pos deploy` で同じことができる。
POS は `pnpm pos deploy --var API_ORIGIN:https://pos-be-lb.cafeore.cafe` のように中継先を必ず渡すこと。
渡さないと、画面は Worker 経由で API を呼ぶので、本番の POS が API に届かなくなる。
`CLOUDFLARE_ACCOUNT_ID` は `cafeore` のもの（`b52dd4bd917c4ef7537befffcb1dea42`）にし、`--domain pos.cafeore.cafe` も渡すこと。
渡さないと本番の workers.dev がまた開く。

### POS の Worker を cafeore のアカウントに移す

本番の POS の Worker を、Cloudflare の `cafeorepos` アカウント（`cafeore-pos.cafeorepos.workers.dev`）から
`cafeore` アカウントに移し、独自ドメイン `pos.cafeore.cafe` で出す。`cafeore.cafe` のゾーンは `cafeore` アカウントにあり、
独自ドメインは Worker と同じアカウントのゾーンにしか付けられない。URL がアカウントの workers.dev でなくなるので、
`cafeore.cafe` のゾーンと一緒に動かす限り、Worker をまた別のアカウントに移しても URL は変わらない
（Worker だけを移すと独自ドメインは付けられない）。

**移すのは本番だけ。PR のプレビューは今までどおり `cafeorepos` の `cafeore-pos` に出す**
（`pr-<番号>-cafeore-pos.cafeorepos.workers.dev`）。

```
移す前:   端末 ─→ cafeore-pos.cafeorepos.workers.dev（cafeorepos の Worker）─(トークン)─→ pos-be-lb.cafeore.cafe ─→ api
移した後: 端末 ─→ pos.cafeore.cafe（cafeore の Worker）              ─(トークン)─→ pos-be-lb.cafeore.cafe ─→ api
          PR の確認 ─→ pr-<番号>-cafeore-pos.cafeorepos.workers.dev（cafeorepos の Worker のプレビュー）─→ プレビュー用の Cloud Run
```

**今の状況（2026-10-24）**

- 手順 1〜3 は済んだ。`pos.cafeore.cafe` は `cafeore` の `cafeore-pos` を指し、その本番の workers.dev
  （`cafeore-pos.cafeore.workers.dev`）は止まっている。R2 のバケット `cafeore-call-voices` もある
- 手順 4（端末を移す）は現場の作業なので、ここからは確かめられない
- **手順 5 はまだ。** `cafeorepos` の `cafeore-pos` の本番の workers.dev が開いたままで、前のビルドがトークンを付けて
  API に中継できる。端末を移し終えたら止める

Worker をアカウントの間で動かす機能は無いので、`cafeore` に同じ名前の Worker を新しくデプロイする。
`pos-deploy-workers` は、本番の deploy を `WORKERS_PROD_CLOUDFLARE_*` のアカウントへ、PR の `versions upload` を
`WORKERS_CLOUDFLARE_*` のアカウントへ出す。中継先（`WORKERS_API_ORIGIN`）とトークン（`LB_PROXY_TOKEN`）は変えない。
backend を mice に移す手順（infra の README「本番を mice に移す」）とは別々に進められる。

**URL（オリジン）が変わるので、端末に残しているものは新しい URL に引き継がれない**（localStorage はオリジンごとに分かれている）。

| 引き継がれないもの | どうするか |
|--|--|
| 送れていない注文（レジ）・送れていない CaOS の操作・刷れなかったシール | **旧 URL で送り切ってから**端末を移す。残したまま移ると、旧 URL を開き直すまで送られない |
| プリンターの設定（IP・ポート）・代理印刷を手でオフにしたこと | 新しい URL で入れ直す（代理印刷はプリンターにつながればオンになる） |
| レジで使う Square の端末 | 各レジの画面右上で選び直す（ペアリングは DB にあるのでやり直さない） |
| 呼び出し画面の音・CaOS の画面の設定など | 入れ直す |

ブックマークとホーム画面のアイコンも旧 URL のままなので、付け直す。

決めてあること:

- ドメインは `pos.cafeore.cafe`（`WORKERS_CUSTOM_DOMAIN`）。DNS のレコードは、最初のデプロイで Cloudflare が作った
  （独自ドメインに付いてくる読み取り専用のレコード。infra の Terraform では管理しない）
- 新しい Worker の本番の workers.dev（`cafeore-pos.cafeore.workers.dev`）は止める（`--domain` を渡すと wrangler が止める）
- **`cafeorepos` の `cafeore-pos` は消さない。** `versions upload` は Worker が既にあることが前提なので、消すとプレビューを
  出せなくなる。代わりに、端末を移し終えたら本番の workers.dev だけを止める（手順 5）
- 呼び出しの音声のバケットは、本番が `cafeore`、プレビューが `cafeorepos` の、同じ名前の別のものになる。本番の音声は移さない。
  新しいバケットは空から始まり、呼んだ番号から ElevenLabs で作り直す（利用枠を使う）

#### 1. Cloudflare（`cafeore` アカウント。ダッシュボードで手作業）

1. Workers を Paid プランにする。契約はアカウントごとで、無料枠を超えると POS が止まる
   （[API の認証](#api-の認証cloudflare-access)の手順 1-1）
2. R2 を有効にし、バケット `cafeore-call-voices` を作る。無いと本番のデプロイが失敗する。
   バケットは wrangler ではなく infra の `cloudflare/`（workspace `cloudflare`）が Terraform で作る
   （infra の README「POS の Worker を cafeore のアカウントに移す」）

3. 本番のデプロイ用の API トークンを作る。テンプレートの「Edit Cloudflare Workers」で、Account Resources を `cafeore`、
   Zone Resources を `cafeore.cafe` だけにする。独自ドメインを付けるのに、ゾーンの Workers Routes の Edit が要る。
   最初のデプロイで Worker を作るので、Workers Scripts は Worker を指定しない（アカウント全体の）権限にする

   **`cafeore` アカウントにはほかの Worker（`website`・`url-shortener` など）もあり、このトークンはそれも書き換えられる。**
   workflow が使うのは本番の deploy（main への push と手動実行）のときだけだが、このリポジトリに write を持つ人は
   PR の workflow を書き換えて secrets を取り出せる（[誰がデプロイできるか](#誰がデプロイできるかpublic-リポジトリ前提)）ので、
   今までより届く範囲が広がる

#### 2. infra（CORS と在庫リマインドの URL）

infra の `frontend_origins` に `https://pos.cafeore.cafe` が入り、`pos_base_url` が `https://pos.cafeore.cafe` になった
main を、Worker をデプロイする前に apply する。新しい URL が `frontend_origins` に無いと、そこで開いた POS の
書き込みと WebSocket が 403 になる。詳しくは infra の README「POS の Worker を cafeore のアカウントに移す」。

#### 3. GitHub（このリポジトリ）に本番の出し先を足してデプロイする

次をまとめて入れてから、Actions の「pos / deploy (Workers)」を main で手動実行する。最初の deploy で、`cafeore` に
Worker と `pos.cafeore.cafe` ができる。

| キー | 種別 | 値 |
|--|--|--|
| `WORKERS_PROD_CLOUDFLARE_API_TOKEN` | Secrets | 手順 1-3 のトークン（足す） |
| `WORKERS_PROD_CLOUDFLARE_ACCOUNT_ID` | Variables | `b52dd4bd917c4ef7537befffcb1dea42`（`cafeore`。足す） |
| `WORKERS_CUSTOM_DOMAIN` | Variables | `pos.cafeore.cafe`（足す） |
| `VITE_API_BASE_URL` | Variables | 今 workers.dev を向けているなら `https://pos.cafeore.cafe`。Cloud Run や LB を直接向けているなら変えない |

`WORKERS_CLOUDFLARE_API_TOKEN`・`WORKERS_CLOUDFLARE_ACCOUNT_ID` は `cafeorepos` のまま触らない（プレビューが使う）。

デプロイの workflow は、次のときは出す前に止める。

- `WORKERS_PROD_*` のトークンとアカウント ID の片方だけがある
- `WORKERS_PROD_*` が無いのに `WORKERS_CUSTOM_DOMAIN` がある（`cafeorepos` には独自ドメインを付けられず、wrangler が先に
  workers.dev を止めて POS が止まるため）
- `WORKERS_CUSTOM_DOMAIN` があるのに `VITE_API_BASE_URL` が workers.dev のまま

確かめる:

- `https://pos.cafeore.cafe/status` が JSON を返す（Worker → LB → api）
- `https://cafeore-pos.cafeore.workers.dev/` が開かない
- トップページの一番下のビルドの番号が、今の main のもの
- 呼び出し画面で番号を呼ぶと読み上げが鳴る（新しいバケットに音声ができる）
- `preview` ラベルの付いた PR に push すると、今までどおり `cafeorepos` にプレビューが出る

#### 4. 端末を移す（営業していない時間に）

1. 各端末で旧 URL を開き、送れていない注文（レジのトースト）・CaOS の未送信・刷れなかったシールが無いことを確かめる
2. 新しい URL を開き、プリンター・Square の端末・呼び出し画面などの設定を入れ直す
3. ブックマークとホーム画面のアイコンを付け直す

#### 5. 旧 Worker の本番を止める

`cafeorepos` の `cafeore-pos` の本番は、移した後も前のビルドのまま、トークンを付けて API に中継し続ける。
プレビューのために Worker は消せないので、端末を移し終えたら本番の workers.dev だけを止める。

1. `cafeorepos` のダッシュボードの Workers & Pages → `cafeore-pos` → Domains で、workers.dev の本番（Production）を止め、
   プレビュー（Preview）は開いたままにする。PR の `versions upload` はこの設定を読むだけで変えない
2. infra の `frontend_origins` から `https://cafeore-pos.cafeorepos.workers.dev` を消す
3. 同じアカウントの `cafeore-mobile` は使っておらず、移さない（このリポジトリにもデプロイの workflow が無い）。消してよい

   ```sh
   CLOUDFLARE_ACCOUNT_ID=28555ebffffdd0f6ffb76e101fabea06 pnpm exec wrangler delete --name cafeore-mobile
   ```

**[API の認証](#api-の認証cloudflare-access)で Access を入れるなら、そのときトークン（`LB_PROXY_TOKEN`）も入れ替える。**
本番に出した前のバージョンには、それぞれプレビュー URL（`<バージョン ID の先頭 8 文字>-cafeore-pos.cafeorepos.workers.dev`）が
あり、トークンと中継先を持ったまま残る（バージョンは消せない）。`cafeore` の Access の外なので、そこが抜け道になる。
バージョン ID は Actions のログに出るので、URL は推測できる。infra の `api_proxy_token`（LB を持っている workspace 全部）と
`LB_PROXY_TOKEN` を新しい値にして、「pos / deploy (Workers)」を手動実行する（入れ替える間は POS が 403 になる。infra の README
「トークンの置き場所」）。PR のプレビューのバージョンが引き継ぐのは古いトークンで、中継先も持たないので、API には届かない。

#### 戻すとき

- `WORKERS_PROD_CLOUDFLARE_*` と `WORKERS_CUSTOM_DOMAIN` を消し、`VITE_API_BASE_URL` を元に戻して手動実行する。
  本番の deploy が `cafeorepos` に戻り、wrangler が workers.dev を開き直す（手順 5-1 で止めていても）。
  `pos.cafeore.cafe` は `cafeore` の Worker を指したまま残るので、要らなければダッシュボードで独自ドメインを外す
- 新しい URL で入れ直した端末の設定は、旧 URL には戻らない（旧 URL に残っているものはそのまま使える）

#### 確かめたこと

2026-10-24 の本番の deploy（「pos / deploy (Workers)」の手動実行）で次を確かめた。

- 手順 1-3 のトークンの権限で、`cafeore` に Worker を出して `pos.cafeore.cafe` を付けられた
- `--domain` を渡すと本番の workers.dev が止まり、`preview_urls` を書いてあればプレビュー URL は残る
  （`cafeore` の `cafeore-pos` は、本番の workers.dev が止まり、プレビューは開いている）

wrangler 4.123.0 のソースで次も確かめた（実物では見ていない）。

- CI では、既にある DNS レコードを上書きして独自ドメインを付ける
- `versions upload` は workers.dev とプレビューの設定を変えない。secret は前のバージョンから引き継ぎ、変数（`API_ORIGIN`）は引き継がない

### 本番を GCP に移す（IAP）

本番の POS（`pos.cafeore.cafe`）を Cloudflare Workers から GCP に移し、Identity-Aware Proxy（IAP）で守る。
**この仕組みは既定で有効**（infra の `pos_web_enabled`・`pos_on_gcp_lb`、このリポジトリの「pos / deploy (Cloud Run)」）で、
下の順番で merge と apply をした時点で本番が GCP に移る。Workers の本番は、GCP が止まったときの**非常用の予備として
`pos-cf.cafeore.cafe` に出し続ける**。PR のプレビューは今までどおり Workers（`cafeorepos`）。

```
移した後: 端末 ─→ pos.cafeore.cafe（mice の LB ＋ IAP）─┬─ /api/*・/status・/health ─→ cafeore-pos-prod
                                                       └─ それ以外 ─→ cafeore-pos-web（画面と /call-voice）
          非常用: 端末 ─→ pos-cf.cafeore.cafe（cafeore の Worker）─(トークン)─→ pos-be-lb.cafeore.cafe ─→ cafeore-pos-prod
          Square の Webhook・デプロイの CI ─→ pos-be-lb.cafeore.cafe（今までどおり）
          Cloud Scheduler（在庫リマインド）─→ run.app（今までどおり。内部として届く）
```

- **ログインは IAP**（Google アカウント）。IAP を通れる相手と api の許可リストは、どちらも infra の
  `api_auth_staff_emails`・`api_auth_viewer_emails` で決まる。`@id.cafeore.cafe` のようにドメインごとにも書ける
  （IAP の権限は `domain:id.cafeore.cafe` になる。Google Workspace か Cloud Identity のドメインだけ）。Cloudflare Access（[API の認証](#api-の認証cloudflare-access)）は使わない
- **`pos.cafeore.cafe` では Worker の中継とトークンが要らない。** 画面と API が同じ LB の同じオリジンに来て、LB の URL map が振り分ける。
  IAP が付ける JWT はブラウザには出ず、`cafeore-pos-prod` は LB と内部からしか届かないので、Access のときのように
  JWT を盗まれて Cloud Run を直接叩かれる心配も無い。api は念のため IAP の JWT を確かめる（`AUTH_MODE=iap`。`api/internal/auth/iap.go`）
- **オリジンは `https://pos.cafeore.cafe` のまま変わらない。** 端末の localStorage（送れていない注文、プリンター・Square の端末・
  代理印刷の設定など）はそのまま残り、入れ直さなくてよい。各端末で Google アカウントでのログインが 1 回要る
- 画面は Cloud Run `cafeore-pos-web`（`services/pos/Dockerfile`。Node のサーバーは `services/pos/server/`）。Worker がやっている
  ことのうち、`/api` の中継以外（静的ファイル・SPA のフォールバック・`/call-voice`）を受け持つ。呼び出しの音声は
  `worker/call-voice.ts` をそのまま使い、R2 の代わりに GCS のバケット（`<プロジェクト ID>-call-voices`）に溜める。中身は移さず、
  呼んだ番号から ElevenLabs で作り直す（利用枠を使う）。ElevenLabs の鍵は mice の Secret Manager の `elevenlabs-api-key`
- DB は今と同じ mice の Cloud SQL。メニューや注文はそのまま見える

#### 何を作ったか

| どこ | もの |
| --- | --- |
| このリポジトリ | `services/pos/server/`・`services/pos/Dockerfile`（画面のサーバーとイメージ）、`pos-deploy-cloudrun.yml`（本番のデプロイ。既定で動く）、`pos-deploy-workers.yml` の確かめ（Worker に GCP のドメインを付けさせない）、api の `AUTH_MODE=iap`・`iap-report-only` |
| infra（`gcp/pos_web.tf`・`gcp/pos_iap.tf`、`pos_web_enabled`。既定で有効） | `cafeore-pos-web`・そのランタイム SA・音声のバケット、IAP を付けた backend service 2 つ、`pos.cafeore.cafe` の Google 管理の証明書、mice の LB の URL map の `pos.cafeore.cafe` のルール |
| infra（`cloudflare/dns.tf`、`pos_on_gcp_lb`。既定で有効） | `pos.cafeore.cafe` の A レコード（DNS only。`pos-be-lb` と同じ LB の IP） |

Terraform の手順・plan の見方・確かめていないことは infra の README「POS を GCP に移す（IAP）」が正本。ここは全体の順番と、
このリポジトリの設定だけを書く。

#### 切り替える手順

**順番を守ること。** どれも merge と apply がそのまま本番に効く。手順 3 から POS は数十分止まるので、営業していない時間にやる。

1. **準備（POS は止まらない）。** infra の README の手順 1・2（OAuth クライアントを決める、`elevenlabs-api-key` を作る、IAP の API を
   有効にする、apply の principal にロールを足す）
2. **infra を merge して `gcp-mice` を apply する（POS は止まらない）。** `cafeore-pos-web`（踏み台のイメージ）・IAP・証明書（`PROVISIONING`）・
   URL map のルールができる。workspace `cloudflare` の run（`pos.cafeore.cafe` の A レコードの作成）は**まだ apply しない**
   （Worker の独自ドメインが名前を持っているので、今 apply しても作成で落ちるだけで、何も壊れない）
3. **ここから POS が止まる。** 各端末で、送れていない注文・CaOS の未送信・刷れなかったシールが無いことを確かめてから:
   1. このリポジトリの Variables を変える
      - `WORKERS_CUSTOM_DOMAIN` を `pos-cf.cafeore.cafe` にする
      - `VITE_API_BASE_URL` を `https://pos-cf.cafeore.cafe` にする（Worker の画面は Worker を通して API を呼ぶ）
   2. この PR を merge する。main で次の 2 つが走る
      - 「pos / deploy (Cloud Run)」… `cafeore-pos-web` が本物の画面になる（infra が先に無いとここで落ちる）
      - 「pos / deploy (Workers)」… Worker を `pos-cf.cafeore.cafe` に出す。wrangler は独自ドメインを入れ替えるので、
        `pos.cafeore.cafe` は Worker から外れる（はず。確かめていない。Cloudflare のダッシュボードの Workers & Pages →
        `cafeore-pos` → Domains に `pos.cafeore.cafe` が残っていたら、手で外す）
   3. workspace `cloudflare` を apply する（`pos.cafeore.cafe` の A レコードを LB に向ける）
   4. 証明書が `ACTIVE` になるのを待つ（数十分。infra の README の手順 4 のコマンド）
4. **確かめる。** 各端末で `https://pos.cafeore.cafe` を開き直し、決めたアカウントでログインする。レジで注文できる、ほかの端末に
   WebSocket で流れる、呼び出し画面で読み上げが鳴る（新しいバケットに音声ができる）、トップページの一番下のビルドの番号が今の main のもの、
   許可リストに無いアカウントでは開けない。`https://pos-cf.cafeore.cafe/status` が JSON を返す（非常用が生きている）
5. **api の確かめを IAP にする（なるべく早く）。** infra の README の手順 6（`api_auth_mode` を `iap-report-only` → `iap`）。
   **`iap` にするまでは、`pos-cf.cafeore.cafe` から誰でも API を使える**（Worker がトークンを付けて中継し、api は誰も弾かない）。
   `iap` にすると、pos-cf の画面は開けても API には届かなくなる（下の「非常用の pos-cf」）
6. **後片付け**（落ち着いてから）：旧 `cafeorepos` の本番の workers.dev を止める（[移す手順](#pos-の-worker-を-cafeore-のアカウントに移す)の手順 5）、
   infra の `frontend_origins` の古い URL、Cloudflare の R2 のバケット（Worker の pos-cf が使い続けるなら残す）

#### 非常用の pos-cf

GCP の LB や IAP が止まって `pos.cafeore.cafe` が使えないときは、Worker の `pos-cf.cafeore.cafe` に逃げる。

1. infra で `api_auth_mode = "off"` にして apply する（Worker の中継には IAP の JWT が無いので、`iap` のままだと API が弾く）。
   新しいリビジョンが立てば効く。**その間は誰でも API を使える**
2. 端末で `https://pos-cf.cafeore.cafe` を開く。**オリジンが違うので、`pos.cafeore.cafe` の localStorage は引き継がれない。**
   送れていない注文は `pos.cafeore.cafe` が戻ったときにそちらで送られる。プリンター・Square の端末などの設定は pos-cf で入れ直す
3. 戻ったら `pos.cafeore.cafe` に戻し、`api_auth_mode = "iap"` に戻す

`pos.cafeore.cafe` そのものを Worker に戻すこともできる（infra の `pos_on_gcp_lb = false` で A レコードを消し、`WORKERS_CUSTOM_DOMAIN` と
`VITE_API_BASE_URL` を `pos.cafeore.cafe` に戻して「pos / deploy (Workers)」を手動実行。ただし Workers の確かめが GCP のドメインを
断るので、そのときは変数 `POS_WEB_DOMAIN` を別の値にする）。オリジンが同じなので端末の設定はそのまま使えるが、証明書が無くなる・DNS が
行き渡るまでの間は止まる。

#### ログインのセッションが切れたとき

画面は 10 秒ごとに `/status` を見ている（`useOnlineStatus`）。同じオリジンの API には `X-Requested-With: XMLHttpRequest` を付けるので、
IAP のセッションが切れると IAP は Google のログインへ飛ばさずに 401 を返す。そのとき画面を読み込み直して IAP のログインへ戻す
（Google のログインが続いていれば、何も押さずに戻ってくる）。続けて読み込み直すのは 1 分に 1 回まで。

読み込み直すと、そのタブのメモリにしか無いもの（[呼び出し画面の CM](#呼び出し画面の-cm) で選んだファイル、先払いの途中の支払い）は消える。
外部ディスプレイに出している呼び出し画面のタブを読み込み直すと、全画面も解ける（[外部ディスプレイに出す](#外部ディスプレイに出す)）。
IAP のセッションがどのくらいの間隔で切れるかは確かめていない（Google の資料では、Google アカウントのログインが続く限り続くとある）。

#### ログイン中のアカウントとログアウト

トップページの右上に、ログインしている Google アカウントのメールと権限、ログアウトのボタンを出す（`LoginUser`）。

- メールは画面の Cloud Run の `/auth/me` が返す。IAP が付ける `X-Goog-Authenticated-User-Email`（`accounts.google.com:<メール>`）から
  名前空間を外したもの。署名の無いヘッダーなので、**出すだけで、誰に何を許すかには使わない**（API は JWT を確かめる）。
  API の `AUTH_MODE` が `off` でも出る
- 権限は API の `GET /api/me` が返す（API が JWT で確かめた相手を、`AUTH_ADMIN_EMAILS`・`AUTH_STAFF_EMAILS`・`AUTH_VIEWER_EMAILS` と照らした結果）。

  | API の `AUTH_MODE` | 出るもの |
  | --- | --- |
  | `iap`・`cloudflare-access` | 「管理者」「スタッフ」か「閲覧のみ」。許可リストに無ければ（403）「権限なし」 |
  | `*-report-only` | 「スタッフ（report-only）」など。API はまだ弾かないので「権限なし」でも操作はできる |
  | `off` | 「権限の確認なし」（誰でもすべての操作ができる） |

  API が確かめた相手が画面のメールと違うとき（ログアウトしても API の方の IAP の cookie が残っていた、など）は、
  「API には … として届いています」と赤字で出す。出している権限は API の方の相手のもの
- ログアウトのボタンを押すと `/?gcp-iap-mode=CLEAR_LOGIN_COOKIE` を開く。IAP が自分の cookie を消し、
  もう一度ログインを求める。**Google アカウントのログインは消さない**ので、そのブラウザーが Google に 1 つのアカウントでしか
  ログインしていなければ、何も聞かれずに同じアカウントで戻ってくる。別のアカウントに替えるときは、Google の
  アカウントの切り替えで足すか、Google からログアウトしてから開き直す
- PR のプレビュー（Workers。ログインが無い）では、メールの代わりに「プレビュー」と出し、権限とボタンは出さない。
  プレビューかどうかは画面に焼き込む `VITE_DEPLOY_ENV` が `preview` かで決める（`pos-deploy-workers.yml` が PR のビルドにだけ入れる）
- 非常用の `pos-cf.cafeore.cafe`（Workers の本番。ログインが無い）では、Worker の `/auth/me` が `null` を返し、「ログインなし」と出す
  （API を `off` にして使うので、権限は「権限の確認なし」）。ローカルの `pnpm dev` では「ローカル」とだけ出す

#### 確かめていないこと

- 実物での動き全部（Terraform の plan と apply、IAP のログイン、IAP を通した WebSocket、本物の GCS と ElevenLabs）。
  手元では Docker のイメージを作って動かし、静的ファイル・SPA のフォールバック・Range・`/api` の 404 を確かめ、
  GCS の読み書きは偽の GCS のサーバーで確かめた。`services/pos/Dockerfile` そのままのビルドは `pos-ci` の `image` で通った
- `--domain pos-cf.cafeore.cafe` で出したとき、wrangler が `pos.cafeore.cafe` を Worker から外すか（手順 3-2）
- mice のプロジェクトが `id.cafeore.cafe` の組織の下にあるか（Google 管理の OAuth クライアントで足りるか。infra の README の手順 1）
- IAP の JWT の `email` クレームの形（`accounts.google.com:` などの接頭辞が付かないか）。手順 5 の `iap-report-only` で、弾くはずだったものが
  ログに出ないことで確かめる
- [ログアウト](#ログイン中のアカウントとログアウト)の `CLEAR_LOGIN_COOKIE` が、API の backend service の IAP の cookie も消すか。
  消さないと、別のアカウントでログインし直しても、API には前のアカウントで届くことがある（`/auth/me` の表示は新しいアカウントになる）。
  `AUTH_MODE` が `iap*` なら、ログアウトして別のアカウントでログインし直し、トップページに「API には … として届いています」が
  出ないことで確かめる

### staging と sandbox

本番と同じ構成（IAP の LB・Cloud Run の API と画面・Cloud SQL）を、mice の同じプロジェクトに 2 つ並べてある
（infra の README「staging と sandbox」が正本）。ここからは `deploy-staging` と `deploy-sandbox` が出す。

| | 本番 | staging | sandbox |
| --- | --- | --- | --- |
| POS の URL（IAP） | `pos.cafeore.cafe` | `pos-stg.cafeore.cafe` | `pos-sandbox.cafeore.cafe` |
| API の Cloud Run / 画面の Cloud Run | `cafeore-pos-prod` / `cafeore-pos-web` | `cafeore-pos-stg` / `cafeore-pos-stg-web` | `cafeore-pos-sandbox` / `cafeore-pos-sandbox-web` |
| いつ出すか | main への push（`api-build`・`pos-deploy-cloudrun`） | main への push（`deploy-staging`）。手動実行も main だけ | 手動実行だけ（`deploy-sandbox`）。どのブランチでも |
| DB | 本番の Cloud SQL | staging の Cloud SQL（中身は本番と別） | sandbox の Cloud SQL（**バックアップを取らない**） |
| Square | 本番 | Sandbox | 使わない |

- **staging は本番と並んで出る。** staging を通ってから本番、という順番にはしていない（本番の workflow は変えていない）
- **1 回で API と画面の両方を出す。** 本番は API と画面が別の workflow で、変わった方だけが出るが、`deploy-staging` はどちらかの
  パスが変わったら両方出す（`paths` は `api-build` と `pos-deploy-cloudrun` の main の `paths` を合わせたもの。揃えること）。
  変わった方だけにすると、待っている実行が後の実行に置き換えられたとき（concurrency）、置き換えられた方の変更が出ないため
- **画面は環境ごとにビルドする。** API のオリジン（`VITE_API_BASE_URL`）を焼き込むので、本番のイメージは使えない。
  `VITE_DEPLOY_ENV` は `staging`・`sandbox` で、本番と同じくレジの「常に返金」は出さず、トップページにログイン中のアカウントを出す
- イメージは本番と同じ Artifact Registry の `api`・`pos-web` に、`stg-<SHA>`・`stg-latest`（sandbox は `sandbox-…`）のタグで置く。
  本番の `<SHA>`・`latest` を付け替えないよう分けている。BuildKit のキャッシュは本番のものを読むだけで書かない
- デプロイの後、本番と同じく LB（`pos-be-lb-stg.cafeore.cafe`・`pos-be-lb-sandbox.cafeore.cafe`）を通して `/status` の
  `schema_drift` を確かめる（[DB のスキーマ](#db-のスキーマ)）
- **sandbox の DB は作り直さない。** モデルに列やテーブルを足したブランチを出すと DB に残り、そのあと足していないブランチ（main など）を
  出すと `schema_drift` に出て `deploy-sandbox` が落ちる（デプロイ自体は済んでいる）。sandbox は 1 つしか無いので、最後に流したものが残る
- Slack の `VITE_WEBHOOK_URL` には本番の `WEBHOOK_URL` を渡さない（`STAGING_WEBHOOK_URL`・`SANDBOX_WEBHOOK_URL`。無ければ空）
- infra の手順（DB のユーザー、DNS と証明書）が済む前に `deploy-staging` が走ると落ちる。間に合わないときは変数 `STAGING_DEPLOY` を `false` にしておく
- `deploy-sandbox` は手動実行だけなので、main に入ってからでないと Actions の画面から流せない

### 外部ディスプレイに出す

呼び出し画面（`/callscreen`）は、PC につないだ外部ディスプレイに全画面で出す前提にしている。開くと設定の画面
（出す先・CM・音）になり、そこから出す。トップの「呼び出し画面」のカードからも「マスタ設定」の「呼び出し画面」からも開ける
（古い `/callscreen-cm` は `/callscreen` へ転送する）。

- 出す先は [Window Management API](https://w3c.github.io/window-management/) でつないでいる画面を並べて選ぶ
  （`services/pos/app/lib/screens.ts`）。既定は、このウィンドウの無い画面のうち本体に付いていないもの。PC 版の Chrome・Edge
  （100 から）だけが持つ。初めて「ディスプレイを調べる」を押すと、ブラウザが「ウィンドウの管理」の許可を聞く。
  画面が 1 つに見えるときは、OS の画面の設定を「ミラー」ではなく「拡張」にする
- 「〜に全画面で出す」を押すと、**このタブをそのまま**選んだ画面で全画面にし（`requestFullscreen({ screen })`）、
  呼び出し画面を描く。CM のファイルはこのタブのメモリにあるので、そのまま流れる
- 同じクリックで、手元の画面に設定の画面を小窓（`/callscreen?companion`）で開く（Fullscreen Companion Window。Chrome・Edge の 104 から。
  `services/pos/app/lib/callscreen-companion.ts`）。小窓は別のページで CM のファイルを持たないので、CM の操作（足す・外す・並べ替え・
  画像の秒数）は `postMessage` で元のタブに頼み、元のタブが変わった並びを小窓へ送り返す。音の設定は localStorage にあるので、
  そのまま両方に効く。小窓は出す先と別の画面に開く（同じ画面に開くと Chrome は全画面を解く）
- 表示をやめるのは、小窓の「表示をやめる」か、外部ディスプレイの側で Esc。全画面が解けるとタブは元の画面に戻って設定の画面になり、
  小窓は閉じる。元のタブを読み込み直す・閉じたときも小窓は閉じる
- 小窓が開かない（ポップアップを止められた・対応していない）ときは、小窓無しで全画面にだけする。表示をやめるには外部ディスプレイの側で Esc
- 画面を選べないブラウザ（Safari・Firefox）や外部ディスプレイが無いときは「この画面で全画面にする」で今の画面に出す
  （ウィンドウを外部ディスプレイへ動かしてから押す）
- 確かめたのは、headless の Chromium で画面の一覧と全画面を真似た動き（出す先・小窓の位置・小窓からの CM の操作・表示をやめる）と、
  今の画面での本物の全画面まで。**本物の外部ディスプレイでの全画面と小窓は確かめていない**

### 呼び出し画面の CM

呼び出し画面は、呼び出しが無い間は CM を全画面で流す。

- 流すものは、呼び出し画面（`/callscreen`）の設定の画面で、**呼び出し画面を映す端末の**
  ファイル（動画・画像。何個でも）を選ぶ。上から順に繰り返し流す（動画は最後まで、画像は決めた秒数だけ。1 つだけなら繰り返す）
- 選んだファイルはどこにも上げず、保存もしない。**そのタブのメモリにだけ持つ**（`services/pos/app/lib/callscreen-cm.ts`）ので、
  読み込み直す・タブを閉じると消える。外部ディスプレイにはそのタブをそのまま全画面で出すので、選んだファイルが流れる
  （出している間は手元の小窓から変えられる）
- 選んでいなければ `services/pos/public/callscreen-cm.mp4` を流す（今は置いていない）。そこにも無ければロゴの画面を出す。
  public に置くものは Workers の静的アセットなので 1 ファイル 25 MiB まで、リポジトリは public なので誰でもダウンロードできる
- 流せないもの（壊れている、ブラウザが流せない形式。Chrome の HEVC の .mov など）は飛ばす。動画は H.264 の mp4 なら
  Chrome・Edge・Safari で流せる。音は消して流す
- 呼び出し画面を被せている間は止め、CM に戻ったら続きから流す

### 呼び出しの音声（ElevenLabs・R2）

呼び出し画面（`/callscreen`）は、ElevenLabs で作った音声で次の 3 つを読み上げる。重なったときは 1 件ずつ順に流す。

| いつ | 読む文 | チャイム |
|--|--|--|
| 番号を呼んだとき | （順番が前後いたします。）N番のお客様、提供口までお越しください。 | 先に鳴らす |
| 提供の画面で「呼び出し催促」を押したとき（`POST /api/orders/{id}/recall`。お呼び出し中に出している番号だけ） | N番のお客様、商品のご用意ができております。お急ぎ、提供口までお越しください。 | 先に鳴らす |
| CaOS でカードを淹れ始めたとき（空いたドリッパーに割り当てた・積まれていたカードを担当し始めた）。1 つの注文につき最初の 1 回だけ | N番のお客様、M番ドリッパーにてドリップいたします。（よろしければぜひ、お近くでご覧ください。） | 鳴らさない（呼び出しと取り違えないため） |

- 音声は POS の Worker の `/call-voice/call?order=N(&reordered=1)`・`/call-voice/recall?order=N`・`/call-voice/drip?order=N&dripper=K` が返す
  （`services/pos/worker/call-voice.ts`。ドリップの案内の括弧の中は `&invite=0` で省く）。文は Worker が決め、画面が渡すのは番号・「順番が前後するか」・ドリッパーの番号・括弧の中を省くかだけ。
  決まった文しか読ませないので、作る音声の数には上限がある（番号は 1〜9999、ドリップの案内は 1 枚のカードの 2 注文まで）
- 文は片（「N番のお客様、」「提供口までお越しください。」「順番が前後いたします。」「商品のご用意ができております。」
  「お急ぎ、提供口までお越しください。」「M番ドリッパーにてドリップいたします。」「よろしければぜひ、お近くでご覧ください。」）に分けて作り、
  Worker がつないで 1 本の MP3 で返す（`worker/mp3.ts`。片ごとの ID3 タグと Info ヘッダーを落としてフレームをつなぐ）。
  番号の片は呼び出し・催促・ドリップの案内で同じものを使う
- 番号（注文番号とドリッパーの番号）は、数字のままではなく仮名の読みにして渡す（`numberReading`。303 なら「さんびゃくさん番」）。
  数字のままだと「サンゼロサン」と 1 桁ずつ読まれる。ドリッパーは画面では「3rd」だが、「さん番ドリッパー」と読ませる
- 片は R2 のバケット `cafeore-call-voices`（Worker と同じ Cloudflare のアカウント。本番は `cafeore`、プレビューは `cafeorepos`）に溜め、溜めてあれば ElevenLabs を呼ばない。
  鍵は ElevenLabs に送る中身（片の文・声・モデル・設定）のハッシュなので、文や声を変えると自然に作り直す。
  同じ鍵のまま作り直したいときは、`call-voice.ts` の `CACHE_VERSION` を上げるか、バケットの中身を消す。本番とプレビューは別のアカウント（本番は `cafeore`、プレビューは `cafeorepos`）の、同じ名前の別のバケットを使う
- 間を空けないように：呼び出しは音声が届いてからチャイムを鳴らし、鳴り終わったらすぐ読む（8 秒待っても届かなければチャイムだけ）。
  さらに、まだ呼んでいない注文の呼び出しの音声を、画面に見えた時点で先に作らせておく（番号の片が溜まるので、ドリップの案内も速くなる）
- 呼び出し催促した番号は、読み上げを鳴らし始めてから 1 分のあいだ、地は変えずに金の縁を脈打たせる。
  催促は注文には残さず、全部の画面に WebSocket の `{"type":"order_recalled"}` で知らせるだけ（受け損ねた画面は読み上げない）
- 呼ぶ注文より先に注文した注文（同じ日）がまだ待っている（準備完了でも提供済みでもない）ときは、冒頭に
  「順番が前後いたします。」を付ける（`@cafeore/common` の `isCallOutOfOrder`）
- ドリップの案内は 1 つの注文につき最初の 1 回だけ流す（2 杯を続けて・別のドリッパーで淹れても、2 回目からは流さない。
  統合したカードで片方の注文はもう案内していれば、まだの注文の番号だけを読む）。緊急（淹れ直し）のカード、もう呼んだ注文のカードでは流さない
- 「よろしければぜひ、お近くでご覧ください。」は、前にそれを付けた案内から 1 分以内（立て続け）なら省く。付けた案内から数えるので、
  続いている間も 1 分に 1 回は付く（`@cafeore/common` の `planDripAnnouncement`）
- [GCP に移した](#本番を-gcp-に移すiap)後の本番は、同じ `worker/call-voice.ts` を Cloud Run の `cafeore-pos-web` が動かし、片は GCS のバケット
  （`<プロジェクト ID>-call-voices`）に溜める。鍵は mice の Secret Manager の `elevenlabs-api-key`（Terraform が環境変数に入れる）。
  Cloud Run は応答を返すと CPU を絞るので、作った片を溜め終えてから返す（`server/app.ts`。溜めていない片があるときだけ遅くなる）
- ElevenLabs の鍵は GitHub の secret `ELEVENLABS_API_KEY`。本番もプレビューもデプロイのたびに
  `--secrets-file` で Worker の secret に入れる（書かなかった secret は前のバージョンから引き継がれるので、
  片方だけで入れると古い値が残る）
- 音声が取れないとき（鍵が無い、ElevenLabs が断った、ローカルの `react-router dev` には Worker が無い）は、
  呼び出しはチャイムだけ、ドリップの案内は何も鳴らさない
- Worker ごと手元で試すときは `pnpm pos build` のあと `services/pos` で `pnpm exec wrangler dev`
  （R2 は手元の模擬になる。鍵は `.dev.vars` に `ELEVENLABS_API_KEY=...` と書く）
- **バケットが無いと Worker のデプロイが失敗する。** はじめにダッシュボードで R2 を有効にし、
  `pnpm exec wrangler r2 bucket create cafeore-call-voices` で作っておくこと
- プレビューの URL（`preview_urls`）は PR を閉じても残る（[後片付け](#pr-を閉じたときラベルを外したときの後片付け)）。
  Access で守っていなければ、その URL の `/call-voice` も誰でも叩ける。エイリアスの URL
  （`pr-<番号>-cafeore-pos.…`）は PR の番号から推測できるので、URL を知られていないことは当てにできない。
  片の数は番号の幅で抑えてあるが、
  ElevenLabs の利用枠が気になるなら、プレビューの URL も Access で守るか、`preview_urls` を止める

### backend（Artifact Registry → Cloud Run）

`api-build` が `api/Dockerfile` からイメージを作り、Artifact Registry へ push する。
main への push と手動実行では、続けて Cloud Run サービス `cafeore-pos-prod` を
そのイメージで更新する。**PR では本番に触らず、プレビュー用の別サービス**
（既定 `cafeore-pos-preview`）へデプロイし、その URL を PR にコメントする。

**本番もプレビューも mice の GCP プロジェクト（`cafeore-mice-512509`）にある。** 2026-10-23 に cafeore の
プロジェクト（`project-5d6e656b-4871-46ff-96f`）から移し、cafeore の本番（`cafeore-pos-prod`）と旧本番（`cafeore-pos-git`）は
消した（infra の README「本番を mice に移す」「cafeore の本番を消す」）。DB は mice の Cloud SQL で、cafeore の DB の
中身は移していない。

| | 値 |
| --- | --- |
| 本番のサービス | `cafeore-pos-prod`（`https://cafeore-pos-prod-1035412238902.asia-northeast1.run.app`） |
| 本番の入口 | mice の LB `https://pos-be-lb.cafeore.cafe`（Cloud Armor でトークンの無いものを落とす。[API の認証](#api-の認証cloudflare-access)）。run.app に直接も届くかは infra の `api_lb_only` 次第 |
| プレビューのサービス | mice の `cafeore-pos-preview` |
| Artifact Registry | `asia-northeast1-docker.pkg.dev/cafeore-mice-512509/cafeore-pos/api` |

workflow の既定値（`GCP_PROJECT_ID` などの `vars.* || '...'` の右側）は cafeore のままなので、Variables で mice の値を入れている
（[必要な設定](#必要な設定)）。**Variables を消すと、本番の無い cafeore にデプロイしに行って落ちる。**

本番と分けているのは、同じサービスにリビジョンタグを足すとトラフィック設定が
「常に最新リビジョン」から「特定リビジョンへの固定」に変わり、main のデプロイが
自動で切り替わらなくなるため。プレビュー用サービスの側では**リビジョンタグを使う**
（PR ごとに URL と `DATABASE_URL` が分かれ、同時に複数の PR が開いても潰し合わない）。
PR を閉じるか `preview` ラベルを外すと `pr-cleanup` がタグを外す。

プレビュー用サービスは**アクセスが無ければゼロまで縮む**ので、PR を放置しても
費用は増えない。

### ビルドの番号

POS のトップページの一番下に、画面と API がどの PR・コミットのビルドかを
`画面 #889 · 90b89b2　API #889 · 90b89b2` の形で出す。デプロイが反映されたか、
画面と API が食い違っていないかを確かめるのに使う。

- 番号は `pos-deploy-workers` と `api-build` が `.github/scripts/build-info.sh` で決める。
  PR ではその PR と head のコミット、main ではマージコミットとそれをマージした PR
- 画面はビルド時に `VITE_BUILD_PR`・`VITE_BUILD_COMMIT` として焼き込む
- API はイメージの環境変数 `BUILD_PR`・`BUILD_COMMIT` に焼き込み（`api/Dockerfile`）、
  `/status` と `/health` の `build` で返す。画面はこれを `/status` から読む
- 積んだ PR で別の PR の backend を使うときは、API にはその持ち主の PR の番号が出る
- ローカルのビルドでは「ローカル」と出る

### backend の環境変数

| 変数 | ローカル | プレビュー | 本番 |
| --- | --- | --- | --- |
| `DATABASE_URL` | `api/.env` | CI が Neon の接続文字列を渡す | mice の Cloud SQL。Secret Manager の `cloudsql-database-url`（Unix ソケット `/cloudsql/...` でつなぐ）。mice は Cloud SQL だけで、Supabase にはつながない（infra の README「Cloud SQL」） |
| `DATABASE_LISTEN_URL` | 未設定（`DATABASE_URL` を使う） | CI が Neon の pooler を通らない接続文字列を渡す | 未設定（Cloud SQL はプーラーを通さず直接つなぐので不要） |
| `DB_MAX_OPEN_CONNS` | 未設定（5） | 未設定（5） | infra の `api_db_max_open_conns`。1 インスタンスが張る接続の上限（LISTEN の 1 本は別）。Cloud Run のインスタンス数の上限 ×（これ + 1）が Cloud SQL の `max_connections` に収まるようにする |
| `FRONTEND_ORIGINS` | 未設定（`localhost` を許可） | `*` | POS の URL をカンマ区切り（infra の `frontend_origins`。`https://pos.cafeore.cafe` など） |
| `PORT` | `8080` | Cloud Run が渡す | Cloud Run が渡す |
| `SLACK_WEBHOOK_URL` | 未設定（通知せずログに出す） | 未設定 | Slack Incoming Webhook の URL |
| `SLACK_ACTIVITY_WEBHOOK_URL` | 未設定（`SLACK_WEBHOOK_URL` に流す） | 未設定 | 任意。商品の登録・変更・削除、棚卸し・入荷、オーダーストップの通知を別のチャンネルに分けるときだけ |
| `INVENTORY_CRON_SECRET` | 任意（`X-Cron-Secret` で手動実行） | 未設定 | 未設定 |
| `INVENTORY_REMIND_INVOKER` / `INVENTORY_REMIND_AUDIENCE` | 未設定 | 未設定 | Cloud Scheduler の SA と ID トークンの audience |
| `POS_BASE_URL` | 任意 | 未設定 | リマインドに載せる POS の URL |
| `SQUARE_ACCESS_TOKEN` | 任意（Sandbox のトークン） | 未設定 | Square のアクセストークン（Secret Manager に置く） |
| `SQUARE_ENVIRONMENT` | `sandbox` | 未設定 | `production` |
| `SQUARE_LOCATION_ID` | 任意 | 未設定 | 任意（端末をペアリングする店舗。空ならアカウントの既定の店舗） |
| `SQUARE_WEBHOOK_SIGNATURE_KEY` | 任意 | 未設定 | Webhook の署名鍵（Secret Manager に置く） |
| `SQUARE_WEBHOOK_URL` | 任意 | 未設定 | Developer Console に登録した通知 URL（1 文字も違えないこと） |
| `AUTH_MODE` | 未設定（`off`） | 未設定（`off`） | `off` → `iap-report-only` → `iap`（[本番を GCP に移す](#本番を-gcp-に移すiap)）。Access を使うなら `cloudflare-access-report-only` → `cloudflare-access`（[API の認証](#api-の認証cloudflare-access)） |
| `IAP_AUDIENCE` | 未設定 | 未設定 | `AUTH_MODE` が `iap*` のとき。IAP を付けた API の backend service の `/projects/<プロジェクト番号>/global/backendServices/<ID>`（infra が渡す。形が違うと起動しない） |
| `CF_ACCESS_TEAM_DOMAIN` / `CF_ACCESS_AUD` | 未設定 | 未設定 | Zero Trust のチームのドメインと、POS の Access アプリケーションの AUD タグ |
| `AUTH_STAFF_EMAILS` / `AUTH_VIEWER_EMAILS` | 未設定 | 未設定 | 何でもできる相手 / 読むだけの相手のメール（カンマ区切り）。`@id.cafeore.cafe` のように `@` で始めるとドメインごと（[API の認証](#api-の認証cloudflare-access)） |
| `AUTH_ADMIN_EMAILS` | 未設定 | 未設定 | 管理者のメール（カンマ区切り。ドメインごとには書けない）。スタッフにできることに加えて、[データのリセット](#データのリセット)と、商品管理・プリンター・Square 端末などの設定の書き込みができる（[運営・管理とマスタ設定は管理者だけ](#運営管理とマスタ設定は管理者だけ)）。未設定なら、認証を掛けている本番では誰もそれらを変えられない |
| `AUTH_PREVIEW_ADMIN` | 未設定（手元で試すなら `true`） | `true`（CI が渡す。Neon のブランチがあるときだけ） | **渡さない。** `true` なら、全部のリクエストを管理者 `preview` がログインしてきたものとして扱う（[プレビューは管理者としてログインした扱い](#プレビューは管理者としてログインした扱い)）。`AUTH_MODE` が `off`（か空）のときだけ使え、ほかの `AUTH_MODE` と一緒だと起動しない。`true`・`false` 以外でも起動しない |

プレビューと本番の値は infra リポジトリの `gcp/cloud_run_preview.tf` と
`gcp/cloud_run.tf` にある。`DATABASE_URL` が未設定だと `initDB` が `log.Fatal` する。

### プリンター（ラベル・レシート）

レジのブラウザが Epson のプリンター（ePOS-Print）へ直接つなぐ（SDK は `services/pos/public/epos-2.27.0.js`）。
サーバーはプリンターにつながず、IP アドレスとラベル用のシールの大きさと向き、レシート用の用紙（種類と幅）と機種を持っておくだけ。

| プリンター | 刷るもの | 既定の IP アドレス | 既定の機種 | 既定の用紙・シールの大きさ | 刷った後 |
| --- | --- | --- | --- | --- | --- |
| ラベル用 | カップに貼るシール（注文を送ったとき。Square は決済画面が出たとき）、緊急・キャンセルのシール | `192.168.77.2` | — | 長さ 29mm・印字幅 360 ドット（45mm）・余白 0mm・180° 回す | 一連の印刷の最後に空のシールを 1 枚送る（剥離位置まで送るにもできる） |
| レシート用 | レシート（会計のたび）と領収書（求められたときだけ） | `192.168.77.3` | TM-L90 | 58mm のレシート紙 | 1 行送って切る |

- IP アドレス・ラベル用のシールの大きさ（ラベルの長さ 5〜100mm・印字幅 64〜576 ドットの 8 の倍数・四辺の余白 0〜10mm。
  余白の内側に縦横 2mm 以上残す）と向き（180° 回して刷るか）と一連の印刷の最後の送り方（空のシールを 1 枚送る / 剥離位置まで送る）・
  レシート用の用紙（種類はレシート紙 / ダイカットラベル、幅は 58mm / 80mm）と機種は管理画面 `/printer-settings`
  （トップの「マスタ設定」→「プリンター」）で設定する。
  向き・最後の送り方を選べるようにする前に保存した設定・レジから省いて保存した設定は、既定（180° 回す・空のシールを 1 枚送る）か、
  保存してある値のままになる。
  **全レジで共通**で、DB（`printer_settings` の 1 行）に持つ。一度も保存していなければ上の既定値を使う。
  ラベル用の既定の大きさは、今のラベルロール（台紙 約 57mm、シール 約 53 × 30mm）でテスト印刷して決めた値。
  ラベル用の用紙（`label_printer_paper_type`・`label_printer_paper_width`）はもう使わないが、レジと API を別々に出すので
  列と API の項目は残してあり、管理画面は読んだ値をそのまま送り返す。
- ラベル用のシールの刷り方（`services/pos/app/label/`）：
  - カップのシール（`order-label.ts`）は今までどおりプリンターの文字（ページモード）で刷る。範囲の幅だけ印字幅に縮める
    （余白は使わない。範囲は y = 24 から高さ 210 で、234 ドット ≒ 29.3mm で終わる）。
  - 緊急・キャンセル・テスト印刷のシールは、シールの大きさ（印字幅 × 長さ。`paper.ts` の `labelGeometry`）の白黒の画像に、
    余白の内側に中身を描く（`sticker.ts`・`cancel-label.ts`・`test-print.ts`）。プリンターにはシールの先頭へ送ってから
    左寄せで画像（`mode="mono"`）を送る。画像は 1 ドット 1 ビットに詰めて base64 にし（`document.ts` の `packImage`。
    下の白い行は送らない）、360 × 232 ドットで 14KB ほどなので、端末に残す未印刷のシールにも代理印刷の頼み（上限 64KiB）にも載る。
    緊急のシールは中身が同じなので、大きさと向きごとに 1 回だけ描く。
  - 緊急のシールは「ここから」と「ここまで」の 2 枚（`sticker.ts`）。どちらも余白の内側を白い帯（高さ 1/4）と黒地に白抜きの
    「緊急」に分け、帯に「▼ ここから ▼」「▲ ここまで ▲」を書く（帯は台紙の上で挟むカップのシールの側に置き、三角でそちらを指す。
    回さなければ「ここから」は下、「ここまで」は上）。
    一度に足した淹れ直し（マスターの緊急ボタン・CaOS の淹れ直しのパネルの 1 回分）のカップのシールを、「ここから」→ カップ … →
    「ここまで」の順に刷って挟む（`order-label.ts` の `emergencyLabelJobs`）。刷るのは今までどおり 1 杯ずつ（淹れ直しの id ごと。
    未印刷・代理印刷・取り消しもそれぞれ）で、最初の杯に「ここから」、最後の杯に「ここまで」を付ける。
    途中の杯が刷れずに後で刷られる・取り消されると、その杯は挟みの外に出る・抜ける。最初の杯を取り消すと「ここから」も、
    最後の杯を取り消すと「ここまで」も刷られない。1 杯だけなら 3 枚で、画像が 2 枚入るので
    印刷データは 360 × 232 ドットで 28KB ほど（代理印刷の上限 64KiB に載る。印字幅 × 長さが大きいと載らないことがある）。
  - 向きを 180° にすると、カップ・緊急・キャンセルのシールをシールの真ん中を中心に回して刷る。画像のシールは描いた画像を回し
    （`document.ts` の `rotateImage180`）、カップのシールはページモードの範囲をシールの上で回した所（長さ 29mm なら y = 0 から
    高さ 208）に置き、範囲の中を `<direction dir="right_to_left"/>`（`addPageDirection`）で回す。テスト印刷の確認用のページは、
    目盛りの読み方が変わらないよう回さない。紙の送る向き・剥離位置は変わらない。
    回すと読む向きでは紙の送りの後ろが上になる（後に刷ったシールが上に並ぶ）ので、緊急のシールは帯の位置と三角の向きを入れ替え、
    「▲ ここから ▲」（帯が上）「▼ ここまで ▼」（帯が下）に描いてから回す。刷る順（「ここから」が先）は変えない。
  - 一連の印刷（1 回に送るシール）の最後の送り方は、管理画面で選ぶ（`label_printer_trailing_feed`。`infra/epos.ts` の `labelPrinterAt`）。
    送り方を変えると、開いているレジはプリンターにつなぎ直す。
    - 空のシールを 1 枚送る（`blank_label`。既定）：次のシールの先頭へ送り（`<feed pos="current_tof"/>`）、白い 8 × 8 ドット（1mm）の
      画像を刷ってから、その次のシールの先頭まで送る（`<feed pos="next_tof"/>`）。刷ったシールの後ろに空のシールが 1 枚出る。
    - 剥離位置まで送る（`peeling`）：`<feed pos="peeling"/>`（前は 7 行送っていた）。
      ピーラーは剥離位置のシールを取るまで次を刷らないので、プリンターの待ち時間（ePOS の timeout）を 40 秒、
      レジが返事を待つ長さを 50 秒にしている（代理印刷の引き受けが切れる 60 秒より短く）。40 秒たってもシールが取られなければ
      次の印刷は刷れなかったことになり、未印刷として残して送り直す。待ち時間は送り方によらず同じ。
- 管理画面の「テスト印刷」は、保存する前の入力中の設定でそのプリンターにつなぎ、確認用のページと見本を刷る
  （`services/pos/app/label/test-print.ts`）。
  - ラベル用の確認用のページはシール 1 枚分の画像で、余白の内側を枠で囲み、上と左に最初に刷られる点からの目盛り
    （1mm ごとの線と 10mm ごとの数字）、右と下の辺の真ん中に三角、大きさ・IP アドレスと濃さの段階（網点 6 段）を描く。
    シールの右端・下端がどの数字の所にあるかを読み、印字幅（mm × 8 ドット）と長さを合わせる。
    見本は、No.0 の注文（指名ありのカップ・指名なしのカップ・グッズ）のカップのシール 2 枚を緊急のシール（ここから・ここまで）で
    挟んだもので、設定の向きで刷る（確認用のページは回さない）。最後は設定の送り方で送る。
  - レシート用の確認用のページはプリンター・IP アドレス・用紙・機種・印字幅と日時を書き、印字幅いっぱいを枠で囲む。
    枠の左右が欠けたら紙より広い幅を、枠の外の余白が広ければ紙より狭い幅を選んでいる。見本は No.0 の注文の現金のレシートで、最後に切る。
  - 管理画面の設定が紙と合っているのに欠けるときは、プリンター本体の用紙幅の設定を疑う。電源を入れるときに FEED を押したままにすると
    自己診断が刷られ、「Paper Roll Width」「Type of Paper」で本体の設定が分かる（TM-L90 は 54mm になっていて、58mm の紙でも
    印字幅が 48mm に絞られ、レシートの右端が欠けたことがある。本体の印字幅はおおむね「用紙幅 − 6mm」）。
  - 刷れなくても残さず、送り直さない。つながらない・刷れないときはトーストで知らせる。
- 開いているレジには、再読み込みしたとき（またはタブに戻って設定を取り直したとき）に反映される。値が変わったらつなぎ直す。
- レジは最後に取れた設定をブラウザ（`localStorage` の `cafeore:printer-settings`）に覚えておく。API に届かないとき
  （と、取れるまでの間）はそれ、無ければ既定値でつなぐ。API が落ちていてもラベルとレシートは刷れる。
- つなぎ方（`services/pos/app/label/infra/epos.ts`）：まず 8008（ePOS-Device、ws・http）、つながらなければ
  8043（ePOS-Device の暗号化、wss）、8043 が閉じていれば SDK が 443 の ePOS-Print（`https://<IP>/cgi-bin/epos/service.cgi` に
  POST）でつなぐ。つながったポートを端末（`localStorage` の `cafeore:epos-port:<IP>`）に覚え、次からはそちらを先に試す。
  - レジは https で開くので、8008 は混在コンテンツとしてブラウザに止められる。Windows の Chrome はサイトの設定で
    「安全でないコンテンツ」を許可してあれば 8008 でつながる。
  - ePOS-Print はつなぎっぱなしではなく、刷るたびに POST する。送れなかったら（POST が届かない・時間切れ）、
    つなぎ直す。シールは端末に残し（未印刷）、つながったら送り直す（レシートは送り直さない）。
    つながらないあいだは、ラベル用は未印刷が残っていれば、レシート用はいつも、10 秒ごとにつなぎ直す。
    返事だけが届かなかったときはプリンターでは刷れていることがあり、そのシールは 2 枚出る（8008 で返事が来ないときも同じ）。
- **代理印刷（CaOS・マスターの緊急のシール）**：緊急（淹れ直し）を足した端末がラベル用のプリンターに直接刷れなかったら
  （つながらない・失敗を返した・返事が来ない）、すぐサーバーに頼み（`POST /api/label-print-requests`）、
  **ヘッダーの「代理印刷」をオンにしたレジ**が、そのレジのラベル用のプリンターで刷る（`services/pos/app/label/print-relay.ts`）。
  - 「代理印刷」は、ラベル用のプリンターにつながっているレジでは何もしなくてもオン（つながっていない間はオフで、切り替えられない）。
    手でオフにしたときだけ、その端末の `localStorage` の `cafeore:label-print-proxy` に `"off"` を置いて覚え（開き直してもオフのまま）、
    手でオンに戻したら消す。横の「？」に説明を出す。
  - 頼みは共有の WebSocket（`/api/ws/orders`）の `{"type":"label_print_requested"}` で配る（ほかのインスタンスへは DB の通知
    `label_print_requested`）。レジは配信のほか、つないだときと 30 秒ごとに `GET /api/label-print-requests`（今日のまだ刷れていないもの）を読む。
  - 代理印刷のレジが何台あっても 1 枚だけ刷る。レジは刷る前に引き受け（`POST .../{id}/claim`。60 秒で切れる）、
    引き受けたレジだけが刷り、刷れたら `.../printed`、刷れなかったら `.../release`（ほかのレジが引き受けられる。10 秒あけて試し直す）。
    レジは自分のプリンターがつながっていないあいだは引き受けない。
  - 刷れたら `{"type":"label_print_done"}` で知らせ、頼んだ端末のヘッダーの下の「レジで印刷待ち N 件」から外す。ずっと減らなければ、
    代理印刷をオンにしたレジが無いか、そのレジのプリンターも刷れていない。
  - 頼めたシールは頼んだ端末に残さない。頼めなかったら（API に届かない・断られた）端末に残して（未印刷）、10 秒ごとに直接刷り、
    頼み直しは頼めないたびに間を倍にする（10 秒から最長 5 分。`print-relay.ts` の `relayRetryDelay`。「もう一度刷る」ならすぐ頼む）。
  - 緊急を取り消すと頼みも消える（`DELETE /api/cup-emergencies/{id}`。頼みの id は淹れ直しの id）。注文の編集で外したカップ・消した注文の
    淹れ直しも同じく頼みごと消え、同じ取り消しの知らせ（`{"type":"cup_emergency_cancelled"}`）が出る。消えた淹れ直しの頼みは
    410 で断り（取り消しと同時に頼まれても、取り消した緊急のシールは刷らない）、頼んだ端末はそのシールを捨てる
    （ルートが無い 404 と見分けるため 410 にしている。404 などほかの失敗は頼み直す）。
  - 返事だけが届かなかった（プリンターでは刷れていた）ときは、直接の送り直しと同じく 2 枚出ることがある。
  - オン・オフはレジの端末ごとに覚える（`localStorage` の `cafeore:label-print-proxy`）。
- **iPad（Safari）**：8008 は使えないので 443（か 8043）でつなぐ。プリンターの証明書は自己署名なので、端末で一度許可する。
  1. Safari で `https://<IP>`（ラベル用・レシート用の両方の IP）を開き、証明書の警告で「詳細を表示」→「この Web サイトを閲覧」を選ぶ。
     プリンターの設定ページが出ればよい。
  2. レジを再読み込みする。つながらないときは、ヘッダーの「プリンター未接続」の下に、開くページへのリンクが出る。
  3. それでも未接続のまま（設定ページは開けるのに、レジのページからの通信が証明書で止まる）なら、証明書を iPad に入れて信頼する：
     Mac で `openssl s_client -connect <IP>:443 </dev/null | openssl x509 > printer.crt` で取り出し、AirDrop などで iPad に送る →
     「設定」→「プロファイルがダウンロードされました」でインストール →「一般」→「情報」→「証明書信頼設定」でその証明書を有効にする。
     証明書の名前（CN・SAN）がプリンターの IP と合っていないと信頼しても通らないので、そのときは Web Config で IP を名前にして
     自己署名証明書を作り直す（iOS は有効期間 825 日以内のものしか通さない）。
- プリンターの設定（Web Config、`https://<IP>` を開いてログイン）：「ePOS-Print」を有効にする（443 で刷るのに要る）。
  8043 を使うなら「ePOS-Device」を有効にし、その暗号化（SSL/TLS）も有効にする。項目の名前はファームウェアで違うことがある。
- レシートは現金なら送信したとき、Square なら注文を登録できたときに刷る。ロゴ・明細・割引・合計と、現金ならお預り・お釣り、
  Square なら決済手段を載せ、最後に引換券番号（注文番号）を大きく載せる。一括会計でない（先払いで何回かに分けて払う）ときは、
  支払いごとのレシートには引換券番号を載せず、払い終えたら引換券番号だけのレシート（ロゴ・日時・注文番号と引換券番号）を別に刷る
  （下の先払いを参照）。引換券に貼る明細シールは刷らない（`label/order-label.ts` でコメントアウトしてある）。
- 領収書はレジの「過去の注文」の「領収書」を押したときだけ刷る。宛名は手書きの空欄、但し書きは「飲食代として」、
  金額は請求額（割引後）、日付は注文を受けた日。横長に描いて 90 度回して刷る（「領収書」の側が先に出る）。
  何度でも刷れ、再発行の印は付かない。
- 中身は `services/pos/app/label/receipt.ts`、描き方は `receipt-canvas.ts`。太字やロゴの横並びをデザインどおりに
  刷るため、プリンターの文字ではなく、ブラウザの canvas で描いた白黒の画像を刷る（フォントは画面と同じ Noto Sans JP、
  ロゴは `app/assets/receipt/ore-logo.svg`）。寸法は幅 576 の座標で決めてあり、刷るときに管理画面で選んだ機種と用紙の
  **印字幅**（`services/pos/app/label/paper.ts`）に合わせる。印字幅より広い画像は右端が切れるので、機種と用紙はプリンターと合わせる。
  ほかの機種を足すときは、`openapi.yaml` の `ReceiptPrinterModel` に足して型を作り直し、その機種の紙の幅ごとの印字幅の
  ドット数を確かめて `RECEIPT_PAPER_WIDTHS` に足す。プリンターの設定（紙を切るなど）は `infra/epos.ts` の `RECEIPT_EPOS_PRINTER_CONFIG`。
- レシート用の印字幅（ドット。1 ドットは 1/8mm）は用紙の種類と幅（レシート紙は機種も）で決まる（`paper.ts`）。
  ラベル用の印字幅は用紙から決めず、管理画面で入れる（上）。

  | 用紙 | 58mm | 80mm | 出どころ |
  | --- | --- | --- | --- |
  | レシート紙・TM-L90 | 416（52mm） | 576（72mm） | Epson の TM-L90 の技術資料の表（用紙幅 − 6mm。80mm だけ − 8mm） |
  | レシート紙・TM-m30 | 420（52.5mm） | 576（72mm） | TM-m30 の桁数（フォント A で 35 桁 / 48 桁 × 12 ドット） |
  | ダイカットラベル | 384（48mm） | 560（70mm） | 80mm は ePOS-Print の TM-L90 の仕様（ページモードの幅）。58mm は資料で 48mm と 50mm に分かれるので狭い方 |

  ダイカットラベルの値は TM-L90 のもので、どの機種でも同じ値を使う（TM-m30 のダイカットラベルの値は確かめていない）。
  カップのシールの範囲（幅 570 ドット）は、ラベル用の印字幅がそれより狭いとき（既定の 360 ドットなど）は印字幅に縮める
  （文字・ロゴの位置は変えないので、印字幅より右にはみ出す所は刷られない）。

### レジの商品キー（同時押し）

メニューのキー（商品管理の「キー」）を押すと、レジに商品を足す。キーは `KeyboardEvent.key` の文字（`^` `a` `*` など）。

- 「`a+s`」のように `+` でつなぐと、そのキーを**同時に押したとき**に足す（3 つ以上もつなげる）。押す順は問わず、
  `a+s` と `s+a` は同じキーとして重複を断る。`+` そのものも「`+`」「`a++`」のように使える。
- 先に押したキーにも商品があれば（`a` の商品と `a+s` の商品があるなど）、押した瞬間にその商品が入り、
  同時押しがそろったところで同時押しの商品に置き換わる。速く打つと前のキーを離す前に次のキーを押すことがあるので、
  続けて打つ組み合わせは同時押しにしない。
- 同時押しには数字・Enter・Space・Esc・Backspace・矢印・Shift などの修飾キーは使えない（押した時点でレジの操作をしてしまい、
  取り消せるのは足した商品だけのため）。1 つだけのキーは今までどおり何でも登録できる。
- 押しているキーは `services/pos/app/components/functional/heldKeys.ts`、キーの解釈は `services/pos/app/lib/menuKey.ts`。
  DB・API はキーを文字列のまま持つ。
- キーは商品管理のメニューの「キー」（アイテムの追加の「同名のメニューも作る」も）に文字を入れるほか、横の「キーをキャプチャ」で**実際に押して**入れられる。
  押したキーを離すまで覚え、全部離したら最後に押したときに押していたキーを「`a+s`」のようにつなぐ（レジが同時押しを
  引くのと同じ）。Shift は数えず、Shift と押した記号はその記号（`*` など）。Alt・Ctrl・⌘ と一緒に押したキーと
  日本語入力中のキーはレジで商品キーにならないので断る。Esc はキャプチャをやめるのに使う（商品管理のシートは閉じない）。
  「このキーにする」でキー欄に入れ、保存はほかの項目と一緒に「保存」で行う。数字・Enter など
  レジの操作に使うキーを 1 つだけで使うと、レジでその操作ができなくなると知らせる（文字で入れたときも）。
  押し方は `services/pos/app/components/functional/keyCapture.ts`、使えるキーかの判定は `menuKey.ts` の `checkMenuKey`。

### レジの決済手段のキー

キーパッドの決済のボタン用に、Alt と一緒に押すキーで決済手段を選ぶ（`cashierDraft.ts` の `PAYMENT_KEYS`）。

- Alt+C 現金・Alt+T カード・Alt+Q QR コード。配列や Option で文字が変わらないよう、`KeyboardEvent.code`（キーの位置）で引く
- 入れる段階で押すと一括会計に進む。カード・QR は進んだらそのまま端末に送る（押し間違えたら決済のダイアログで取り消す）。
  現金で進んだときは、端末にお客さんが決済手段を選ぶ画面を出さない（[Square Terminal 連携](#square-terminal-連携)を参照）
- 会計の段階では、現金は選ぶだけ（受取金額を入れて Enter で確定）、カード・QR は端末に送る
- Square が使えない（端末が決まっていない・つながっていない）ときはトーストで知らせる
- 押しっぱなしの繰り返し（keydown の `repeat`）は何もしない（決済を二重に始めない）
- Alt と一緒に押したキーは、同時押しの商品には数えない

### レジの先払い（小計分割）

1 つの注文を、金額で分けて何回かに分けて払う。注文（番号・シール）は 1 つのまま、支払いを複数持つ。
`services/pos/app/components/functional/cashierSplit.ts` が小計と受け取った支払い（先会計）を持つ。
小計は、一括会計で注文の商品を全部入れて作る。

- **小計分割・一部金額先払い**：会計欄の左下のボタンで、いまの小計を金額で分ける。
  受け取ったらお釣りと小計の残りを出し、続けて次の金額を入れられる。「残りを全て会計」で残りをそのまま払い、
  それが注文の最後の支払いなら「（最終割勘）」が付く。端末で決済できない（残高不足など）ときは、決済のダイアログの
  「一部金額を先払い」から同じ金額の入力に入り、使える分だけその決済手段で払ってもらう。
- Square 端末には「割り勘」を並べない（下の「お客さんが端末で決済手段を選ぶ」を参照）。分けるときはスタッフが
  レジで「小計分割・一部金額先払い」を押す。
- 会計中は左の列（メニューの場所）に内訳（合計・割引・先会計と決済手段ごとの行・いまの小計の説明・色分けの帯）を、
  ヘッダーに「先払い中・残り ¥X」を出す。会計欄は小計の行だけで、小計分割中は「小計分割 −¥X」と「やめる」を足す。
  カード・QR は押すとすぐ小計の額で端末に送る。現金は「ちょうど」（空のまま Enter）で受取金額を入れてから確定する。
- 注文全体を払い終えたら、支払いを全部付けて注文を送る（`POST /api/orders` の `payments`）。先払いがあった注文は
  支払いの内訳とお釣りを出す（先払いの無い注文は今までどおりトーストで知らせて次の注文に進む）。途中の支払いは注文を送らず、
  レジの中に覚えておく（画面を開き直すと消えるので、受け取ったお金は手で確かめる）。現金だけならオフラインでも払え、注文はつながってから送る。
- シールは最初の会計に進んだときに注文全体の分を 1 回だけ刷る。レシートは支払いごとに刷り、
  「先にお支払い済み」「あとでお支払い」を引いた額を合計にする。支払いごとのレシートには引換券番号を載せず、
  注文全体を払い終えたら、引換券番号のレシートを別に 1 枚刷る（途中で先払いを取り消したら刷らない）。
- 割引（引換券・特殊な割引）は 1 杯 ¥100 ずつ、小計を作ったときに小計で引き、小計を払い終えた支払いに付ける。
  小計分割では割引は動かない。先払いがあれば引換券番号・特殊な割引は変えられない。
- 取消と制限：内訳の先会計の行の × で、受け取った分をまとめて返金し、商品の入力に戻る。
  Square で払った分は自動で返金し（交通系 IC など返金できないときは「現金で返した」）、現金は手で返して「返した」を押す。
  先払いがある間は商品を変えられない。小計を途中まで払ったら、払い終えるか取り消すまで会計取消（Esc）で戻れない。
- サーバーは支払いを `order_payments` に持つ（払った順・決済手段・額・お預かり・割引・払った明細）。小計を金額で分けると、同じ明細が
  2 つ以上の支払いに入る（レジは今、どの支払いにも注文の明細を全部入れる）。注文の `received` はお預かりの合計、`payment_method` は Square の支払いを含めば `square`。
  1 つの注文に Square の決済が複数結び付くので、`square_checkouts.order_id` は一意でない。
- 「過去の注文」には支払いの内訳を出す。返金は Square で払った分だけを全部返す（下の返金を参照）。現金で払った分は手で返す。

### レジが送る注文の明細の順

レジは注文を送るときに、明細を並べ替えて送る（注文番号は 1 つのまま）。`services/pos/app/components/functional/cashierLineOrder.ts` が並べ替え、
並べる順は `modules/common/src/models/split-plan.ts`（`sortOrderLines`）が決める。

- 1 人の注文を注文番号ごとに分けていたときの組み方で明細を組み、組んだ順に並べる。1 つの組には同じ商品の 2 杯か 1 杯を 2 つまで入れ、
  前の注文（今の番号のすぐ前の、キャンセルしていない注文）の、まだ抽出を始めていない 1 杯のカードと同じ商品の 1 杯を先頭の組に入れる。
  残りは 2 杯どうし・1 杯どうしで組み、2 杯だけの組を先に並べる。指名は考えない。
  - コーヒー 1 杯の行と同じ商品 2 杯の行（セット）を組に当てる。違う商品の組み合わせ・3 杯以上の行は最後に並べる。
  - ミルク・グッズなどコーヒーの無い行は先頭の組に入れる。
  - 組の中は、前の注文と同じ商品の 1 杯を先に（前の注文が A なら B+A の組も A・B の順）、あとは入れた順。前の注文と同じ商品の 1 杯どうしは入れた順。
- 組が 1 つで済む注文（コーヒーのまとまりが 2 つまで）は入れた順のまま送る。
- 並べ替えるのは送る注文だけ。レジの一覧・シール・レシートは入れた順のまま。払った明細（`payments` の `menu_indexes`）は並べ替えた位置に直す。

### Square Terminal 連携

レジの確定欄から Square Terminal に決済画面（カード・QR コード）を出す。
交通系 IC などの電子マネー（`FELICA_ALL`）はレジにボタンを出さない（API は受け付けるので、過去の注文やレシートには出る）。
**決済が先・注文が後**の順で、端末で支払いが終わってから注文を登録し、ラベルを印刷する。
`SQUARE_ACCESS_TOKEN` が無ければ無効で、レジに Square のボタンは出ない。

- アクセストークンはサーバーだけが持つ。ブラウザから Square の API は呼ばない。
- 端末は何台でも登録でき、DB（`square_devices`）に持つ。追加・取り込み・コードの発行し直し・外すのは管理画面 `/square-devices` で行う。
- どの端末に決済画面を出すかは**レジごとに固定**する。レジの画面右上で選んだ端末の device_id をブラウザ
  （`localStorage` の `cafeore:square-device-id`）に覚える。端末が 1 台しか無く、まだ選んでいなければその端末を使う。
  選んでいた端末が一覧から外されたら、残りが 1 台でも勝手には使わず、選び直すまで Square のボタンを出さない。
- 進行中の決済は端末ごとに 1 件まで。別の端末で決済中でも、別のレジからは決済画面を出せる。
- 結果はレジが `GET /api/square/checkouts/{id}` を数秒おきに呼んで待つ（未確定ならサーバーが Square に問い合わせる）。
  Webhook（`POST /api/square/webhook`、イベントは `terminal.checkout.created` と `terminal.checkout.updated`）は
  レジが落ちていても記録を最新にしておくためのもの。署名（`x-square-hmacsha256-signature`）が合わなければ 403。
- 支払い済みなのに注文が無い決済（決済中にレジが落ちた、注文の送信に失敗した、Square で払った注文を消した）は
  レジの右上に「未登録の Square 決済」として出る。同じ商品を入力して「この決済で登録」を押すと、二重に決済せずに注文を送れる。
  注文にしないなら、そこから返金もできる（下の返金を参照）。
- 会計の段階では、端末にお客さんが決済手段を選ぶ画面も出す（下の「お客さんが端末で決済手段を選ぶ」を参照）。
- 決済が終わっても端末にレシート受け取り画面（印刷・メール・SMS）は出さない（`skip_receipt_screen`）。
  レシートは注文を登録できたときにレジがレシート用のプリンターで刷る（[プリンター](#プリンターラベルレシート)を参照）。
  端末から出すなら Terminal API の
  [Issue receipts](https://developer.squareup.com/docs/terminal-api/advanced-features/issue-receipts) を使う（未実装）。
- 返金は全額だけで、レジの「過去の注文」（Square で払った注文）と「未登録の Square 決済」の「返金」から行う。
  「過去の注文」には「返金（キャンセルしない）」もあり、こちらは返金だけして注文は残す（下の注文を残す返金を参照）。
  - [先払い](#レジの先払い小計分割)で Square の決済が複数ある注文は、全部を作った順に返金し、全部を Square が受け付けたときだけ注文を消す。
    途中で断られたらそこで止め、もう一度返金を押すと受け付け済みの決済は頼み直さずに残りを返金する。
  - Terminal API の返金はカナダの Interac 専用で日本では使えないので、Refunds API（`POST /v2/refunds`）で返す。
    返金先は支払いに使ったカード・電子マネー・QR コード。決済から 1 年を過ぎると返金できない。
  - 交通系 IC は Square でも返金できない。Square が断ったら、注文は残してレジにエラーを出す。
  - Square が受け付けたら（結果待ちの PENDING でも）注文を消す（現金の注文を消すときと同じく、在庫の記録も戻る）。返金の結果は Square で後から決まることがあり、
    決まるまでは「未登録の Square 決済」に返金待ちとして出る。結果は一覧を開いたとき（30 秒おき）にサーバーが Square に問い合わせ、
    返金が終わると一覧から消える。
  - あとで Square で返金が失敗したら、お金は戻っていないのに注文は消えている。決済は「未登録の Square 決済」に理由付きで出るので、
    もう一度返金するか、「この決済で登録」で注文を作り直す（作り直した注文は新しい注文になり、カップの提供状態は戻らない）。
    COMPLETED まで待って消さないのは、注文の付いた返金待ちを誰かが確かめて消す仕組みが別に要るため。
  - Square から応答が無かったときは「返金できたか確かめられていない」（`unknown`）として出る。もう一度返金を押すと、同じ
    idempotency_key で頼み直して確かめる。分かるまでその決済では注文を作れない。
  - 同時に押されても、応答が失われて押し直しても、二重には返金しない（決済依頼を行ロックして 1 件ずつ通し、
    頼み直しは同じ idempotency_key を使う。頼む前に決済を取り直し、処理中の返金や返金済みの額があればそれに従う）。
  - Square の管理画面で返金した決済は、返金を押すと Square に頼まずに返金済みとして扱う。一部だけ返金した決済は API からは返金せず、残りは管理画面から返す。
  - 返金した・返金待ちの決済では注文を作れない（返金が失敗したものは作れる）。
  - 注文を残す返金（`POST /api/orders/{id}/square-refund-keep-order`）では、注文・カップの提供・請求額・支払い方法（Square）は
    そのまま残る。売上の集計（実績のタブなど）にも残る。
    - 返金の状態は注文の `square_refund_status` で配り、「過去の注文」のカードに「返金待ち」「返金済み」「返金できませんでした」などと出す。
      返金待ち・返金済みの注文には返金のボタンを出さない。
    - 注文の付いた決済は「未登録の Square 決済」に出ないので、あとで Square で返金が失敗したときはこのカードに出る。もう一度返金を押して頼み直す。
    - 返金待ちの結果は、レジが「未登録の Square 決済」の一覧を取るとき（30 秒おき）にサーバーが Square に問い合わせ、変わったら注文を配り直す。
    - 返金を受け付けたあとに注文を消す返金（`POST /api/orders/{id}/square-refund`）を呼ぶと、Square には頼まずに注文だけを消す。
  - レジの「メニュー表示」の横の「常に返金（キャンセルしない）」をオンにすると、Square で払った注文は登録したらすぐ、
    レジが注文を残す返金を頼む（「未登録の Square 決済」から登録したものも）。シール・レシートはいつもどおり刷る。
    - 返金できなかったら、閉じるまで消えないトーストで知らせる。過去の注文のその注文から頼み直す。
      返金を頼む前にレジを閉じたなどで頼めなかったときも、過去の注文から返金する。
    - 本番で消し忘れないよう、オンにしている間はトグルを赤く出し、ページを読み込み直すとオフに戻る。決済中は切り替えられない。
    - **本番（`pos.cafeore.cafe` と非常用の `pos-cf.cafeore.cafe`）では、このトグルを出さない。** 出すのは PR のプレビューと
      ローカルの dev（`pnpm dev`）だけ。画面に焼き込む `VITE_DEPLOY_ENV` で決め、デプロイの workflow が入れる
      （`pos-deploy-cloudrun` は `production`、`pos-deploy-workers` は PR なら `preview`、それ以外は `production`、
      [staging と sandbox](#staging-と-sandbox) は `staging`・`sandbox`。どれも `preview` ではないので出さない）。
      本番に出てしまわないよう、値の無いビルド（ローカルの `vite build` など）でも出さない。
- 商品明細を端末やレシートに出す件は [#778](https://github.com/cafeore-tkb/cafeore-pos/issues/778)。

お客さんが端末で決済手段を選ぶ:

Square の端末が決まっているレジでは、会計の段階に入ると、端末に決済手段（現金・カード・QR コード）を並べた画面を出す
（Terminal API の action の `SELECT`、`POST /api/square/actions`）。スタッフがレジで選ぶのを待たずに、お客さんが選べる。

- お客さんがカード・QR コードを選んだら、レジでそのボタンを押したときと同じく、その決済手段で端末に決済画面を出す。
  現金を選んだら、レジを現金にして「お客さんが端末で現金を選びました」と知らせる（受取金額を入れて確定する）。
- 「割り勘」（`SPLIT`）は並べない（API は受け付ける）。[先払い](#レジの先払い小計分割)はスタッフがレジで始める。
- 次のときは画面を取り消す（端末は待ち受けの画面に戻る）。
  - スタッフがレジで決済手段を選んだ（現金・カード・QR のボタン、↑↓、Alt+C などのキー、受取金額の入力）
  - 決済を始めた・会計を終えた・会計をやめた・先払いのダイアログを開いた・今払う額が変わった（額が変われば出し直す）
- 選ばれた・スタッフが選んだ・時間切れ（Square の上限の 5 分）・出せなかったときは、同じ会計（端末・小計・今払う額が同じ）では出し直さない。
- 出している間は、レジの受取金額の欄の右に「お客さんが端末で選べます」と出る。出せなかったら（決済が進行中・Square が断った）そう出す。
- 端末への依頼は 1 件ずつ順に出るので、出したままの画面があると決済画面がその後ろに並んで出てこない。
  そのため、サーバーは決済依頼を作る前（`POST /api/square/checkouts`）と新しく出す前に、その端末に出したままの画面を取り消す。
  決済が進行中の端末には出さない（409）。出した画面は DB（`square_actions`）に持つ。
- 選ばれたかは、レジが `GET /api/square/actions/{id}` を数秒おきに呼んで待つ（Webhook は使わない）。
- 日本の実機で SELECT の画面が出るか・Sandbox のテスト用の device_id でどう扱われるかは、まだ確かめていない。

端末のペアリング（端末ごとに 1 回）:

1. 管理画面 `/square-devices`（トップの「マスタ設定」→「Square 端末」）で名前を入れて「コードを発行」を押す
2. 端末のサインイン画面で「デバイスコードでサインイン」を選び、一覧に出たコードを入力する
3. 一覧で「ペアリング済み」になったら、使うレジの画面右上でその端末を選ぶ

ペアリング済みの端末がサインアウトしたら（サインイン画面に戻ったら）、一覧のその行の「コードを発行」で
コードを発行し直し、端末で入力する（`POST /api/square/devices/{id}/code`）。

- 発行しても行は「ペアリング済み」のままで、入力するまでも今の device_id で決済に使える（発行しただけでは端末はサインアウトしない）。
- 同じ端末なら device_id は変わらない（device_id は端末のシリアル番号）ので、レジで選び直さなくてよい。
  別の端末で入力したら、その行はその端末の device_id に替わり、前の端末を選んでいたレジでは選び直しになる。
- 5 分以内に入力されないと期限が切れ、コードが消える（行はペアリング済みのまま）。もう一度発行すれば新しいコードに替わる。
- Square の資料では、最初のコードは同じ端末なら何度でもサインインに使えるとある。ただしこの画面はペアリングが済んだらコードを捨てるので、
  サインインし直すときは発行し直す。

ダッシュボードで発行したコードではペアリングできない（API で発行したコードが要る）。
以前の `go run ./cmd/square-pair` でペアリングした端末や、一覧から外した端末は「ペアリング済みの端末を取り込む」で戻せる
（Square でペアリング済みのコードを一覧で取り、まだ登録していない端末を足す）。
一覧から外しても端末は Square にサインインしたまま（API ではペアリングを解除できない）なので、使わないなら端末でサインアウトする。

Sandbox では実機とペアリングできないので、管理画面の「device_id を直接登録する」で
Square が用意しているテスト用の device_id を登録する（[一覧](https://developer.squareup.com/docs/devtools/sandbox/testing#terminal-api-checkouts)）。

| 再現する状況 | device_id |
| --- | --- |
| カード決済が成功 | `9fa747a2-25ff-48ee-b078-04381f7c828f` |
| 電子マネー（FeliCa）が成功 | `19a01fbd-3dcd-4d9f-a499-a641684af745` |
| QR コード（PayPay）が成功（Sandbox の店舗が日本所在のとき） | `cae0ee02-f83b-11ec-b939-0242ac120002` |
| お客さんが取り消す | `841100b9-ee60-4537-9bcf-e30b2ba5e215` |
| 時間切れ | `0a956d49-619a-4530-8e5e-8eac603ffc5e` |

本番の端末では最後に少額（1 円から）で確かめる。

DB と偽の Square サーバーで通しで確かめるテストもある（CI では DB が無いのでスキップされる）:

```sh
cd api
SQUARE_INTEGRATION_DATABASE_URL="postgres://postgres@localhost:5432/square_test?sslmode=disable" \
  go test ./internal/handlers -run Integration -v
```

**`FRONTEND_ORIGINS` から漏れた origin はブラウザから API を叩けない。**
フロントのデプロイ先を増やしたら infra 側にも足すこと。

### API の認証（Cloudflare Access）

**本番は Access ではなく IAP で守ることにした（[本番を GCP に移す](#本番を-gcp-に移すiap)）。** この節は Access で守るときの仕組みと手順で、
Access のアプリは作っていない。api の Access の検証（`AUTH_MODE=cloudflare-access*`）はそのまま残してある。

**`AUTH_MODE` を `cloudflare-access` か `iap` にするまでは、API の URL を知っていれば誰でも全部の操作ができる。**
URL は POS の JS に入っているので、画面を開けば分かる（秘密ではない）。CORS は止めにならない
（Origin を付けない curl などには効かない）。

```
ブラウザ ─→ Cloudflare Access ─→ POS の Worker ─→ LB ＋ Cloud Armor ─→ Cloud Run（api）
             （ログイン）          （/api を中継。     （トークンを照合）    （JWT を検証）
                                   トークンを付ける）
```

- POS（`pos.cafeore.cafe`）を Access で守る。ログインしないと画面も開けない
- Access はログインした端末のリクエストに JWT（`Cf-Access-Jwt-Assertion`）を付ける。Worker はそれごと
  `/api` を Cloud Run に中継し、api が署名・発行元・AUD・期限を確かめる（`api/internal/auth`）。
  WebSocket（`/api/ws/orders`）も同じ道を通る
- Worker は中継するときに、secret の `PROXY_TOKEN` を `X-Cafeore-Proxy-Token` ヘッダーに付ける。Cloud Run の手前の
  LB の Cloud Armor がそれを照らし合わせ、合わないものを Cloud Run に届く前に 403 にする（infra の `gcp/api_edge.tf`）。
  JWT は Bearer トークンなので、盗まれると Cloud Run を直接叩いて期限まで使い回せ、Access でセッションを
  取り消しても効かない。トークンは GitHub と Worker の secret にしか無くブラウザに出ないので、それを塞げる。
  `PROXY_TOKEN` は本番のデプロイのたびに、GitHub の secret の `LB_PROXY_TOKEN` から入れ直す（`pos-deploy-workers`）。
  JWT の検証は api にそのまま残す（Cloud Armor はヘッダーの文字列を比べるだけ）
- api はメールの許可リストで振り分ける。`AUTH_STAFF_EMAILS` は何でもでき、`AUTH_VIEWER_EMAILS` は
  GET（Square を除く）と WebSocket だけ。呼び出し画面などの表示用の端末は後者でログインする
  - `@id.cafeore.cafe` のように `@` で始めると、そのドメインのアカウントを全部通す（今あるものも、これから作るものも）。
    サブドメインは含まない（`@cafeore.cafe` は `a@id.cafeore.cafe` に当たらない）。**スタッフにドメインごと入れるのは、
    アカウントを作れる人を自分たちで決められるドメインだけにする**
  - 1 人が複数の項目に当たるときは強い方を取る。ドメインで表示用にして何人かだけをメールでスタッフにはできるが、
    ドメインでスタッフにして一部を表示用に下げることはできない
  - `*@example.com` のようなワイルドカード、形の崩れたドメイン（`@`・`@localhost` など）があると api は起動しない
    （`api/internal/auth/authorizer.go` の `validateAllowList`）
  - `AUTH_ADMIN_EMAILS`（管理者）はスタッフより強い。メールで 1 人ずつ書き、ドメインごとに書くと api は起動しない（`validateAdminList`）。
    管理者にしかできないのは次（[運営・管理とマスタ設定は管理者だけ](#運営管理とマスタ設定は管理者だけ)）
    - [データのリセット](#データのリセット)
    - 「運営・管理」「マスタ設定」の画面だけが使う書き込み：メニュー・アイテム・タイプ・背景色・在庫対象の追加・変更・削除、
      プリンター設定の変更、Square 端末の登録・ペアリング・削除
  - その端末がどちらに当たっているかは `GET /api/me`（`role` が `admin`・`staff`・`viewer`、report-only なら `none` も）で分かる。
    POS のトップページにも出す（[ログイン中のアカウントとログアウト](#ログイン中のアカウントとログアウト)）
- `/api` のグループ全体に「GET は表示用以上、それ以外はスタッフ」が掛かっているので、ルートを足しても
  書き込みは開かない（`api/cmd/server/main.go`）
- 次は Access を通らずに来るので、`/api` のグループの外に置いて自前で確かめている

  | 呼び出し元 | ルート | 通り道（LB を置いた後） | 確かめ方 |
  | --- | --- | --- | --- |
  | Cloud Scheduler | `POST /api/inventory/remind` | run.app に直接（同じプロジェクトなので「内部」として届く） | Google の ID トークン |
  | Square | `POST /api/square/webhook` | LB（Cloud Armor はトークンなしで通す） | Webhook の署名 |
  | デプロイの CI・POS の接続確認 | `GET /status`・`GET /health` | LB（CI は `GCP_API_LB_URL`）・Worker | 認証しない（稼働状況だけ） |

- Worker 経由でも、ブラウザの `Origin`（`https://pos.cafeore.cafe`）はそのまま API に届き、
  CORS で照らし合わされる。同じオリジンになったからといって `FRONTEND_ORIGINS` から消すと、書き込みと
  WebSocket が 403 になる
- Access のセッションが切れると、API への fetch と WebSocket が Access のログイン画面へ飛ばされて
  失敗し続ける。POS は `/status` が 401 になったら（`X-Requested-With` を付けているので、セッション切れの
  ときは Access が 401 を返す）画面を読み込み直して Access のログインへ戻す（`useOnlineStatus`）。
  続けて読み込み直すのは 1 分に 1 回まで

#### 切り替える手順

順番を守ること。どの段階でも、前の段階に戻せば元に戻る。

**今の状況（2026-10-24）**

| 段階 | 状況 |
| --- | --- |
| 1. Access | **まだ。** `cafeore` アカウントに POS の Access のアプリが無い |
| 2. Worker 経由にする | 済み。`WORKERS_API_ORIGIN` は LB（4-3）、`VITE_API_BASE_URL` は `https://pos.cafeore.cafe` |
| 3. `api_auth_mode` | **まだ。** Access が無いので、mice の `cafeore-pos-prod` は `off` のはず（infra の workspace `gcp-mice` の変数は確かめていない） |
| 4. LB と Cloud Armor | 4-1〜4-3 は済み（mice の LB。`pos-be-lb.cafeore.cafe` は mice の LB を向いている）。4-4 の `api_lb_only` は確かめていない |

**今は誰でも全部の操作ができる。** `pos.cafeore.cafe` は Access で守っておらず、Worker が LB のトークンを付けて
中継するので、開けばそのまま API に届く。旧 `cafeorepos` の本番の workers.dev（[移す手順](#pos-の-worker-を-cafeore-のアカウントに移す)の
手順 5 がまだ）と、本番に出したバージョンごとのプレビュー URL も同じ。旧本番の `cafeore-pos-git` は消したので、
そちらからの抜け道はもう無い。

1. **Cloudflare（`cafeore` アカウントのダッシュボードで手作業）**。[POS の Worker を cafeore のアカウントに移す](#pos-の-worker-を-cafeore-のアカウントに移す)が済んでいる前提
   1. Workers を Paid プランにする。`/api` が Worker を通るとリクエストに数えられ、無料枠（1 日 10 万。
      リセットは日本時間 9 時）を超えるとその日は Worker が失敗し、POS が止まる。`/status` の
      10 秒ごとの確認だけで端末 1 台あたり 1 日 8,640 になる
   2. Zero Trust はチーム `cafeore.cloudflareaccess.com` が既にあるので、それを使う。
      ログイン方法はワンタイム PIN（メール）で足りる
   3. Workers & Pages → `cafeore-pos`（`cafeore` アカウント）→ Access タブで、Worker ごと守る（「All traffic」）。
      ポリシーでスタッフ用と表示用のメールだけを許す。
      セッションの長さは学祭の期間より長くする（途中で切れると、その端末でログインし直しになる）。
      `pos.cafeore.cafe` だけを守るアプリケーションにしないこと。本番に出したバージョンごとのプレビュー URL
      （`<バージョン ID の先頭 8 文字>-cafeore-pos.cafeore.workers.dev`）が抜け道になる。PR のプレビューは `cafeorepos` の
      別の Worker なので、これでは守られない（今までどおり認証しない）。`cafeorepos` に残る前の本番のバージョンについては
      [移す手順](#pos-の-worker-を-cafeore-のアカウントに移す)の手順 5 の後ろ（トークンの入れ替え）
   4. Access → Applications でそのアプリケーションの AUD タグを控える

   ここで画面はログインが要るようになる。API はまだ今までどおり直接呼ばれている
2. **GitHub（このリポジトリの Variables）**
   1. `WORKERS_API_ORIGIN` に本番の API の URL（LB を置く前は infra の `terraform output prod_service_url`。今は手順 4-3 の LB の URL）を入れ、
      Actions の「pos / deploy (Workers)」を手動実行する
   2. ログインしたブラウザで `https://pos.cafeore.cafe/status` を開き、JSON が返ることを確かめる
   3. `VITE_API_BASE_URL` を `https://pos.cafeore.cafe` にして、もう一度手動実行する。
      これで画面が Worker 経由で API を呼ぶ
3. **infra（HCP Terraform の workspace variables）**。詳しくは infra の README の「API の認証」
   1. `api_auth_mode = "cloudflare-access-report-only"` と、チームのドメイン・AUD・メールを入れて apply する
   2. POS を一通り操作し（レジ・マスター・提供・呼び出し画面）、Cloud Run のログに弾くはずだったものが
      出ないことを確かめる。出ているものは Access を通らずに Cloud Run を直接叩いている

      ```sh
      gcloud logging read 'resource.type="cloud_run_revision"
        AND resource.labels.service_name="cafeore-pos-prod"
        AND textPayload:"auth(report-only)"' \
        --project cafeore-mice-512509 --freshness 1h --format 'value(textPayload)'
      ```

   3. `api_auth_mode = "cloudflare-access"` にして apply する
   4. `curl https://<本番の Cloud Run の URL>/api/items` が 401 になること、レジで注文が通ること、
      表示用のアカウントで開いた画面からは書き込めない（403）ことを確かめる
4. **LB と Cloud Armor（infra と Cloudflare）**。詳しくは infra の README の「LB と Cloud Armor」
   1. infra（本番のある workspace。今は `gcp-mice`）で `api_proxy_token`（sensitive。`openssl rand -hex 32`）を入れ、`api_lb_enabled = true` で apply する。
      LB のドメインは `pos-be-lb.cafeore.cafe`。Cloudflare の `cafeore` アカウントの `cafeore.cafe` に、A レコードを
      `terraform output api_lb_ip` に向けて作る（DNS only）。証明書が発行されるまで数十分かかる
   2. このリポジトリの Secrets の `LB_PROXY_TOKEN` に同じトークンを入れる。本番のデプロイで Worker の `PROXY_TOKEN` になる
   3. Variables の `WORKERS_API_ORIGIN` と `GCP_API_LB_URL` を `https://pos-be-lb.cafeore.cafe`（`terraform output api_lb_url`）にして、
      「pos / deploy (Workers)」を手動実行する。Square の Webhook を使っているなら通知先も LB の URL に登録し直す
   4. POS を一通り操作して動くこと（WebSocket も）を確かめてから、infra で `api_lb_only = true` にして apply する。
      これで run.app にはインターネットから届かなくなる

戻すとき（後の段階から順に）:
- LB を外す: infra で `api_lb_only = false` を apply し（run.app がまた開く）、`WORKERS_API_ORIGIN` と
  `GCP_API_LB_URL` を Cloud Run の URL に戻して手動実行する
- 認証だけを外す: `api_auth_mode = "off"` で apply（新しいリビジョンが立った時点で戻る）
- 中継もやめる: `VITE_API_BASE_URL` を Cloud Run の URL に戻して手動実行し、Access を無効にする

#### `cloudflare-access` にすると止まるもの

Cloud Run を直接呼んでいるものは 401 になる。手順 3-2 のログで、使われているかどうかが分かる。

- 今は無い。CaOS の公開版（GitHub Pages、`cafeore-tkb.github.io`）は Cloud Run を直接呼んでいたが、使っておらず、
  直書きされていた旧本番の `cafeore-pos-git` も消した。CaOS は POS の中の `/master-sheet`（Worker 経由）を使う

人ではない相手を通したいときは、Access のサービストークンを作り、その Client ID を `AUTH_STAFF_EMAILS`
か `AUTH_VIEWER_EMAILS` に入れる（api はメールの代わりに JWT の `common_name` を見る）。呼ぶ側は Worker の
URL に `CF-Access-Client-Id` と `CF-Access-Client-Secret` を付ける。

プレビュー（`cafeore-pos-preview` と PR の Worker のバージョン）は今までどおり認証しない。DB は PR ごとの
Neon のブランチで、本番のデータは入っていない。

### DB のスキーマ

**スキーマの正本は Go のモデル（`api/internal/models`）だけ。** SQL は書かないし、本番 DB を手で触らない。

- テーブルや列を足すときは、モデルを書き換える。新しいモデルは `models.All()`（`api/internal/models/all.go`）にも足す
- API は起動時に `AutoMigrate` でモデルを DB へ反映する（`api/cmd/server/migrate.go`）。本番・プレビュー・ローカルとも同じ
- 本番へはマージして Cloud Run にデプロイされた時点で反映される。失敗すると新しいリビジョンが起動せず、デプロイが落ちてトラフィックは前のリビジョンに残る
- 同時に起動したインスタンスは advisory lock で 1 つずつ走る。反映は 1 トランザクションなので、途中で失敗しても半端なスキーマは残らない
- 起動時に DB とモデルを比べ、DB にだけあるテーブル・列・トリガー・関数（手で触った跡）を `/status` の `schema_drift` に出す。デプロイの CI（`api-build.yml`）は空でなければ落ちる
- PR の CI（`api-ci` の `test`）でも確かめる。プレビューのラベルが無くても走る
  - `models` に struct を足したのに `models.All()` に入れ忘れると落ちる（テーブルが作られず、`schema_drift` でも気づけないため）
  - 空の Postgres 17 に起動時のマイグレーションをかけ、通ること・2 回目に何も変えないこと・`schema_drift` が空なこと・3 つ同時に走っても通ることを見る（手元での流し方は下の「backend のテスト」）

列を足したとき、既存の行には列の既定値（`default:` タグ）が入る。行ごとに違う値が要るときは、
`api/cmd/server/migrate.go` の商品の種類の項目（`itemTypeBackfills`。`makes_cup` は others だけ false など）のように、
その列がまだ DB に無いときだけ、AutoMigrate で足した直後に同じトランザクションで 1 回だけ入れる。
そのあと値を変えるのは画面や API の仕事。

`AutoMigrate` は足すのが基本で、**列の削除や名前の変更はしない**。モデルから消した列は DB に残る。
それが必要になったら、その変更だけ別途やり方を相談すること。

### backend のテスト

```bash
cd api && go test ./...
```

本物の Postgres を使うテストの接続先は、どれも **`TEST_DATABASE_URL` の 1 つだけ**で渡す。
無ければそのテストはスキップされる（CI では落とす）。手元では、たとえば `api/compose.yaml` の Postgres を立てて渡す。

```bash
docker compose -f api/compose.yaml up -d db
```

```bash
cd api && TEST_DATABASE_URL='postgres://postgres:example@localhost:5432/postgres?sslmode=disable' go test ./...
```

- 渡した DB の既存の schema・データには触らない。テストごとに使い捨ての schema か database を作り、終わったら消す
- **接続するロールには CREATEDB が要る**（起動時のマイグレーションのテストが使い捨ての database を作るため）。
  `compose.yaml` や CI の `postgres` ユーザーは持っている
- 拡張の `uuid-ossp` を渡した DB の public に入れる（無ければ作る）
- 本物の DB を使うテストを足すときは **`api/internal/testdb` を使い、別の環境変数を作らない**。
  ふつうは `testdb.New(t)`（使い捨ての schema にモデルからテーブルを作る）、public スキーマが前提のものは
  `testdb.NewDatabase`（使い捨ての database）

### 注文・オーダーストップ・レジの状態の配信（LISTEN / NOTIFY）

Cloud Run のインスタンスは、それぞれ自分につないでいる画面にしか WebSocket で配れない。ほかのインスタンスで変わった注文・オーダーストップ・レジの状態も届くよう、DB の通知（`LISTEN` / `NOTIFY`）でインスタンス同士が知らせ合う（`internal/handlers/order_listener.go`）。

| チャンネル | 何が変わったか | 通知の中身 |
| --- | --- | --- |
| `orders_changed` | 注文 | `<インスタンス ID> <注文 ID>` |
| `master_state_changed` | オーダーストップ（`POST /api/master-status`） | `<インスタンス ID>` |
| `cashier_state_changed` | レジの状態（`PUT /api/cashier-state`。お客さん向けの表示が使う） | `<インスタンス ID>` |
| `dripper_assignees_changed` | CaOS のドリッパーの担当者（`PUT /api/caos/lanes/{dripper}`・`POST /api/caos/lanes/swap`・`POST /api/caos/lanes/seniors`。表は `dripper_assignees`。配信は `{"type":"caos_lanes"}` で今日の 6 つ全部。`internal/handlers/caos_lanes.go`） | `<インスタンス ID>` |
| `order_recalled` | 呼び出し催促（`POST /api/orders/{id}/recall`。`internal/handlers/order_recall.go`）。DB には何も書かないので読み直さず、`{"type":"order_recalled"}` をそのまま配る（待ち受けていなかった間のものは配れない） | `<インスタンス ID> <注文 ID>` |
| `data_reset` | [データのリセット](#データのリセット)（`POST /api/admin/data-reset`）。`{"type":"data_reset"}` をそのまま配り、受けた画面は読み込み直す | `<インスタンス ID>` |

- 書き換えたインスタンスは、自分の画面へ配ったあと上の通知を `pg_notify` で送る。DB のトリガーは使わない
- ほかのインスタンスはそれを受けて DB から読み直し、自分の画面へ配る（通知は送り返さない）。自分が送った通知は無視する。全部のチャンネルを 1 本の接続でまとめて待ち受ける
- API を通さない書き換え（SQL で直接直すなど）は配られない。本番 DB は手で触らない
- 待ち受けを始めたとき（つなぎ直したときを含む）は、取りこぼしに備えて全注文・オーダーストップ・レジの状態・CaOS の今日の担当者（今日に替えていれば）を配り直す
- LISTEN は接続を保ったまま待つので、Supabase のトランザクションプーラー（ポート 6543）や Neon の pooler では通知が届かない（エラーにもならない）。`DATABASE_URL` がそれなら、`DATABASE_LISTEN_URL` に直接接続かセッションプーラーの接続文字列を入れる
- 待ち受けを始めたら自分宛てに確認の通知を送り、10 秒で届かなければ `WARNING: orders_changed の確認の通知が…` をログに出す。届けば `orders_changed: notifications are delivered`
- 配り終わる前に同じ注文（またはオーダーストップ・レジの状態）の通知が重なれば 1 回の読み直しにまとめる。レジはキー入力のたびに状態を保存するので、ほかのインスタンスにはまとめた最新の状態だけが届くことがある
- 本番の Cloud Run は CPU をリクエストの処理中だけ割り当てる（`infra` の `cpu_idle = true`。`--no-cpu-throttling` にはしていない）。画面が WebSocket でつないでいる間はリクエストの処理中なので、そのインスタンスは通知を受けて配れる。画面がつないでいないインスタンスは待ち受けが止まったり接続が切れたりしうるが、配る相手がいないので困らない。画面がつなぐと全注文・オーダーストップ・レジの状態を受け取り、待ち受けも 30 秒通知が無ければ接続を確かめ、切れていれば張り直して全部を配り直す。常時割り当てに変えるなら、この前提ごと見直すこと

### 運営・管理とマスタ設定は管理者だけ

本番（`AUTH_MODE` が `iap` か `cloudflare-access`）では、トップの「運営・管理」（ダッシュボード・在庫・商品管理・オペ練）と
「マスタ設定」（Square 端末・プリンター・データのリセット）の画面は、管理者（`AUTH_ADMIN_EMAILS`）しか開けない。
商品のキーは商品管理のメニューの「キーをキャプチャ」で登録する（`/menu-keys` は商品管理へ転送するだけ）。
「呼び出し画面」（CM・音・出す先の設定）は除く（呼び出し画面の端末で、その端末の閲覧のみのアカウントのまま選ぶため）。各種データ書き出しもスタッフのまま。

- **API**：その画面だけが使う書き込み（メニュー・アイテム・タイプ・背景色・在庫対象の追加・変更・削除、`PUT /api/printer-settings`、
  Square 端末の登録・ペアリング・削除）は管理者だけ（`routes.go` の `adminOnly`。`TestRegisterRoutesAdminOnly`）。
  **読み取り（GET）は閉じない。** レジ・マスター・提供・CaOS がメニュー・背景色・在庫・プリンター設定などを読むため。
  棚卸し・入荷の記録（`POST /api/inventory/resources/{id}/events`）も、CaOS の「豆残量確認」から記録するのでスタッフのまま
- **画面**：`GET /api/me` が `enforcement: enforce` で `role` が `admin` でなければ、ページを開かずに「管理者だけが開けます」と出す
  （`AdminOnly`）。読み取りの API は開いているので、画面で閉じているのは見せないためで、API の守りではない
- 認証を掛けていない設定（`off`・`*-report-only`。手元）では、今までどおり誰でも開けて書ける。PR のプレビューは管理者としてログインした扱いなので、全部開けて書ける
- **本番では、管理者を `AUTH_ADMIN_EMAILS`（infra の `api_auth_admin_emails`）に入れないと、メニューやプリンターの設定を誰も変えられない**

### プレビューは管理者としてログインした扱い

PR のプレビューには Access も IAP も無い。そこで CI（`api-build`）がプレビューのリビジョンにだけ `AUTH_PREVIEW_ADMIN=true` を渡し、
api は全部のリクエストを管理者 `preview` がログインしてきたものとして扱う（実際にはログインさせない。`internal/auth/preview.go`）。
弾く設定（`GET /api/me` は `enforcement: enforce`・`role: admin`・`email: preview`）のまま管理者として通るので、
[データのリセット](#データのリセット)も[運営・管理とマスタ設定](#運営管理とマスタ設定は管理者だけ)も本番と同じ確かめ方で使える。
画面もプレビューでは `/api/me` を聞き、トップページに「プレビュー」と「管理者」を出す。

- **本番には渡さない。** `AUTH_MODE` が `off`（か空）のときだけ使え、`iap`・`cloudflare-access`（`*-report-only` も）と一緒だと
  api は起動しない。infra の `api_auth_mode` もこの値を受け付けない
- その PR の Neon ブランチを用意できなかったときは渡さず、前のデプロイが入れたものも `--remove-env-vars` で消す。環境変数は
  サービスの設定を引き継ぐので、`DATABASE_URL` がほかの PR のブランチのままのことがあり、そこを管理者として消せてしまうため。
  そのリビジョンは `AUTH_MODE` が `off` で動く（データのリセットは使えない）
- `AUTH_MODE` の値にしなかったのは、プレビューのサービスはほかの PR と共有で、環境変数を引き継ぐため。知らない `AUTH_MODE` を
  引き継いだ古い api は起動しなくなるが、知らない環境変数は読まれないだけで済む

### データのリセット

POS のトップの「データのリセット」（`/data-reset`）で、営業で溜まったデータ（注文・CaOS の記録・Square の決済の記録・
棚卸しと入荷の記録・受付状態の履歴など）を消せる。メニュー・アイテム・在庫対象・背景色・プリンター・Square 端末の
設定は残す。表の中身を `TRUNCATE` するだけで、DB のユーザーやスキーマには触らない（DB のユーザーを作り直す必要は無い）。
API は `internal/handlers/data_reset.go`。

- **管理者（`AUTH_ADMIN_EMAILS`）だけ。** `AUTH_MODE` が `off` か `*-report-only` のときは、管理者でも使えない
  （`auth.RequireStrict`）
- **PR のプレビューでは使える。** プレビューは管理者としてログインした扱いなので
  （[プレビューは管理者としてログインした扱い](#プレビューは管理者としてログインした扱い)）。消えるのはその PR のプレビューの DB
  （向き先の PR の backend を使う PR なら、向き先の PR のもの）。手元で試すときは `AUTH_PREVIEW_ADMIN=true` を入れる
- 次を全部満たすときだけ消す。どれかが欠ければ何も消さない
  - 受付を止めている（オーダーストップの最後の記録が `stop`）
  - 消す表の今の中身を全部ダウンロードしている。画面がダウンロードしたファイルの SHA-256 を送り、api は消す直前に表をロックして
    同じ形のファイルを作り直して比べる。ダウンロードのあとに 1 行でも変わっていれば断るので、もう一度ダウンロードする
  - 確認の文字（`リセット`）を打っている
  - 消す表にも残す表にも入っていない表が DB に無い
- 消したら WebSocket の `data_reset` を配り、開いている画面は読み込み直す
- **表を足したら（`models.All` に足したら）、`data_reset.go` の `dataResetTables`（消す）か `dataResetKeptTables`（残す）に足す。**
  足し忘れると `TestDataResetTablesCoverModels` が落ち、本番でもリセットが断られる
- 消したデータは戻せない。ダウンロードした JSON（表ごとの全行。DB の列名のまま）から戻す仕組みは無い

### 在庫の数え方

人が入れるのは棚卸しの実数（と入荷）だけで、残りは API が DB から数える（`GET /api/inventory`・`internal/handlers/inventory.go`）。在庫は提供の画面の側で数え、CaOS とは切り離している。

- 残り ＝ 最後の棚卸しの実数 ＋ その後の入荷・調整 − その後に使った分
- 使う量は、注文を受けたとき・淹れ直しを足したときの在庫の設定で決めて残す（`order_stock_usages`・`cup_emergency_stock_usages`）
- 棚卸しの前か後か・直近 1 時間か（`servings_last_hour`）は、次の時刻で決める
  - 抽出が要るカップ（豆などのアイテムの在庫とカップ）：提供の画面でそのカップを提供可能にした時刻（`order_cups.ready_at`）。無ければ提供済みにした時刻（`served_at`）。どちらも無ければ、まだ使っていない
  - 抽出の要らない物（グッズ・ミルク・コースターなど）：注文を受けた時刻
  - 緊急（淹れ直し）：淹れ直しを足した時刻（取り消せば数えない）
- CaOS の抽出の時刻（`brew_started_at`）は見ない。まだ提供可能にしていない注文を先に引くこともしない
- 通知（Slack）は、注文の作成・編集・削除、提供の画面の書き込み（提供可能・提供）、淹れ直しを足した・取り消したときに、その在庫対象を確かめる

### PR ごとの Neon ブランチ

`NEON_PROJECT_ID` が設定されていれば、PR のプレビュー用に Neon のブランチを
**0.25〜1 CU** で用意し、その接続文字列をプレビュー用 Cloud Run の
`DATABASE_URL` に渡す。Cloud Run の環境変数はリビジョン単位なので、
リビジョンごとに違う DB を指せる。

| PR の種類 | 使うブランチ |
| --- | --- |
| DB のスキーマや中身に影響するファイルを変えている | その PR 専用の `preview/pr-<番号>` |
| 別の PR の上に積んでいて、自分でも backend を変えている | その PR 専用の `preview/pr-<番号>` |
| 別の PR の上に積んでいて、backend を変えていない | 自分の backend を立てず、向き先の PR の backend（と DB）を使う（下の「積んだ PR のプレビュー」） |
| それ以外（フロントだけ、依存更新など） | 共有の `preview/shared` |

#### 積んだ PR のプレビュー

別の PR の上に積んだ PR（向き先が main 以外）は、差分に出ない下の PR の backend の変更（新しい表など）を
含みうる。共有ブランチで起動すると AutoMigrate が main に無い表を作り、ほかの PR のスキーマの確認が落ちる。

なので、積んだ PR で backend（`api/` と `api-build.yml`）を変えていないものは、自分の backend を立てず、
向き先の PR の backend（`pr-<番号>` のリビジョンと、その Neon ブランチ）を使う。中の backend は向き先と
同じコードだから。向き先もそうなら、さらに上へたどる（`.github/scripts/preview-backend-owner.sh`）。
`api-build.yml` は build を飛ばして「#<番号> の backend を使う」とコメントし、`pos-deploy-workers.yml` は
画面のプレビューをその backend に向ける。たどった先の PR に `preview` ラベルが無いときや、向き先を head に
持つ PR が無いときは、自分の backend を専用ブランチで立てる。

積んだ PR 同士は同じ backend と DB を使うので、上の PR の画面で操作した結果は下の PR の backend に入る。
向き先の PR が閉じたりマージされたりすると、その backend は片付けられる。積んだ PR の画面のプレビューは、
次に走ったとき（push やラベルの付け直し）に、新しい向き先に合わせて向き直る。

「DB に影響するファイル」は `api-build.yml` の `DB_AFFECTING_PATHS` で決めていて、
今は `api/` と `.github/workflows/api-build.yml`。**DB のスキーマや中身に影響する
ファイルを `api/` の外に置くときは、`DB_AFFECTING_PATHS` に足すこと**
（例: ルートに `migrations/` を作る、seed を別の場所に置く）。

それ以外の PR の backend は main と同じコードなので、共有ブランチで足りる。
ただし共有ブランチの注文やレジ状態（`cashier_states`）は、それらの PR 同士で共有される。
プランの上限（`branches limit exceeded`）に当たった場合は、Neon のコンソールで
不要な `preview/pr-*` を消してから re-run する。共有ブランチは `pr-cleanup` の対象外なので消えない。
共有ブランチは作り直されず、`AutoMigrate` は列や制約を足すだけで消さない。main で列の削除や
名前変更があって共有ブランチの DB が壊れたら、Neon のコンソールで `preview/shared` を消して
re-run する（次のビルドで空から作り直される）。

空のブランチでも、API が起動時に `uuid-ossp` 拡張を入れてからテーブルを作るので、そのまま動く
（[DB のスキーマ](#db-のスキーマ)を参照）。

ブランチは copy-on-write なので作成は即時。アイドル 5 分でゼロに縮む。
PR を閉じるか `preview` ラベルを外すと `pr-cleanup` が compute ごと消す。

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
例外は後片付けの `pr-cleanup` だけで、コンフリクトしたまま閉じた PR やラベルを外した PR でも
走らせるために `pull_request_target` を使っている。こちらは PR のコードを
checkout せず PR 番号しか使わないので、fork の PR のコードが実行されることはない。
書き込み権限は `preview` ラベルを外す job に `pull-requests: write` を渡すだけにしている。

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

### PR を閉じたとき・ラベルを外したときの後片付け

`pr-cleanup` は PR を閉じたときと `preview` ラベルを外したときに走る。
閉じたときは、片付けが全部成功したら `preview` ラベルも外す
（GITHUB_TOKEN で外すので、それによって `pr-cleanup` が走り直すことはない）。

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
残り続ける。`pr-<番号>` のエイリアスも、最後に上げたバージョンを指したまま残る
（Cloudflare は直近に上げた 1000 個までしか持たず、超えると古いものから消える）。
公開したままにしたくない場合は `wrangler.jsonc` の `preview_urls` を
`false` にして、プレビュー URL の配信自体を止めること。

### 必要な設定

| キー | 種別 | 使う workflow |
|--|--|--|
| `WORKERS_CLOUDFLARE_API_TOKEN` | Secrets | `pos-deploy-workers`。PR のプレビューの出し先（`cafeorepos`）。`WORKERS_PROD_*` が無いときは本番もここ |
| `WORKERS_CLOUDFLARE_ACCOUNT_ID` | Variables | 同上（アカウント ID は秘密情報ではない） |
| `WORKERS_PROD_CLOUDFLARE_API_TOKEN` | Secrets | 同上（任意）。本番の deploy の出し先（`cafeore`）。独自ドメインを付けるので、そのゾーンの Workers Routes の Edit も要る |
| `WORKERS_PROD_CLOUDFLARE_ACCOUNT_ID` | Variables | 同上（任意）。上と組で入れる。片方だけだとデプロイを止める |
| `WORKERS_CUSTOM_DOMAIN` | Variables | 同上（任意）。本番の Worker に付ける独自ドメイン（GCP に移した後は `pos-cf.cafeore.cafe`。`https://` は付けない。`POS_WEB_DOMAIN` と同じだとデプロイを止める）。入れると本番の workers.dev は止まる。ゾーンが `WORKERS_PROD_CLOUDFLARE_ACCOUNT_ID` のアカウントに要るので、`WORKERS_PROD_*` 無しで入れるとデプロイを止める（[移す手順](#pos-の-worker-を-cafeore-のアカウントに移す)） |
| `WORKERS_AUTO_DEPLOY_IF_NOT_EXIST` | Variables | 同上（任意。`true` のときだけ上記のフォールバックが働く） |
| `POS_WEB_DEPLOY` | Variables | `pos-deploy-cloudrun`（任意）。`false` にすると本番の画面を Cloud Run に出さない（既定は出す） |
| `POS_WEB_DOMAIN` | Variables | `pos-deploy-workers`（任意）。GCP の LB が使うドメイン。既定 `pos.cafeore.cafe`。`WORKERS_CUSTOM_DOMAIN` がこれと同じだと、Workers の本番のデプロイを止める（CI の wrangler は既にある DNS レコードを上書きして独自ドメインを付けるので、GCP に向けた DNS を奪う） |
| `POS_WEB_CLOUD_RUN_SERVICE` | Variables | `pos-deploy-cloudrun`（任意）。既定 `cafeore-pos-web`（infra の output `pos_web_service_name`） |
| `POS_WEB_API_BASE_URL` | Variables | `pos-deploy-cloudrun`（任意）。画面に焼き込む API のオリジン。既定 `https://pos.cafeore.cafe`（画面と同じ） |
| `WEBHOOK_URL` | Secrets | `pos-deploy-workers`・`pos-deploy-cloudrun`（画面に焼き込む。Cloud Run のイメージには BuildKit の secret で渡し、ビルドの記録に残さない） |
| `VITE_API_BASE_URL` | Variables | `pos-deploy-workers` |
| `VITE_API_BASE_URL_PREVIEW` | Variables | 任意。PR で backend の URL を引けなかったときのフォールバック |
| `WORKERS_API_ORIGIN` | Variables | `pos-deploy-workers`。本番の Worker が `/api` を中継する先（今は mice の LB の `https://pos-be-lb.cafeore.cafe`）。`VITE_API_BASE_URL` を Worker に向けたのにこれが無いと、デプロイを止める |
| `LB_PROXY_TOKEN` | Secrets | `pos-deploy-workers`。本番の Worker の secret `PROXY_TOKEN` に入れる、LB の Cloud Armor と照らし合わせるトークン（infra の `api_proxy_token` と同じ値）。`WORKERS_API_ORIGIN` があるのにこれが無いと、デプロイを止める |
| `ELEVENLABS_API_KEY` | Secrets | `pos-deploy-workers`。呼び出し画面の音声を作る ElevenLabs の鍵。本番の deploy にもプレビューの versions upload にも、Worker の secret `ELEVENLABS_API_KEY` として入れる（[呼び出しの音声](#呼び出しの音声elevenlabsr2)）。無いと音声は流れず、チャイムだけになる |
| `GCP_API_LB_URL` | Variables | `api-build`。任意。本番のデプロイの後の `/status` の確認を LB を通して行う（infra の `api_lb_url`。今は `https://pos-be-lb.cafeore.cafe`）。Cloud Run の入口を LB だけにしたら要る |
| `STAGING_DEPLOY` | Variables | `deploy-staging`（任意）。`false` にすると staging に出さない（既定は出す） |
| `STAGING_WEBHOOK_URL` / `SANDBOX_WEBHOOK_URL` | Secrets | `deploy-staging` / `deploy-sandbox`（任意）。その環境の画面に焼き込む Slack の Webhook。無ければ空（本番の `WEBHOOK_URL` は使わない） |
| `STAGING_API_CLOUD_RUN_SERVICE`・`STAGING_API_LB_URL`・`STAGING_POS_WEB_CLOUD_RUN_SERVICE`・`STAGING_POS_WEB_URL` | Variables | `deploy-staging`（任意）。既定 `cafeore-pos-stg`・`https://pos-be-lb-stg.cafeore.cafe`・`cafeore-pos-stg-web`・`https://pos-stg.cafeore.cafe`（infra の output `environments.staging`）。infra で名前やドメインを変えたときだけ入れる |
| `SANDBOX_API_CLOUD_RUN_SERVICE`・`SANDBOX_API_LB_URL`・`SANDBOX_POS_WEB_CLOUD_RUN_SERVICE`・`SANDBOX_POS_WEB_URL` | Variables | `deploy-sandbox`（任意）。既定 `cafeore-pos-sandbox`・`https://pos-be-lb-sandbox.cafeore.cafe`・`cafeore-pos-sandbox-web`・`https://pos-sandbox.cafeore.cafe`（output `environments.sandbox`） |
| `NEON_API_KEY` | Secrets | PR ごとの Neon ブランチ作成・削除。project-scoped キー推奨 |
| `NEON_PROJECT_ID` | Variables | 同上。**未設定なら Neon 連携ごとスキップ** |
| `NEON_PREVIEW_CU` | Variables | 任意。既定 `0.25-1` |

`VITE_*` は静的ファイルに焼き込まれるので**ブラウザから読める**。未設定だと
空文字が焼き込まれる。

POS の Worker の `PROXY_TOKEN` は `wrangler secret put` で置かず、GitHub の `LB_PROXY_TOKEN` から
本番のデプロイのたびに `wrangler deploy --secrets-file` で入れ直す。Worker に置いておくだけだと、
PR のプレビューの `versions upload` の直後の deploy で消えたことがある。トークンを変えるときは
`LB_PROXY_TOKEN` を変えて「pos / deploy (Workers)」を手動実行する（infra の `api_proxy_token` も揃えること）。

GCP 側（`api-build`・`pos-deploy-workers`・`pos-deploy-cloudrun`・`deploy-environment`・`pr-cleanup`）の workflow の既定値は、cafeore のプロジェクト
（`project-5d6e656b-4871-46ff-96f`）のまま。本番もプレビューも mice にあるので（[backend](#backendartifact-registry--cloud-run)）、
次の Variables に mice の値を入れている（対応は infra の README「GitHub 側の設定」「本番を mice に移す」の手順 4）。
**消すと既定値の cafeore に戻り、本番のデプロイが落ちる**（cafeore には本番のサービスも、CI のデプロイ権限も無い）。

| Variables | 値 |
| --- | --- |
| `GCP_PROJECT_ID` | `cafeore-mice-512509` |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | mice の `terraform output github_actions_workload_identity_provider` |
| `GCP_SERVICE_ACCOUNT` | mice の `terraform output github_actions_service_account_email` |

`GCP_REGION` / `GCP_AR_CONTAINER_REPOSITORY` / `GCP_CLOUD_RUN_SERVICE` / `GCP_CLOUD_RUN_PREVIEW_SERVICE` は
mice でも既定値と同じ（`asia-northeast1` / `cafeore-pos` / `cafeore-pos-prod` / `cafeore-pos-preview`）なので、入れなくてよい。
