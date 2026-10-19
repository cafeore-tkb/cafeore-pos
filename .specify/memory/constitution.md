<!--
Sync Impact Report
- Version change: (未記入テンプレート) → 1.0.0
- Modified principles: なし（初回の制定。旧タイトルは [PRINCIPLE_n_NAME] のプレースホルダーのみ）
- Added sections: Core Principles（I〜VI）、技術・運用上の制約、開発ワークフローと品質ゲート、Governance
- Removed sections: なし
- Follow-up TODOs:
  - RATIFICATION_DATE は初回制定日（spec-kit 初期化日）を採用。それ以前に別の合意があれば修正すること
  - 旧 README（services/pos/README.md）は bun 前提で古い。正本はルート README（pnpm）。本憲法は触れない
-->

# cafeore POS Constitution

## Core Principles

### I. DB スキーマの正本は Go モデルだけ

テーブル・列・制約の定義は `api/internal/models` の Go モデルにだけ書く。

- SQL マイグレーションを書いてはならない（MUST NOT）。本番 DB を手で触ってはならない（MUST NOT）
- 新しいモデルは `models.All()` に登録しなければならない（MUST）
- 反映は起動時の `AutoMigrate` に任せる。列の削除・名前の変更は `AutoMigrate` が行わないため、
  必要になったときはその変更だけ別途相談する（MUST）
- 行ごとに違う既定値が要る列は、`api/cmd/server/migrate.go` の backfill のように、
  列がまだ無いときだけ同じトランザクションで 1 回入れる（MUST）

理由: 本番・プレビュー・ローカルが同じ経路でスキーマを得ることで、手作業による食い違い
（`/status` の `schema_drift`）を防ぐ。デプロイ CI は `schema_drift` が空でなければ落ちる。

### II. API の契約は OpenAPI を正本とする

`openapi/openapi.yaml` が API の契約であり、フロントエンドの型（`modules/common/types/api.ts`）は
そこから生成する。

- エンドポイントの追加・変更は OpenAPI の更新と同じ変更に含める（MUST）
- 生成物は手で書き換えてはならない（MUST NOT）。`pnpm generate:ts` で作り直す
- OpenAPI の検証（`pnpm validate:api`）が通らない変更はマージしてはならない（MUST NOT）

理由: Go の API と TypeScript の POS が別々に進んでも、契約のずれを型検査で捕まえるため。

### III. 認証・認可の境界を勝手に広げない

API の保護は Cloudflare Access の JWT と、メールの許可リスト（スタッフ／閲覧のみ）で成り立っている。

- `/api` のグループ全体に掛かる「GET は表示用以上、それ以外はスタッフ」を迂回するルートを足してはならない（MUST NOT）
- Access を通らない呼び出し元（Cloud Scheduler、Square の Webhook、`/status`・`/health`）は
  `/api` グループの外に置き、自前の検証（ID トークン、署名）を必ず実装する（MUST）
- 認証の挙動を変える変更（`AUTH_MODE` の切り替えや許可リストの扱い）は、止まるものと手順を README に書く（MUST）
- 秘密情報（トークン、署名鍵、API キー）をリポジトリに置いてはならない（MUST NOT）。このリポジトリは public である

理由: URL は画面の JS に含まれ秘密ではない。書き込みを守るのはサーバー側の検証だけである。

### IV. 状態の変更は全インスタンスの画面へ届ける

Cloud Run は複数インスタンスで動き、画面は WebSocket でつながっている。

- 注文・オーダーストップ・レジの状態・CaOS の担当者など配信の対象を書き換えるときは、
  自分の画面へ配ったあとに `pg_notify` で他のインスタンスへ知らせる（MUST）。DB のトリガーで代用してはならない（MUST NOT）
- 通知を待ち受ける接続はプーラーを通さない（`DATABASE_LISTEN_URL`）。通知のチャンネルを足したら
  README の表にも足す（MUST）
- API を通さずに SQL で書き換えてはならない（MUST NOT）。配信されず画面が古いままになる

理由: 店頭では複数の端末（レジ・提供・呼び出し画面）が同じ注文を見る。取りこぼしは接客の事故になる。

### V. 本物の DB でテストし、スキップを許さない

- DB を使うテストは `api/internal/testdb`（`testdb.New` / `testdb.NewDatabase`）を使い、
  接続先は `TEST_DATABASE_URL` の 1 つだけにする。別の環境変数を作ってはならない（MUST NOT）
- 渡された DB の既存データには触れず、使い捨ての schema／database を作って終わったら消す（MUST）
- `TEST_DATABASE_URL` が無いとき、手元ではスキップしてよいが CI では失敗させる（MUST）
- 振る舞いを変える変更は、同じ変更にテストを含める。単体テストで足りるロジック（計算・状態遷移）は
  DB を使わないテストにする（SHOULD）

理由: AutoMigrate・LISTEN/NOTIFY・トランザクションの挙動はモックでは確かめられない。

### VI. 本番に触れずに確かめ、すぐ戻せる

- PR は本番に触れてはならない（MUST NOT）。プレビューは `preview` ラベルが付いた PR にだけ出し、
  backend は本番と別のサービス・別の Neon ブランチ・PR ごとのリビジョンタグにする（MUST）
- デプロイ系の workflow は `pull_request` で動かし、`pull_request_target` で PR のコードを実行してはならない（MUST NOT）
  （後片付けの `pr-cleanup` のように PR のコードを checkout しないものに限る）
- デプロイが反映されたか画面と API の食い違いを確かめられるよう、ビルド番号（PR・コミット）を
  画面と API の両方に出し続ける（MUST）
- 外部サービス（ElevenLabs、Square、Slack など）の障害でデプロイや主要な業務フロー
  （注文・会計・提供）を止めてはならない（MUST NOT）。失敗は握りつぶさずログと通知で見えるようにする

理由: 営業中の店で動くシステムであり、実験は本番と隔離された環境でしかできない。

## 技術・運用上の制約

- 構成: `api`（Go）、`services/pos`（React Router の SPA。`ssr: false`。Cloudflare Workers で配信）、
  `modules/common`（共有コード）、`openapi`。パッケージ管理は pnpm（ワークスペース）
- 配備先: backend は Artifact Registry → Cloud Run、画面は Cloudflare Workers、DB は PostgreSQL
  （本番）／Neon（プレビュー）。インフラ定義は別リポジトリ（infra）にあり、このリポジトリでは変えない
- 設定の追加: 環境変数を足したら、README の「backend の環境変数」の表にローカル・プレビュー・本番の値を書く（MUST）
- リポジトリの権限: 信頼の境界は「write 権限」である。外部の人には write を渡さず、
  コントリビュートは fork からの PR に統一する。`main` は直 push を禁止し PR 経由にする
- ドキュメントの言語: README と運用手順は日本語で書く。コード上の識別子は英語

## 開発ワークフローと品質ゲート

- マージ前に次が通っていること（MUST）: `pnpm run lint`（Biome）、`pnpm pos typecheck`、
  `pnpm common typecheck`、該当する単体テスト、`cd api && go test ./...`
- コミット時に `lint-staged`（Biome の整形）が走る。`--no-verify` で迂回してはならない（MUST NOT）
- 変更は PR 経由で行い、`main` へ直接 push しない。マージされると本番にデプロイされるため、
  レビューでは「本番に出ても営業を止めないか」を確かめる
- 仕様の流れは Spec Kit（`/speckit-specify` → `/speckit-plan` → `/speckit-tasks` → `/speckit-implement`）に従う。
  計画の段階で、本憲法の各原則に反しないか（Constitution Check）を確かめる
- 複雑さを足すとき（新しい外部サービス、新しい配信チャンネル、新しい永続化の仕組みなど）は、
  既存の仕組みで足りない理由を PR に書く（MUST）

## Governance

- 本憲法は、このリポジトリのほかの慣習・ドキュメントより優先する。README と食い違うときは、
  どちらかを直して食い違いをなくす
- **改定の手順**: 憲法の変更は `.specify/memory/constitution.md` を更新する PR で行い、
  変更の理由と、既存の仕様・コードへの影響（あれば移行の手順）を PR に書く。
  リポジトリの write 権限を持つ人のレビューを 1 人以上得てからマージする
- **バージョン**: セマンティックバージョニングに従う
  - MAJOR: 原則の削除、または後方互換のない再定義
  - MINOR: 原則・節の追加、または指針の大幅な拡張
  - PATCH: 文言の明確化、誤字の修正、意味を変えない整理
- **遵守の確認**: すべての PR のレビューで、本憲法に反していないか確かめる。
  反する変更は、先に憲法を改定するか、変更を直す
- 実行時の開発の手引きは [README.md](../../README.md) と各パッケージの README を参照する

**Version**: 1.0.0 | **Ratified**: 2026-10-20 | **Last Amended**: 2026-10-20
