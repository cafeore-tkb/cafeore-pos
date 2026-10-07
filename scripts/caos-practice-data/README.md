# CaOS の実データテストのデータ

CaOS（`/master-sheet`）の「実データテスト」で流す過去の祭の注文を、private のリポジトリ
[cafeore-tkb/sohosai-analysis](https://github.com/cafeore-tkb/sohosai-analysis) から取ってきて、POS のビルドに入れるスクリプトです。

- 注文データは public な cafeore-pos のリポジトリには入れません。ビルドのたびに sohosai-analysis から作ります。
- 出力は `services/pos/public/caos-practice/`（`.gitignore` 済み）。`index.json`（年ごとの一覧）と `<年>.json`（その年の注文）で、POS の配信にそのまま入ります。
- **入れる項目は許可したものだけ**です（`normalize.mjs` の `toPracticeOrder`）：注文番号・注文の時刻・準備完了と提供の時刻・合計・請求額と、品物ごとの商品 ID・名前・値段・種類。担当者名・指名（`assignee`）・コメント（`comments`）・お預かりなど、人の名前や文章になりうる項目は写しません（元のデータに項目が足されても入りません）。書き出す前に、許可していない項目が無いかも確かめます。
- 配信したデータは、POS の URL を知っていれば誰でも読めます（名前とコメントは入っていません）。

## 手元で作る

`gh` にログインしていれば（sohosai-analysis を読める人）、そのまま作れます。

```sh
pnpm pos practice-data          # データだけ作る（gh auth token で読む）
pnpm pos build                  # build の最初にも同じものが走る
pnpm pos dev                    # 作ってあれば dev でも「実データテスト」が使える
```

読み方は上から順に、あるものを使います。どれも無い・読めないときは警告だけ出して、データを作らずに終わります（ビルドは止めません。前に作ったデータがあればそのまま残します）。

| 読み方 | 使うとき |
|---|---|
| `SOHOSAI_ANALYSIS_DIR=<clone のパス>` | 手元の clone から読む（GitHub に問い合わせない） |
| `SOHOSAI_ANALYSIS_TOKEN=<トークン>` | sohosai-analysis を読めるトークン（CI ではこれ） |
| `gh auth token` | 手元で gh にログインしているとき（GitHub Actions の中では使わない） |

## CI（`pos-deploy-workers.yml`）

ビルドの手順で、Actions の Secret `SOHOSAI_ANALYSIS_TOKEN` を渡しています。登録するのは **sohosai-analysis を読むだけのトークン**（fine-grained personal access token で、Repository access を `cafeore-tkb/sohosai-analysis` だけ、Permissions を `Contents: Read-only` にしたもの）。
Secret が無い・期限切れのときはデータ無しでビルドされ、画面の「実データテスト」は「データがありません」になります（Actions のログに警告が出ます）。

## 読むデータと、今年からのデータの入れ方

sohosai-analysis の年のフォルダ（`2024/`・`2025/`・…）ごとに、`data/day*.json`（`raw_` の付かない、ダミーを除いたもの）を全部読み、同じ注文（`day12.json` と `day1.json`・`day2.json` のように重なるもの）は 1 件にまとめて、作った順に並べます。空のファイルは飛ばします。

- 2025 年は `2025/data/day12.json`（978 件）と同じものになります（`day1.json` は空、`day2.json` は `day12.json` に入っている）。前に cafeore-pos に置いていた `sohosai-2025-day12.json` は、`2025/data/day12.json` から上の許可した項目（商品 ID を除く）を写したものでした。
- 2024 年は `2024/data/day12.json`（787 件）。
- **今年（2026 年）からのデータ**は、sohosai-analysis に `2026/data/day1.json` などとして置けば、次のビルドから入ります。形は 2 つ読めます：
  - Firestore 版の POS の形（`{ "orders": [{ "orderId", "createdAt", "readyAt", "servedAt", "total", "billingAmount", "items": [{ "id", "name", "price", "type" }] }] }`）
  - cafeore-pos の `GET /api/orders` の応答をそのまま保存したもの（配列か `{ "orders": [...] }`）。品物は注文のカップ（無ければメニューの構成）から、種類は商品の種類（`item_type.name`）から、値段はメニューの値段を杯数で割って作ります
  - どちらでもない形にするときは、`normalize.mjs` に読み方を足してください。

## テスト

```sh
node --test scripts/caos-practice-data/normalize.test.mjs
```
