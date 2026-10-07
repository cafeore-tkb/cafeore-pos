# cafeore

## Get Started

Run `pnpm i` to install dependencies.

## Commands
|command|description|
|--|--|
|`pnpm i`| Install dependencies|
|`pnpm pos` (`dev`\|`build`\|`preview`\|`typecheck`)| Run commands in `services/pos`|
|~~`pnpm mobile`~~ （停止中）| `services/mobile` 用。再開するときは `package.json` の `//mobile` を `mobile` に戻す|
|`pnpm common` (`typecheck`\|`test:`(`unit`\|`db`)) | Run commands in `modules/common`|

## CI / CD

`.github/workflows` にある workflow。`*-ci` は検査のみ、`api-build` は Artifact
Registry に成果物を置く、`*-deploy-*` はデプロイする。

| workflow | 対象 | 何をするか |
|--|--|--|
| `pos-ci` / `mobile-ci` / `common-ci` / `api-ci` | 各パッケージ | typecheck / lint / unit test（`mobile-ci` は停止中。`api-ci` は Docker イメージのビルドも見る。push はしない） |
| `api-build` | `api` | イメージをビルドして Artifact Registry へ push し、Cloud Run へデプロイ |
| `pos-deploy-workers` | `services/pos` | ビルドして Cloudflare Workers へデプロイ |
| `mobile-deploy-workers` | `services/mobile` | 同上（**停止中**。手動実行のみ） |
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

POS と mobile はどちらも `ssr: false` の SPA。Worker のスクリプトは持たず、
`build/client` を静的アセットとして配信するだけの構成にしている
（`services/*/wrangler.jsonc`）。アセットに無いパスは `index.html` を返す
（`not_found_handling: single-page-application`）。

main への push と手動実行では本番へ `wrangler deploy` する。PR（`preview` ラベル付きのみ）では
`wrangler versions upload` に切り替え、本番のトラフィックは向けずに
プレビュー URL 付きのバージョンだけ作る。

PR ではプレビュー URL を**コメントで貼る**。2回目以降は新しいコメントを足さず、
同じコメントを書き換える（本文に埋めた目印で自分のコメントを探している）。
POS と mobile は目印が別なので、それぞれ1件ずつ独立して更新される。

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
| `cafeore-mobile` | `services/mobile` |

ローカルからは `pnpm pos deploy` / `pnpm mobile deploy` で同じことができる。

### backend（Artifact Registry → Cloud Run）

`api-build` が `api/Dockerfile` からイメージを作り、Artifact Registry へ push する。
main への push と手動実行では、続けて Cloud Run サービス `cafeore-pos-git` を
そのイメージで更新する。**PR では本番に触らず、プレビュー用の別サービス**
（既定 `cafeore-pos-preview`）へデプロイし、その URL を PR にコメントする。

本番と分けているのは、同じサービスにリビジョンタグを足すとトラフィック設定が
「常に最新リビジョン」から「特定リビジョンへの固定」に変わり、main のデプロイが
自動で切り替わらなくなるため。プレビュー用サービスの側では**リビジョンタグを使う**
（PR ごとに URL と `DATABASE_URL` が分かれ、同時に複数の PR が開いても潰し合わない）。
PR を閉じるか `preview` ラベルを外すと `pr-cleanup` がタグを外す。

プレビュー用サービスは**アクセスが無ければゼロまで縮む**ので、PR を放置しても
費用は増えない。

### backend の環境変数

| 変数 | ローカル | プレビュー | 本番 |
| --- | --- | --- | --- |
| `DATABASE_URL` | `api/.env` | CI が Neon の接続文字列を渡す | Secret Manager の `supabase-database-url` |
| `DATABASE_LISTEN_URL` | 未設定（`DATABASE_URL` を使う） | CI が Neon の pooler を通らない接続文字列を渡す | 未設定（`DATABASE_URL` がセッションプーラーなので不要）。トランザクションプーラー（ポート 6543）に変えたら、直接接続かセッションプーラーの接続文字列 |
| `FRONTEND_ORIGINS` | 未設定（`localhost` を許可） | `*` | Workers の URL をカンマ区切り |
| `PORT` | `8080` | Cloud Run が渡す | Cloud Run が渡す |
| `SLACK_WEBHOOK_URL` | 未設定（通知せずログに出す） | 未設定 | Slack Incoming Webhook の URL |
| `INVENTORY_CRON_SECRET` | 任意（`X-Cron-Secret` で手動実行） | 未設定 | 未設定 |
| `INVENTORY_REMIND_INVOKER` / `INVENTORY_REMIND_AUDIENCE` | 未設定 | 未設定 | Cloud Scheduler の SA と ID トークンの audience |
| `POS_BASE_URL` | 任意 | 未設定 | リマインドに載せる POS の URL |

プレビューと本番の値は infra リポジトリの `gcp/cloud_run_preview.tf` と
`gcp/cloud_run.tf` にある。`DATABASE_URL` が未設定だと `initDB` が `log.Fatal` する。

**`FRONTEND_ORIGINS` から漏れた origin はブラウザから API を叩けない。**
フロントのデプロイ先を増やしたら infra 側にも足すこと。

### DB のスキーマ

**スキーマの正本は Go のモデル（`api/internal/models`）だけ。** SQL は書かないし、本番 DB を手で触らない。

- テーブルや列を足すときは、モデルを書き換える。新しいモデルは `models.All()`（`api/internal/models/all.go`）にも足す（`models` を import するパッケージのモデルは `cmd/server` の `schemaModels` に足す）
- API は起動時に `AutoMigrate` でモデルを DB へ反映する（`api/cmd/server/migrate.go`）。本番・プレビュー・ローカルとも同じ
- 本番へはマージして Cloud Run にデプロイされた時点で反映される。失敗すると新しいリビジョンが起動せず、デプロイが落ちてトラフィックは前のリビジョンに残る
- 同時に起動したインスタンスは advisory lock で 1 つずつ走る。反映は 1 トランザクションなので、途中で失敗しても半端なスキーマは残らない
- 起動時に DB とモデルを比べ、DB にだけあるテーブル・列・トリガー・関数（手で触った跡）を `/status` の `schema_drift` に出す。デプロイの CI（`api-build.yml`）は空でなければ落ちる。CaOS（`caos` スキーマ）のものは今は対象外

`AutoMigrate` は足すのが基本で、**列の削除や名前の変更はしない**。モデルから消した列は DB に残る。
それが必要になったら、その変更だけ別途やり方を相談すること。

### 注文の変更の配信（orders_changed）

Cloud Run のインスタンスは、それぞれ自分につないでいる画面にしか WebSocket で配れない。ほかのインスタンスで変わった注文も届くよう、DB の通知（`LISTEN` / `NOTIFY`）でインスタンス同士が知らせ合う（`internal/handlers/order_listener.go`）。

- 注文を書き換えたインスタンスは、自分の画面へ配ったあと `pg_notify('orders_changed', '<インスタンス ID> <注文 ID>')` を送る。DB のトリガーは使わない
- ほかのインスタンスはそれを受けて注文を読み直し、自分の画面へ配る（通知は送り返さない）。自分が送った通知は無視する
- API を通さない書き換え（SQL で直接直すなど）は配られない。本番 DB は手で触らない
- 待ち受けを始めたとき（つなぎ直したときを含む）は、取りこぼしに備えて全注文を配り直す
- LISTEN は接続を保ったまま待つので、Supabase のトランザクションプーラー（ポート 6543）や Neon の pooler では通知が届かない（エラーにもならない）。`DATABASE_URL` がそれなら、`DATABASE_LISTEN_URL` に直接接続かセッションプーラーの接続文字列を入れる
- 待ち受けを始めたら自分宛てに確認の通知を送り、10 秒で届かなければ `WARNING: orders_changed の確認の通知が…` をログに出す。届けば `orders_changed: notifications are delivered`
- 通知の受信と配信は別の goroutine。注文の読み直しが遅くても受信は止まらず、配り終わる前に同じ注文の通知が重なれば 1 回の読み直しにまとめる
- 本番の Cloud Run は CPU をリクエストの処理中だけ割り当てる（`infra` の `cpu_idle = true`。`--no-cpu-throttling` にはしていない）。画面が WebSocket でつないでいる間はリクエストの処理中なので、そのインスタンスは通知を受けて配れる。画面がつないでいないインスタンスは待ち受けが止まったり接続が切れたりしうるが、配る相手がいないので困らない。画面がつなぐと全注文を受け取り、待ち受けも 30 秒通知が無ければ接続を確かめ、切れていれば張り直して全注文を配り直す。常時割り当てに変えるなら、この前提ごと見直すこと

### CaOS（ドリップ管制）の盤面

CaOS の抽出カード（1 回のドリップ＝1 枚）と列の担当者、割当・次へ・統合・入れ直し・交代・1つ戻すのルールは `internal/caos` にある。既存の注文の仕組みをできるだけ使い、新しく足したのは次のものだけ。

- **表：** `caos_drips`（カード）と `caos_lanes`（列＝ドリッパー 1〜6 の担当者。営業日と列ごとに 1 行で、名前と上級生か。一度も替えていない列は行が無い）と `caos_ops`（操作の記録。「1つ戻す」に使う）。ほかの表と同じく、正本は Go のモデル（`caos.DripRow`・`caos.LaneRow`・`caos.OpRow`。制約もタグに書く）で、起動時の AutoMigrate で作る（`cmd/server` の `schemaModels`。`caos` は `models` を使うので `models.All()` には入れられず、そこで足している）。カードには注文と商品の参照・指名（明細の `dripper`。ドリッパーの番号）・杯数・担当・状態・開始と終了の時刻だけを持ち、注文番号や商品名は持たない（画面は既存の `{"type":"orders"}`・`{"type":"order"}` の注文から引く）。作るもの（品物と杯数）は注文のカップ（`order_cups`。注文した時点の品物）から読む。カップを持たない以前の注文は、メニューの構成から読む。
- **API：** `POST /api/caos/ops`（今日の盤面への操作。ルールに合わなければ 422）。列の担当者の交代は `{"name":"set_lane","dripper":1,"person":"山田","senior":true}`（`person` が空なら担当者なし）、2 つの列の入れ替えは `{"name":"swap_lanes","dripper":1,"other_dripper":3}`。カードには触らない。上級生か（`senior`）は、画面が交代したときに sohosai-shift の名簿で判定したものをそのまま持つ（名簿を読めない端末でも同じ表示になるように）。
- **配信：** `/api/ws/orders` の `{"type":"drips"}`（今日のカードの全部と、列の担当者 `lanes`（1〜6 の全部））。注文と同じく、カードを変えたインスタンスが自分の画面へ配り、DB の通知 `caos_drips_changed`（送ったインスタンスの ID を載せる）でほかのインスタンスに知らせる。受けたインスタンスは DB から読み直して自分の画面へ配る。つないだときにも届く。
- **保存した中身の互換：** カードの中身（`caos_drips.lines`、`caos_ops` の `before`・`after` の中のカード）は jsonb で、指名は `dripper`（番号）で持つ。指名を文字（`nominee`）で持っていた版（#806 より前の CaOS の PR のプレビュー）のカードは読み替えない（指名が消え、注文とそろえるときに同じ杯のカードが重複してできる）。CaOS の盤面は本番にまだ出ていないので本番の DB にはそうしたカードは無いが、古い版で動かしたことのある DB にこの版を載せるときは、先に `caos_drips` と `caos_ops` を空にする（`TRUNCATE caos_drips, caos_ops;`。列の担当者 `caos_lanes` は残してよい）。

操作（`POST /api/caos/ops`）は、全部を 1 つのトランザクションで行う（途中で失敗したら、カードも注文も操作の記録も全部取り消される）：

1. 今日の盤面をロックし、今日の注文と照らし合わせてカードをそろえる（注文の連動が失敗していても、ここで追いつく）。
2. 操作を行う。「次へ」で注文のカードが全部終わったら、既存の準備完了の処理（`handlers.SetOrderReady`。`PATCH /api/orders/{id}/ready` と同じ切り替えで、まだのカップにも同じ時刻を付ける）で準備完了にする。
3. 操作の記録（`caos_ops`）を残す：操作で変わった・消えたカードの操作の前の中身、変わった・できたカードの操作の後の中身、準備完了にした注文とその `ready_at`、担当者が変わった列の操作の前と後（`lanes_before`・`lanes_after`）。すべてサーバーが DB から取ったもの。

「1つ戻す」は、操作の結果の `op_id` を `{"name":"undo","op_id":...}` で送る。サーバーは記録を使い、次を確かめてから戻す（1 つでも違えば 422 で断り、何も変えない）：記録のあとカードと列の担当者が誰にも触られていない（`updated_at` が記録と同じ）、準備完了にした注文がそのまま（`ready_at` が記録と同じで、提供済みでない）、まだ戻していない。戻すときはカードを操作の前の中身（`updated_at` も含めて）に書き戻し、操作でできたカードを消し、準備完了を外し（その操作で付いたカップだけ外れ、先にカップ単位で付けていたものは残る）、記録に戻した時刻を付ける。手前の操作も続けて戻せる。

既存の API との関係：

- **POS の注文との連動：** 注文の作成・編集・削除・準備完了・提供済み（カップ単位を含む）のハンドラーが、同じトランザクションの中でその注文のカードをそろえる（作る・消す・抽出終了にする。統合相手の注文のカードが全部終わったら、その注文も準備完了にする）。CaOS の処理が失敗しても注文の書き込みは止めない（savepoint まで戻してログに残す。ずれは次に CaOS で操作したときに直る）。
- **編集（PUT）：** カップのある注文の状態はカップから決まるので、古い画面から編集しても CaOS が付けた準備完了は消えない（main の仕組みのまま）。
- **画面への配信：** 準備完了を付け外しした注文（操作の対象と統合相手）は `{"type":"order"}` で 1 件ずつ配る。カードは `{"type":"drips"}` で今日の分を全部配り、30ms 以内の依頼は 1 回にまとめる。
- **ロックの順番：** 1 つの営業日への処理は、その日の advisory lock（`caos:YYYY-MM-DD`）で 1 件ずつ順番に行う。どの処理も「盤面 → 注文」の順にロックする。注文を書き換えるハンドラーは、注文の行を書く前に `lockCaos` で盤面をロックする（逆の順番だと、同じ注文を同時に触ったときにデッドロックになる）。取れなければその回の連動は飛ばす。
- **練習用の盤面（実データテスト）：** `POST /api/caos/practice`（過去の注文と時間帯を送って作る）・`GET`・`DELETE /api/caos/practice/{id}`・`POST /api/caos/practice/{id}/advance`（練習の時計を進め、それまでの注文を入れる）・`POST /api/caos/practice/{id}/ops`（本番と同じ操作）。ルールは本番と同じ `caos.Board` で、盤面は `caos_practices` の 1 行に jsonb で持つ（`caos.PracticeRow`）。本番の `caos_drips`・`caos_lanes`・`caos_ops`・注文・在庫には触らず、`{"type":"drips"}` でも配らない。練習の時計は画面が持ち、操作に練習の時刻（`at`）を付けて送る（カードの開始・終了・準備完了はその時刻）。準備完了と「1つ戻す」は練習の盤面の中で閉じる。放置された練習（最後に触ってから 12 時間）と 200 を超えた古い練習は、練習を作るときに消す。練習の注文は、画面が利用者の選んだ手元の JSON（sohosai-analysis の `YYYY/data/day*.json` など）からブラウザの中で作って送る（担当者名・指名・コメントは送らない。`services/pos/app/caos/README.md` の「実データ・テストプレイ」）。
- **テスト：** `go test ./internal/caos` はルールのテスト（DB なし）。本物の Postgres でも確かめるときは、空の DB を渡して `CAOS_TEST_DATABASE_URL=postgres://... go test -p 1 ./internal/caos ./internal/handlers`（表を作り直すので、本番やプレビューの DB は渡さない）。注文の通知のテストは `LISTEN_TEST_DATABASE_URL` に別の空の DB を渡す。

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
| `WORKERS_CLOUDFLARE_API_TOKEN` | Secrets | `pos-deploy-workers` / `mobile-deploy-workers` |
| `WORKERS_CLOUDFLARE_ACCOUNT_ID` | Variables | 同上（アカウント ID は秘密情報ではない） |
| `WORKERS_AUTO_DEPLOY_IF_NOT_EXIST` | Variables | 同上（任意。`true` のときだけ上記のフォールバックが働く） |
| `WEBHOOK_URL` | Secrets | `pos-deploy-workers`（既存の `pos-deploy-*` と共用） |
| `VITE_API_BASE_URL` | Variables | `pos-deploy-workers` / `mobile-deploy-workers` |
| `VITE_API_BASE_URL_PREVIEW` | Variables | 任意。PR で backend の URL を引けなかったときのフォールバック |
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
