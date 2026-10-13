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
| `pos-ci` / `common-ci` / `api-ci` | 各パッケージ | typecheck / lint / unit test（`api-ci` は Docker イメージのビルドも見る。push はしない） |
| `api-build` | `api` | イメージをビルドして Artifact Registry へ push し、Cloud Run へデプロイ |
| `pos-deploy-workers` | `services/pos` | ビルドして Cloudflare Workers へデプロイ |
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

POS は `ssr: false` の SPA。画面は `build/client` を静的アセットとして
配信する（`services/pos/wrangler.jsonc`）。アセットに無いパスは `index.html` を返す
（`not_found_handling: single-page-application`）。

Worker のスクリプトで `/api/*`・`/status`・`/health` を Cloud Run の API へ
中継する（`services/pos/worker/index.ts`。理由は [API の認証](#api-の認証cloudflare-access)）。
中継先は本番のデプロイのときだけ `WORKERS_API_ORIGIN` を `--var API_ORIGIN:...` で渡す。
PR のプレビューでは渡さないので、プレビューの URL の `/api` は 503 を返す
（プレビューの画面は Cloud Run を直接呼ぶので使わない）。

main への push と手動実行では本番へ `wrangler deploy` する。PR（`preview` ラベル付きのみ）では
`wrangler versions upload` に切り替え、本番のトラフィックは向けずに
プレビュー URL 付きのバージョンだけ作る。

PR ではプレビュー URL を**コメントで貼る**。2回目以降は新しいコメントを足さず、
同じコメントを書き換える（本文に埋めた目印で自分のコメントを探している）。

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
POS は `pnpm pos deploy --var API_ORIGIN:<本番の Cloud Run の URL>` のように中継先を必ず渡すこと。
渡さないと、画面が Worker 経由で API を呼ぶ設定のときに本番の POS が API に届かなくなる。

### 呼び出しの音声（ElevenLabs・R2）

呼び出し画面（`/callscreen`）は、ElevenLabs で作った音声で次の 2 つを読み上げる。重なったときは 1 件ずつ順に流す。

| いつ | 読む文 | チャイム |
|--|--|--|
| 番号を呼んだとき | （順番が前後いたします。）N番のお客様、提供口までお越しください。 | 先に鳴らす |
| CaOS でカードを淹れ始めたとき（空いたドリッパーに割り当てた・積まれていたカードを担当し始めた）。1 つの注文につき最初の 1 回だけ | N番のお客様、ファーストにてドリップいたします。（よろしければぜひ、お近くでご覧ください。） | 鳴らさない（呼び出しと取り違えないため） |

- 音声は POS の Worker の `/call-voice/call?order=N(&reordered=1)`・`/call-voice/drip?order=N&dripper=K` が返す
  （`services/pos/worker/call-voice.ts`。ドリップの案内の括弧の中は `&invite=0` で省く）。文は Worker が決め、画面が渡すのは番号・「順番が前後するか」・ドリッパーの番号・括弧の中を省くかだけ。
  決まった文しか読ませないので、作る音声の数には上限がある（番号は 1〜9999、ドリップの案内は 1 枚のカードの 2 注文まで）
- 文は片（「N番のお客様、」「提供口までお越しください。」「順番が前後いたします。」「ファーストにてドリップいたします。」
  「よろしければぜひ、お近くでご覧ください。」）に分けて作り、Worker がつないで 1 本の MP3 で返す（`worker/mp3.ts`。
  片ごとの ID3 タグと Info ヘッダーを落としてフレームをつなぐ）。番号の片は呼び出しとドリップの案内で同じものを使う。
  ドリッパーは画面の「1st」ではなく「ファースト」のように仮名で読ませる
- 片は R2 のバケット `cafeore-call-voices`（Cloudflare のアカウント `cafeorepos`）に溜め、溜めてあれば ElevenLabs を呼ばない。
  鍵は ElevenLabs に送る中身（片の文・声・モデル・設定）のハッシュなので、文や声を変えると自然に作り直す。
  同じ鍵のまま作り直したいときは、`call-voice.ts` の `CACHE_VERSION` を上げるか、バケットの中身を消す。本番とプレビューで同じバケットを使う
- 間を空けないように：呼び出しは音声が届いてからチャイムを鳴らし、鳴り終わったらすぐ読む（8 秒待っても届かなければチャイムだけ）。
  さらに、まだ呼んでいない注文の呼び出しの音声を、画面に見えた時点で先に作らせておく（番号の片が溜まるので、ドリップの案内も速くなる）
- 呼ぶ注文より先に注文した注文（同じ日）がまだ待っている（準備完了でも提供済みでもない）ときは、冒頭に
  「順番が前後いたします。」を付ける（`@cafeore/common` の `isCallOutOfOrder`）
- ドリップの案内は 1 つの注文につき最初の 1 回だけ流す（2 杯を続けて・別のドリッパーで淹れても、2 回目からは流さない。
  統合したカードで片方の注文はもう案内していれば、まだの注文の番号だけを読む）。緊急（入れ直し）のカード、もう呼んだ注文のカードでは流さない
- 「よろしければぜひ、お近くでご覧ください。」は、前にそれを付けた案内から 1 分以内（立て続け）なら省く。付けた案内から数えるので、
  続いている間も 1 分に 1 回は付く（`@cafeore/common` の `planDripAnnouncement`）
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
  Access で守っていなければ、その URL の `/call-voice` も誰でも叩ける。片の数は番号の幅で抑えてあるが、
  ElevenLabs の利用枠が気になるなら、プレビューの URL も Access で守るか、`preview_urls` を止める

### backend（Artifact Registry → Cloud Run）

`api-build` が `api/Dockerfile` からイメージを作り、Artifact Registry へ push する。
main への push と手動実行では、続けて Cloud Run サービス `cafeore-pos-prod` を
そのイメージで更新する。**PR では本番に触らず、プレビュー用の別サービス**
（既定 `cafeore-pos-preview`）へデプロイし、その URL を PR にコメントする。

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
| `DATABASE_URL` | `api/.env` | CI が Neon の接続文字列を渡す | Secret Manager の `supabase-database-url` |
| `DATABASE_LISTEN_URL` | 未設定（`DATABASE_URL` を使う） | CI が Neon の pooler を通らない接続文字列を渡す | 未設定（`DATABASE_URL` がセッションプーラーなので不要）。トランザクションプーラー（ポート 6543）に変えたら、直接接続かセッションプーラーの接続文字列 |
| `FRONTEND_ORIGINS` | 未設定（`localhost` を許可） | `*` | Workers の URL をカンマ区切り |
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
| `AUTH_MODE` | 未設定（`off`） | 未設定（`off`） | `off` → `cloudflare-access-report-only` → `cloudflare-access`（[API の認証](#api-の認証cloudflare-access)） |
| `CF_ACCESS_TEAM_DOMAIN` / `CF_ACCESS_AUD` | 未設定 | 未設定 | Zero Trust のチームのドメインと、POS の Access アプリケーションの AUD タグ |
| `AUTH_STAFF_EMAILS` / `AUTH_VIEWER_EMAILS` | 未設定 | 未設定 | 何でもできる相手 / 読むだけの相手のメール（カンマ区切り） |

プレビューと本番の値は infra リポジトリの `gcp/cloud_run_preview.tf` と
`gcp/cloud_run.tf` にある。`DATABASE_URL` が未設定だと `initDB` が `log.Fatal` する。

### プリンター（ラベル・レシート）

レジのブラウザが Epson のプリンター（ePOS-Print）へ直接つなぐ（SDK は `services/pos/public/epos-2.27.0.js`）。
サーバーはプリンターにつながず、IP アドレスを持っておくだけ。

| プリンター | 刷るもの | 既定の IP アドレス |
| --- | --- | --- |
| ラベル用 | カップに貼るシール（注文を送ったとき。Square は決済画面が出たとき） | `192.168.77.2` |
| レシート用 | レシート（会計のたび）と領収書（求められたときだけ） | `192.168.77.3` |

- IP アドレスは管理画面 `/printer-settings`（トップの「マスタ設定」→「プリンター」）で設定する。**全レジで共通**で、
  DB（`printer_settings` の 1 行）に持つ。一度も保存していなければ上の既定値を使う。
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
  Square なら決済手段を載せ、最後に引換券番号（注文番号）を大きく載せる。引換券のシールは今までどおりラベル用で刷る。
- 領収書はレジの「過去の注文」の「領収書」を押したときだけ刷る。宛名は手書きの空欄、但し書きは「飲食代として」、
  金額は請求額（割引後）、日付は注文を受けた日。横長に描いて 90 度回して刷る（「領収書」の側が先に出る）。
  何度でも刷れ、再発行の印は付かない。
- 中身は `services/pos/app/label/receipt.ts`、描き方は `receipt-canvas.ts`。太字やロゴの横並びをデザインどおりに
  刷るため、プリンターの文字ではなく、ブラウザの canvas で描いた白黒の画像を刷る（フォントは画面と同じ Noto Sans JP、
  ロゴは `app/assets/receipt/ore-logo.svg`）。寸法は幅 576 の座標で決めてあり、刷るときに紙の印字幅
  （`RECEIPT_WIDTH`）に縮める。今は **TM-m30 の 58mm の紙（420 ドット）** に合わせてある。80mm の紙に替えるときは
  `RECEIPT_WIDTH` を 576 にする（ほかの機種は印字幅のドット数を確かめる。広すぎると右端が切れる）。
  プリンターの設定（紙を切るなど）は `infra/epos.ts` の `RECEIPT_EPOS_PRINTER_CONFIG`。

### Square Terminal 連携

レジの確定欄から Square Terminal に決済画面（カード・電子マネー・QR コード）を出す。
**決済が先・注文が後**の順で、端末で支払いが終わってから注文を登録し、ラベルを印刷する。
`SQUARE_ACCESS_TOKEN` が無ければ無効で、レジに Square のボタンは出ない。

- アクセストークンはサーバーだけが持つ。ブラウザから Square の API は呼ばない。
- 端末は何台でも登録でき、DB（`square_devices`）に持つ。追加・取り込み・外すのは管理画面 `/square-devices` で行う。
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
- 決済が終わっても端末にレシート受け取り画面（印刷・メール・SMS）は出さない（`skip_receipt_screen`）。
  レシートは注文を登録できたときにレジがレシート用のプリンターで刷る（[プリンター](#プリンターラベルレシート)を参照）。
  端末から出すなら Terminal API の
  [Issue receipts](https://developer.squareup.com/docs/terminal-api/advanced-features/issue-receipts) を使う（未実装）。
- 返金は全額だけで、レジの「過去の注文」（Square で払った注文）と「未登録の Square 決済」の「返金」から行う。
  「過去の注文」には「返金（キャンセルしない）」もあり、こちらは返金だけして注文は残す（下の注文を残す返金を参照）。
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
- 商品明細を端末やレシートに出す件は [#778](https://github.com/cafeore-tkb/cafeore-pos/issues/778)。

端末のペアリング（端末ごとに 1 回）:

1. 管理画面 `/square-devices`（トップの「マスタ設定」→「Square 端末」）で名前を入れて「コードを発行」を押す
2. 端末のサインイン画面で「デバイスコードでサインイン」を選び、一覧に出たコードを入力する
3. 一覧で「ペアリング済み」になったら、使うレジの画面右上でその端末を選ぶ

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

**`AUTH_MODE` を `cloudflare-access` にするまでは、API の URL を知っていれば誰でも全部の操作ができる。**
URL は POS の JS に入っているので、画面を開けば分かる（秘密ではない）。CORS は止めにならない
（Origin を付けない curl などには効かない）。

```
ブラウザ ─→ Cloudflare Access ─→ POS の Worker ─→ LB ＋ Cloud Armor ─→ Cloud Run（api）
             （ログイン）          （/api を中継。     （トークンを照合）    （JWT を検証）
                                   トークンを付ける）
```

- POS（`cafeore-pos.cafeorepos.workers.dev`）を Access で守る。ログインしないと画面も開けない
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
- `/api` のグループ全体に「GET は表示用以上、それ以外はスタッフ」が掛かっているので、ルートを足しても
  書き込みは開かない（`api/cmd/server/main.go`）
- 次は Access を通らずに来るので、`/api` のグループの外に置いて自前で確かめている

  | 呼び出し元 | ルート | 通り道（LB を置いた後） | 確かめ方 |
  | --- | --- | --- | --- |
  | Cloud Scheduler | `POST /api/inventory/remind` | run.app に直接（同じプロジェクトなので「内部」として届く） | Google の ID トークン |
  | Square | `POST /api/square/webhook` | LB（Cloud Armor はトークンなしで通す） | Webhook の署名 |
  | デプロイの CI・POS の接続確認 | `GET /status`・`GET /health` | LB（CI は `GCP_API_LB_URL`）・Worker | 認証しない（稼働状況だけ） |

- Worker 経由でも、ブラウザの `Origin`（`https://cafeore-pos.cafeorepos.workers.dev`）はそのまま API に届き、
  CORS で照らし合わされる。同じオリジンになったからといって `FRONTEND_ORIGINS` から消すと、書き込みと
  WebSocket が 403 になる
- Access のセッションが切れると、API への fetch と WebSocket が Access のログイン画面へ飛ばされて
  失敗し続ける。POS は `/status` が 401 になったら（`X-Requested-With` を付けているので、セッション切れの
  ときは Access が 401 を返す）画面を読み込み直して Access のログインへ戻す（`useOnlineStatus`）。
  続けて読み込み直すのは 1 分に 1 回まで

#### 切り替える手順

順番を守ること。どの段階でも、前の段階に戻せば元に戻る。

**本番の Cloud Run は `cafeore-pos-git` から `cafeore-pos-prod` へ移している途中**（infra の README
「本番サービスの改名」）。認証の設定が渡るのは新しい `cafeore-pos-prod` だけで、旧サービスは
**消すまで誰でも叩ける**（DB は同じ）。中継先には新しいサービスの URL を使い、保護が完成するのは
旧サービスを消してから。

1. **Cloudflare（ダッシュボードで手作業）**
   1. Workers を Paid プランにする。`/api` が Worker を通るとリクエストに数えられ、無料枠（1 日 10 万。
      リセットは日本時間 9 時）を超えるとその日は Worker が失敗し、POS が止まる。`/status` の
      10 秒ごとの確認だけで端末 1 台あたり 1 日 8,640 になる
   2. Zero Trust を有効にしてチーム名を決める（`<チーム名>.cloudflareaccess.com`）。
      ログイン方法はワンタイム PIN（メール）で足りる
   3. Workers & Pages → `cafeore-pos` → Settings → Domains & Routes で、workers.dev の
      「Enable Cloudflare Access」を押す。ポリシーでスタッフ用と表示用のメールだけを許す。
      セッションの長さは学祭の期間より長くする（途中で切れると、その端末でログインし直しになる）
   4. Access → Applications でそのアプリケーションの AUD タグを控える

   ここで画面はログインが要るようになる。API はまだ今までどおり直接呼ばれている
2. **GitHub（このリポジトリの Variables）**
   1. `WORKERS_API_ORIGIN` に `cafeore-pos-prod` の URL（infra の `terraform output prod_service_url`）を入れ、
      Actions の「pos / deploy (Workers)」を手動実行する
   2. ログインしたブラウザで `https://cafeore-pos.cafeorepos.workers.dev/status` を開き、JSON が返ることを確かめる
   3. `VITE_API_BASE_URL` を `https://cafeore-pos.cafeorepos.workers.dev` にして、もう一度手動実行する。
      これで画面が Worker 経由で API を呼ぶ
3. **infra（HCP Terraform の workspace variables）**。詳しくは infra の README の「API の認証」
   1. `api_auth_mode = "cloudflare-access-report-only"` と、チームのドメイン・AUD・メールを入れて apply する
   2. POS を一通り操作し（レジ・マスター・提供・呼び出し画面）、Cloud Run のログに弾くはずだったものが
      出ないことを確かめる。出ているものは Access を通らずに Cloud Run を直接叩いている

      ```sh
      gcloud logging read 'resource.type="cloud_run_revision"
        AND resource.labels.service_name=~"^cafeore-pos-(git|prod)$"
        AND textPayload:"auth(report-only)"' \
        --project project-5d6e656b-4871-46ff-96f --freshness 1h --format 'value(textPayload)'
      ```

   3. `api_auth_mode = "cloudflare-access"` にして apply する
   4. `curl https://<本番の Cloud Run の URL>/api/items` が 401 になること、レジで注文が通ること、
      表示用のアカウントで開いた画面からは書き込めない（403）ことを確かめる
4. **LB と Cloud Armor（infra と Cloudflare）**。詳しくは infra の README の「LB と Cloud Armor」
   1. infra で `api_proxy_token`（sensitive。`openssl rand -hex 32`）を入れ、`api_lb_enabled = true` で apply する。
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

- **CaOS の公開版（GitHub Pages、`cafeore-tkb.github.io`）**。別のリポジトリに Cloud Run の URL が直書きされていて、
  WebSocket で注文を直接読んでいる（infra の README「本番サービスの改名」）。Access のログインは POS の
  workers.dev に付くもので、別のサイト（github.io）からの通信には付けにくいので、そのままでは通せない。
  POS の中の CaOS（`/master-sheet`）は Worker 経由なので動く。続けて使うならそちらに寄せる

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

- 書き換えたインスタンスは、自分の画面へ配ったあと上の通知を `pg_notify` で送る。DB のトリガーは使わない
- ほかのインスタンスはそれを受けて DB から読み直し、自分の画面へ配る（通知は送り返さない）。自分が送った通知は無視する。全部のチャンネルを 1 本の接続でまとめて待ち受ける
- API を通さない書き換え（SQL で直接直すなど）は配られない。本番 DB は手で触らない
- 待ち受けを始めたとき（つなぎ直したときを含む）は、取りこぼしに備えて全注文・オーダーストップ・レジの状態・CaOS の今日の担当者（今日に替えていれば）を配り直す
- LISTEN は接続を保ったまま待つので、Supabase のトランザクションプーラー（ポート 6543）や Neon の pooler では通知が届かない（エラーにもならない）。`DATABASE_URL` がそれなら、`DATABASE_LISTEN_URL` に直接接続かセッションプーラーの接続文字列を入れる
- 待ち受けを始めたら自分宛てに確認の通知を送り、10 秒で届かなければ `WARNING: orders_changed の確認の通知が…` をログに出す。届けば `orders_changed: notifications are delivered`
- 配り終わる前に同じ注文（またはオーダーストップ・レジの状態）の通知が重なれば 1 回の読み直しにまとめる。レジはキー入力のたびに状態を保存するので、ほかのインスタンスにはまとめた最新の状態だけが届くことがある
- 本番の Cloud Run は CPU をリクエストの処理中だけ割り当てる（`infra` の `cpu_idle = true`。`--no-cpu-throttling` にはしていない）。画面が WebSocket でつないでいる間はリクエストの処理中なので、そのインスタンスは通知を受けて配れる。画面がつないでいないインスタンスは待ち受けが止まったり接続が切れたりしうるが、配る相手がいないので困らない。画面がつなぐと全注文・オーダーストップ・レジの状態を受け取り、待ち受けも 30 秒通知が無ければ接続を確かめ、切れていれば張り直して全部を配り直す。常時割り当てに変えるなら、この前提ごと見直すこと

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
残り続ける。公開したままにしたくない場合は `wrangler.jsonc` の `preview_urls` を
`false` にして、プレビュー URL の配信自体を止めること。

### 必要な設定

| キー | 種別 | 使う workflow |
|--|--|--|
| `WORKERS_CLOUDFLARE_API_TOKEN` | Secrets | `pos-deploy-workers` |
| `WORKERS_CLOUDFLARE_ACCOUNT_ID` | Variables | 同上（アカウント ID は秘密情報ではない） |
| `WORKERS_AUTO_DEPLOY_IF_NOT_EXIST` | Variables | 同上（任意。`true` のときだけ上記のフォールバックが働く） |
| `WEBHOOK_URL` | Secrets | `pos-deploy-workers`（既存の `pos-deploy-*` と共用） |
| `VITE_API_BASE_URL` | Variables | `pos-deploy-workers` |
| `VITE_API_BASE_URL_PREVIEW` | Variables | 任意。PR で backend の URL を引けなかったときのフォールバック |
| `WORKERS_API_ORIGIN` | Variables | `pos-deploy-workers`。本番の Worker が `/api` を中継する先（本番の Cloud Run の URL。LB を置いたら LB の URL）。`VITE_API_BASE_URL` を Worker に向けたのにこれが無いと、デプロイを止める |
| `LB_PROXY_TOKEN` | Secrets | `pos-deploy-workers`。本番の Worker の secret `PROXY_TOKEN` に入れる、LB の Cloud Armor と照らし合わせるトークン（infra の `api_proxy_token` と同じ値）。`WORKERS_API_ORIGIN` があるのにこれが無いと、デプロイを止める |
| `ELEVENLABS_API_KEY` | Secrets | `pos-deploy-workers`。呼び出し画面の音声を作る ElevenLabs の鍵。本番の deploy にもプレビューの versions upload にも、Worker の secret `ELEVENLABS_API_KEY` として入れる（[呼び出しの音声](#呼び出しの音声elevenlabsr2)）。無いと音声は流れず、チャイムだけになる |
| `GCP_API_LB_URL` | Variables | `api-build`。任意。本番のデプロイの後の `/status` の確認を LB を通して行う（infra の `api_lb_url`）。Cloud Run の入口を LB だけにしたら要る |
| `NEON_API_KEY` | Secrets | PR ごとの Neon ブランチ作成・削除。project-scoped キー推奨 |
| `NEON_PROJECT_ID` | Variables | 同上。**未設定なら Neon 連携ごとスキップ** |
| `NEON_PREVIEW_CU` | Variables | 任意。既定 `0.25-1` |

`VITE_*` は静的ファイルに焼き込まれるので**ブラウザから読める**。未設定だと
空文字が焼き込まれる。

POS の Worker の `PROXY_TOKEN` は `wrangler secret put` で置かず、GitHub の `LB_PROXY_TOKEN` から
本番のデプロイのたびに `wrangler deploy --secrets-file` で入れ直す。Worker に置いておくだけだと、
PR のプレビューの `versions upload` の直後の deploy で消えたことがある。トークンを変えるときは
`LB_PROXY_TOKEN` を変えて「pos / deploy (Workers)」を手動実行する（infra の `api_proxy_token` も揃えること）。

GCP 側（`api-build`）は Terraform を既定値のまま apply していれば追加設定は不要。
値を変えたときだけ `GCP_WORKLOAD_IDENTITY_PROVIDER` / `GCP_SERVICE_ACCOUNT` /
`GCP_PROJECT_ID` / `GCP_REGION` / `GCP_AR_CONTAINER_REPOSITORY` / `GCP_CLOUD_RUN_SERVICE` /
`GCP_CLOUD_RUN_PREVIEW_SERVICE` を Variables で上書きする。
