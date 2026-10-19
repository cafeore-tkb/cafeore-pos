# Implementation Plan: 提供時間モデル（stack モデル）の当日当てはめタブ

**Branch**: `feat/pos-dashboard-stack-model` | **Date**: 2026-10-20 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-stack-model-dashboard/spec.md`

## Summary

ダッシュボード（`/dashboard`）に 7 つ目のページ「提供時間モデル」を足す。このページでは、画面が WebSocket で既に受け取っている注文（`useOrdersWSContext().allOrders`）だけを使い、表示条件の期間の注文で stack モデルを**ブラウザの中で**当て直す。モデル式は `予測提供時間 = max(b × (stack − a1) + c1, c1)`、`b = b1 + c1 / 6` である。表示するのは次の 4 つ。

- 係数といまの状況
- 散布図と精度の要約
- stack の区間ごとの表
- 集計間隔ごとの係数の推移

当てはめは、解析リポジトリ（cafeore_analysis の `R/model_svtime.R`・`R/quickview.R`）の `nls` と同じ手順を TypeScript で書き直す。手順は Gauss-Newton と step halving で、収束の判定は相対オフセット 1e-5 未満とする。初期値は 3 つの候補を順に試し、20 件未満なら当てはめない。2025 年の同梱データで、解析リポジトリの係数（a1 = 7.28、c1 = 5.99、b = 0.444）と有効数字 3 桁で一致することを単体テストで確かめる。

**変更の範囲は `services/pos/app` の中だけ**とする。Go のコード（`api/`）、DB のスキーマ（`api/internal/models`）、OpenAPI（`openapi/`）、共有モジュール（`modules/common/`）には一切触れない。新しいエンドポイント・保存・書き込み・環境変数・依存パッケージも足さない。

## Technical Context

**Language/Version**: TypeScript 5.x（`services/pos`、React 18.3、React Router 7 の SPA。`ssr: false`）

**Primary Dependencies**: 既存のものだけを使う。

- recharts 2.15: 散布図と折れ線
- lucide-react 0.453: ナビのアイコン `ChartSpline`
- `@cafeore/common`: `OrderEntity`・`jstDate`・`jstClock`

数値計算のライブラリは足さず、3 変数の QR 分解を自前で書く（research.md R2）。

**Storage**: N/A。DB・localStorage・サーバーのどこにも保存しない（FR-017）。

**Testing**: vitest 3（`pnpm pos test:unit`。テスト名に `unit` を含める慣習に従う）。DB を使わない純粋関数のテストだけで足りる（憲法 V の SHOULD）。実装は TDD で進める（憲法 VII、下の「実装の進め方」）。

**Target Platform**: ブラウザ（Cloudflare Workers で配信する SPA）。広い画面・狭い画面の両方。

**Project Type**: web アプリケーション（フロントエンドのみの変更）

**Performance Goals**:

- SC-002: 提供可能の打刻から 10 秒以内に表示へ反映する。WebSocket の配信で即時に反映され、時計の更新は既存の 10 秒ごとのまま。
- SC-003: 1,000 件の注文で、ページの切り替えや表示条件の変更から 2 秒以内に表示する。

**Constraints**:

- 既存の 6 ページの表示・操作・既定ページを変えない（SC-004）。
- 当てはめの計算は新しいページを開いているときだけ走らせ、ほかのページの描画コストを増やさない。
- 担当者名（指名）と注文コメントを読まない（FR-018）。
- 固定モデルの係数は `readyTimeEstimate.ts` の 1 か所だけで持つ。

**Scale/Scope**:

- 1 営業日に 500〜1,000 件程度の注文を扱う。
- 推移の時点は最大 96 点（24 時間を 15 分ごとに区切った場合）。
- 新しいファイルは 8 個。既存のファイルの変更は 3 つ（`readyTimeEstimate.ts`、`DashboardWorkspace.tsx`、運用ドキュメント）。

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| 原則 | 判定 | 根拠 |
|---|---|---|
| I. DB スキーマの正本は Go モデルだけ | ✅ 該当なし | モデル・マイグレーション・backfill に触れない。`api/` は無変更 |
| II. API の契約は OpenAPI を正本とする | ✅ 該当なし | エンドポイントを足さない。`openapi/openapi.yaml`・`modules/common/types/api.ts` は無変更 |
| III. 認証・認可の境界を勝手に広げない | ✅ 該当なし | 既存のダッシュボードのルートの中の表示だけ。新しいルート・秘密情報は足さない |
| IV. 状態の変更は全インスタンスの画面へ届ける | ✅ 該当なし | 読み取りだけで状態を書き換えない。既存の `orders` 配信を受け取るだけ |
| V. 本物の DB でテストし、スキップを許さない | ✅ 遵守 | 計算は純粋関数に分けて単体テストにする（DB 不要）。`go test ./...` に影響しない |
| VI. 本番に触れずに確かめ、すぐ戻せる | ✅ 遵守 | デプロイ・workflow に触れない。確認はローカルと `preview` ラベルの PR で行う |
| 技術・運用上の制約（環境変数・インフラ） | ✅ 該当なし | 環境変数を足さない。インフラは変えない |
| VII. テストを先に書き、red → green を確かめる | ✅ 遵守予定 | 「実装の進め方（TDD）」に順序と禁止事項を書き、tasks.md はテスト → 実装の順にする |
| 品質ゲート（lint・typecheck・単体テスト・go test） | ✅ 遵守予定 | quickstart.md の手順で全部を流す |
| 複雑さの追加（外部サービス・配信チャンネル・永続化） | ✅ 該当なし | どれも足さない。非線形最小二乗の自前実装は依存パッケージを足さないための選択（research.md R2） |

**判定: ゲート通過（違反なし）。** Complexity Tracking は空のままとする。

**Phase 1 後の再確認**: data-model.md・contracts/ を書いたあとも、上の判定は変わらない（✅）。追加する型は `services/pos/app/lib/analytics/` に閉じていて、API の型や DB のモデルを参照も生成もしない。

## Project Structure

### Documentation (this feature)

```text
specs/001-stack-model-dashboard/
├── spec.md
├── plan.md                      # このファイル
├── research.md                  # Phase 0
├── data-model.md                # Phase 1
├── quickstart.md                # Phase 1
├── contracts/
│   ├── stack-model-module.md    # 計算モジュールの関数・型の契約（UI との境界）
│   └── dashboard-tab-ui.md      # タブ・表示状態・文言の契約
├── checklists/requirements.md
└── tasks.md                     # Phase 2（/speckit-tasks で作る。ここでは作らない）
```

### Source Code (repository root)

```text
services/pos/app/
├── lib/
│   ├── readyTimeEstimate.ts              # 変更: STACK_MODEL に export を付けるだけ（挙動は変えない）
│   └── analytics/
│       ├── stackModelFit.ts              # 新規: nls 互換の Gauss-Newton、初期値の候補、最小件数、予測
│       ├── stackModelFit.test.ts         # 新規: 収束・不能・R と同じ手順の確認（合成データ）
│       ├── stackModel.ts                 # 新規: 注文 → 観測（stack・提供時間）、時点の切り詰め、
│       │                                 #       いまの状況、精度、区間表、推移、警告
│       └── stackModel.test.ts            # 新規: SC-001（2025 年 978 件）・13:00 時点の検算・端のケース
└── components/organisms/dashboard/
    ├── DashboardWorkspace.tsx            # 変更: SECTIONS に 1 項目、本文の分岐に 1 つ、集計間隔の表示条件に 1 つ
    └── stackModel/
        ├── StackModelSection.tsx         # 新規: ページ本体（係数・いまの状況・警告・式の折り畳み）
        ├── StackModelScatter.tsx         # 新規: stack × 提供時間の散布図と 2 本の曲線、折れ点 a1
        ├── StackModelTables.tsx          # 新規: 精度の要約・stack の区間表
        └── StackModelTrend.tsx           # 新規: a1・c1・b の推移（3 つのグラフ、固定モデルの基準線）

documents/analytics/dashboard.md          # 変更: ページ数（6 → 7）と新しいページの説明を追記
```

**触れないディレクトリ**（このあとの tasks・implement でも守る）:

- `api/`: Go のコード、DB のモデル、マイグレーション、テスト
- `openapi/`
- `modules/common/`: 型生成物を含む
- `.github/`

**Structure Decision**: 既存の分け方に合わせる。

- 純粋な集計は `services/pos/app/lib/analytics/`（`operations.ts` と同じ場所）に置き、隣に `*.test.ts` を置く。
- 画面の部品は `components/organisms/dashboard/` の下に、ページ単位のディレクトリ `stackModel/` を作って置く。既存の `operations/` と同じ並びになる。
- `DashboardWorkspace.tsx` には、ページの登録と分岐だけを足す。既存のページの JSX には手を入れない。

## Design Overview

### データの流れ

```text
useOrdersWSContext().allOrders (OrderEntity[]、取消・過去日を含む。既存の配信)
  │  DashboardWorkspace が既に持っている sourceOrders / window / intervalMinutes / now を props で渡す
  ▼
StackModelSection（section === "model" のときだけ描画される）
  │  useMemo ①  stackOrders(sourceOrders)               … 必要な列だけに写す（指名・コメントは読まない）
  │  useMemo ②  stackObservations(①, 選択日)            … 注文ごとの stack（時点に依らないので 1 回だけ）
  │  useMemo ③  stackModelView(②, window, cutoff)       … 当てはめ・いまの状況・精度・区間表・警告
  │  useMemo ④  stackModelTrend(②, window, interval, 完了した区切りの終わり) … 区切りが進むまで再計算しない
  ▼
StackModelScatter / StackModelTables / StackModelTrend（recharts と表）
```

- 時点（as_of）は `cutoff = min(window.end, now)` とする。営業中は「いま」になり、過去の期間では期間の終わりになる（FR-009）。
- 当てはめは、データ・表示条件・時計が変わるたびに ③ でやり直す（FR-005）。推移のうち完了した区切りは ④ にメモしておき、10 秒ごとの時計の更新では最後の途中の点だけを計算する（research.md R9）。

### 既存ファイルへの変更（最小限）

1. `readyTimeEstimate.ts`: `const STACK_MODEL` を `export const STACK_MODEL` にする。値・関数・レジの挙動は変えない。固定モデルの予測は `predictReadyMinutes` をそのまま呼ぶので、レジの表示と必ず一致する。
2. `DashboardWorkspace.tsx`: 次の 3 つだけを足す。
   - `SECTIONS` の末尾に `{ id: "model", name: "提供時間モデル", description: "stack杯数で提供時間を当てはめ", icon: ChartSpline }` を足す。
   - 本文の分岐に `section === "model"` を足す。
   - `showInterval` の条件に `"model"` を足す。

   既定のページ（`"sales"`）、ほかのページの分岐、矢印キーでの切り替えのロジックは変えない（矢印キーは `SECTIONS.length` を見るので自動で 7 ページを巡回する）。
3. `documents/analytics/dashboard.md`: ナビの種類の数と、新しいページの節を書き足す。

## 実装の進め方（TDD）

憲法 VII に従い、実装計画を立ててからテストを先に書く。red を確かめずに実装へ進まない。

1. **計画**: `/speckit-tasks` で、ユーザーストーリーごとに「テスト → 実装」の順でタスクを並べる。テストのタスクは実装のタスクより前に置く。
2. **red**: 失敗するテストを 1 つ書き、実装前に `pnpm pos test:unit` で実行する。失敗の理由が期待したもの（アサーションの失敗）であることを確かめる。関数の型だけ先に置いてスタブを返し、構文エラーや import 失敗は red に数えない。
3. **green**: テストを通す最小の実装だけを書く。
4. **refactor**: テストが通ったまま整理する。
5. 2〜4 を、小さい単位（`stackModelFit` → `stackModel` → 画面）で繰り返す。

テストを意図せず迂回しないための禁止事項:

- 通すためにテストを弱めない（期待値の書き換え、アサーションの削除、`skip`／`only`／`todo`、`@ts-ignore`、対象のモック化、閾値の緩和）。期待値を直すのは仕様が変わったときだけで、理由をコミットに書く。
- 解析リポジトリの係数（a1 = 7.28、c1 = 5.99、b = 0.444）との一致テストは、実装を見てから期待値を決めない。先に R の値で固定する。
- 完了の前に、テストを一時的に壊して（実装を戻す等）red になることを 1 度確かめてよい。
- コミットはテスト → 実装の順が追えるようにする。

## Phase 0 / Phase 1 の成果物

- [research.md](./research.md): R1〜R13（計算場所・アルゴリズム・stack の数え方・取消と壊れた記録・推移の時点・描画・性能・テスト）
- [data-model.md](./data-model.md): 注文の写し・観測・当てはめ結果・固定モデル・いまの状況・精度・区間・推移点・警告
- [contracts/stack-model-module.md](./contracts/stack-model-module.md): 計算モジュールの公開関数と型
- [contracts/dashboard-tab-ui.md](./contracts/dashboard-tab-ui.md): タブ・表示状態・文言・アクセシビリティの契約
- [quickstart.md](./quickstart.md): 単体テスト・品質ゲート・手元での画面確認・「Go 側に差分が無いこと」の確認

## Complexity Tracking

> 憲法の違反が無いため記入なし。
