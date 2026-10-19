---

description: "提供時間モデル（stack モデル）の当日当てはめタブの実装タスク"
---

# Tasks: 提供時間モデル（stack モデル）の当日当てはめタブ

**Input**: `/specs/001-stack-model-dashboard/` の設計ドキュメント

**Prerequisites**: plan.md・spec.md・research.md・data-model.md・contracts/・quickstart.md（すべてある）

**Tests**: このプロジェクトは TDD で進める（憲法 VII、plan.md「実装の進め方（TDD）」）。

- 振る舞いを変える実装には、必ずテストのタスクがあり、実装のタスクより前に置いてある。
- テストを書いたら `pnpm pos test:unit` を流し、**期待した理由（アサーションの不一致）で失敗する（red）こと**を確かめてから実装に進む。構文エラー・import の失敗・未定義は red に数えない。そのために、Phase 1 で型とスタブを先に置く。
- 実装は、テストを通す最小のものだけを書く（green）。そのあと、テストが通ったまま整理する（refactor）。
- テストを弱めて通してはならない。期待値の書き換え・アサーションの削除・`skip`／`only`／`todo`・`@ts-ignore`・対象のモック化・閾値の緩和はしない。期待値を直すのは仕様が変わったときだけで、理由をコミットに書く。
- 解析リポジトリの係数との一致テスト（SC-001・13:00 時点）は、実装を見る前に R の値で期待値を固定する。合わないときは実装を R の手順（research.md R2）に合わせて直す。
- テスト名には `[unit]` を含める（`pnpm pos test:unit` は `-t unit` で絞る）。`describe("[unit] …")` の形にする（既存の `readyTimeEstimate.test.ts` と同じ）。
- 画面の部品（`components/organisms/dashboard/stackModel/*`）は、リポジトリに React Testing Library が無く足さないため、quickstart.md §4 の手順で目視確認する（research.md R13）。

**Organization**: タスクはユーザーストーリーごとにまとめてある。各ストーリーは単独で実装・確認できる。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 並行して進めてよい（別のファイルで、未完了のタスクに依存しない）
- **[Story]**: どのユーザーストーリーのタスクか（US1・US2・US3）
- パスはリポジトリのルートからの相対パス

## Path Conventions

- フロントエンドだけの変更。対象は `services/pos/app/` と `documents/analytics/dashboard.md`。
- 計算: `services/pos/app/lib/analytics/stackModelFit.ts`・`stackModel.ts`（隣に `*.test.ts`）
- 画面: `services/pos/app/components/organisms/dashboard/stackModel/*.tsx`・`DashboardWorkspace.tsx`
- **触れないディレクトリ**: `api/`・`openapi/`・`modules/common/`・`.github/`

---

## Phase 1: Setup（基準線の確認・型とスタブ）

**Purpose**: 既存のテストが green であることを確かめ、テストが import できる型とスタブを先に置く（red を「import の失敗」にしないため）

- [X] T001 基準線を確かめる（`services/pos/` の単体テストと、触れないディレクトリ `api/`・`openapi/`・`modules/`・`.github/`）。結果は報告に書く（ファイルは作らない）
  - `pnpm pos test:unit` が全部通る。
  - `git diff --stat main -- api openapi modules .github` が何も出さない。
- [X] T002 `services/pos/app/lib/readyTimeEstimate.ts` の `const STACK_MODEL` を `export const STACK_MODEL` にする
  - 値・`predictReadyMinutes`・`currentStack` のシグネチャと挙動は変えない（挙動を変えないので、テストは足さない）。
  - `pnpm pos test:unit` で既存の `services/pos/app/lib/readyTimeEstimate.test.ts` が通ることを確かめる。
- [X] T003 [P] `services/pos/app/lib/analytics/stackModelFit.ts` を新しく作り、contracts/stack-model-module.md の定数・型・関数のシグネチャを置く
  - 定数は本物の値にする:
    - `STACK_FIT_STARTS = [{ a1: 5, b1: 0.1, c1: 2 }, { a1: 10, b1: 0.1, c1: 2 }, { a1: 15, b1: 0.1, c1: 2 }]`（この順。`readonly`）
    - `STACK_FIT_MIN_OBS = 20`
    - `STACK_FIT_N_STAFF = 6`
  - 型 `StackFit` は data-model.md §3 のとおりの判別共用体にする:
    - `{ ok: true; a1; b1; c1; nStaff: 6; b; nObs; iterations; start: { a1; b1; c1 }; stackMin; stackMax }`
    - `{ ok: false; reason: "insufficient"; nObs; needed: 20 }`
    - `{ ok: false; reason: "no-convergence"; nObs }`
    - 不能の側は係数のフィールドを**持たない**（SC-006）。
  - 関数はスタブにする（中身は Phase 2 で書く）:
    - `stackModelMinutes(stack, a1, b, c1)` は `Number.NaN` を返す。
    - `fitFromStart(points, start, nStaff = STACK_FIT_N_STAFF)`（1 つの初期値だけで Gauss-Newton を回す。T005 で契約に足す）は `{ ok: false, reason: "no-convergence", nObs: points.length }` を返す。
    - `fitStackModel(points, nStaff = STACK_FIT_N_STAFF)` は `{ ok: false, reason: "no-convergence", nObs: points.length }` を返す。
    - `predictWithFit(fit, stack)` は `null` を返す。
  - `pnpm pos typecheck` が通ること。
- [X] T004 [P] `services/pos/app/lib/analytics/stackModel.ts` を新しく作り、data-model.md の型と contracts/stack-model-module.md の関数のシグネチャを置く
  - 型: `StackOrder`（§1）・`StackObservation`（§2）・`FitCounts`（§6）・`NowState`（§5）・`ScatterPoint`（§7）・`AccuracyRow`（§8）・`StackBin`（§9）・`TrendPoint`（§10）・`StackWarning`（§11）・`StackModelView`（§12）。
    - `StackModelView.fixed` の型は `typeof STACK_MODEL`（`readyTimeEstimate.ts` から import する）。
    - `StackModelView.accuracy` の型は `AccuracyRow[]` にする（中身は常に `"fit"`・`"fixed"`・`"mean"` の 3 行）。
  - 関数はスタブにする（中身は各フェーズで書く）:
    - `stackOrders(orders)` は `[]`
    - `stackObservations(orders, day)` は `{ observations: [], otherDays: [] }`
    - `stackModelView(input, window, asOf)` は `fit` を `{ ok: false, reason: "insufficient", nObs: 0, needed: 20 }`、件数を 0、配列を空、数値を 0 または `null` にした値
    - `stackWarnings(fit, nowStack, otherDayPending)`（T005 で契約に足す）は `[]`
    - `trendPointFromFit(fit, asOf, partial)`（T005 で契約に足す）は `{ asOf, partial, nObs: 0, a1: null, c1: null, b: null, reason: null }`
    - `stackModelTrend(input, window, asOf, intervalMinutes)` は `[]`
  - `TimeWindow`・`BucketMinutes` は `services/pos/app/lib/analytics/operations.ts` から import する。
  - `pnpm pos typecheck` が通ること。
- [X] T005 [P] `specs/001-stack-model-dashboard/contracts/stack-model-module.md` に、テストのために公開する 3 つの関数を書き足す
  - `fitFromStart(points, start, nStaff?): StackFit` … 1 つの初期値だけで当てはめる。`fitStackModel` は `STACK_FIT_STARTS` を順にこれへ渡し、最初の `ok: true` を返す。初期値を順に試すことのテスト（T009）の基準に使う。
  - `stackWarnings(fit: StackFit, nowStack: number, otherDayPending: number): StackWarning[]` … 警告の判定（research.md R12）。
  - `trendPointFromFit(fit: StackFit, asOf: number, partial: boolean): TrendPoint` … 当てはめ結果を推移の点に写す。`stackModelTrend` と、画面で途中の最後の点を作るときの両方で使う。

**Checkpoint**: 型とスタブがそろい、typecheck と既存のテストが通る

---

## Phase 2: Foundational（当てはめの計算・stack の計算）

**Purpose**: どのユーザーストーリーも使う 2 つの計算を、テスト → 実装の順に作る。1 つは nls 互換の当てはめ（`stackModelFit.ts`）、もう 1 つは注文の写しと stack（`stackOrders`・`stackObservations`）

**⚠️ CRITICAL**: このフェーズが終わるまで、ユーザーストーリーの作業に入らない

### Tests for Foundational（先に書き、red を確かめる）⚠️

- [X] T006 [P] `services/pos/app/lib/analytics/stackModelFit.test.ts` を新しく作り、`describe("[unit] stackModelMinutes")` と `describe("[unit] predictWithFit")` を書く
  - `stackModelMinutes(3, 5, 0.5, 6)` は 6（stack ≤ a1 なら c1）。
  - `stackModelMinutes(5, 5, 0.5, 6)` は 6（折れ点ちょうど）。
  - `stackModelMinutes(9, 5, 0.5, 6)` は 8（`b × (stack − a1) + c1`）。
  - `stackModelMinutes(9, 5, -0.1, 6)` は 6（b ≤ 0 なら `max` で c1）。
  - `predictWithFit` は、`ok: false` の結果（`insufficient`・`no-convergence` の両方）に `null` を返す。`ok: true` の結果（係数を手で書いたもの）には `stackModelMinutes(stack, a1, b, c1)` と同じ値を返す。
  - `pnpm pos test:unit` で、アサーションの不一致で失敗する（red）ことを確かめる。
- [X] T007 `services/pos/app/lib/analytics/stackModelFit.test.ts` に `describe("[unit] fitStackModel: 既知の係数を復元する")` を書く（T006 と同じファイル）
  - 合成データ: 真の係数を a1 = 6、b1 = −0.5、c1 = 6（b = 0.5）とする。stack = 0, 1, …, 20 を各 3 回、計 63 点とする。`minutes = stackModelMinutes(stack, 6, 0.5, 6) + ((i * 37) % 11 - 5) * 0.1`（i は 0 始まりの通し番号）で、乱数を使わないばらつきを入れる。残差がちょうど 0 のデータは収束と判定できないので使わない（research.md R2 の注意）。
  - 期待値は実装の前に次で固定する:
    - `ok === true`、`nStaff === 6`、`nObs === 63`、`stackMin === 0`、`stackMax === 20`
    - `|a1 − 6| < 0.3`、`|c1 − 6| < 0.3`、`|b − 0.5| < 0.05`
    - `b` は `b1 + c1 / 6` と `toBeCloseTo(…, 12)` で一致する。
    - `a1`・`b1`・`c1`・`b` がすべて `Number.isFinite`。
    - `1 ≤ iterations ≤ 50`
    - `start` は `STACK_FIT_STARTS` のどれかと `toEqual` で一致する。
  - 同じ入力で 2 回呼んだ結果が `toEqual` で一致する（決定的。前回の結果を使わない）。
  - red を確かめる。
- [X] T008 `services/pos/app/lib/analytics/stackModelFit.test.ts` に `describe("[unit] fitStackModel: 当てはめ不能")` を書く（同じファイル）
  - 19 点（T007 のデータの先頭 19 点）: `toEqual({ ok: false, reason: "insufficient", nObs: 19, needed: 20 })`
  - 0 点: `toEqual({ ok: false, reason: "insufficient", nObs: 0, needed: 20 })`
  - 全点が stack 0〜3（どの初期値でも全点が折れ点の左になり、勾配が特異になる。最小値で 21 点以上、ばらつきあり）: `ok === false`、`reason === "no-convergence"`、`nObs` は点の数。
  - 不能の結果は係数を持たない: `"a1" in fit`・`"b" in fit` がともに `false`（SC-006）。
  - red を確かめる（スタブは `no-convergence` を返すので、19 点・0 点のテストが失敗する）。
- [X] T009 `services/pos/app/lib/analytics/stackModelFit.test.ts` に `describe("[unit] fitStackModel: 初期値を順に試す")` を書く（同じファイル）
  - 基準: `STACK_FIT_STARTS` を順に `fitFromStart(points, s)` へ渡し、最初に `ok: true` になったもの。
  - T007 のデータと、折れ点の大きいデータ（真の a1 = 14、b1 = −0.3、c1 = 5、stack 0〜25、T007 と同じ形のばらつき）の 2 つで、次を確かめる:
    - （実装時の変更）真の a1 = 14 は整数の stack にちょうど重なり、最適点が微分できない点に来て nls と同じ手順ではどの初期値でも収束しない（a1 の前後で振動し、step factor が 1/1024 を下回る）。そのため a1 = 14.5 にずらした。あわせて、1 つ目・2 つ目の初期値では収束しないデータ（a1 = 2.5、b1 = −0.3、c1 = 2、stack 0〜20）を足し、1 つ目で失敗したら次を試すことを確かめる。
    - 基準になる初期値が少なくとも 1 つあり、`fit.ok === true` である（スタブのまま空振りで通らないようにする）。
    - `fit.start` が基準の初期値と `toEqual` で一致し、`fit` の係数が `fitFromStart(points, 基準の初期値)` の係数と一致する。
  - red を確かめる。
- [X] T010 [P] `services/pos/app/lib/analytics/stackModel.test.ts` を新しく作り、`describe("[unit] stackOrders")` を書く
  - `OrderEntity` は `services/pos/app/lib/readyTimeEstimate.test.ts` と同じ作り方（`OrderEntity.fromOrder({ ...OrderEntity.createNew({ orderId }).toOrder(), createdAt, readyAt, cancelledAt })` と `MenuEntity.fromMenu`）で作る。`ItemType` は `makes_cup` が真の hot と、偽の others を用意する。
  - 次を確かめる:
    - 写したものが `id`（`order.id ?? String(order.orderId)`）・`number`（`orderId`）・`created`・`ready`・`cancelled`（epoch ミリ秒か `null`）・`drinkCups`・`day`（`jstDate(created)`）を持つ。
    - 写したもののキーが、ちょうどこの 7 つだけである（`Object.keys(...).sort()` で比べる）。指名（`menus[].assignee`）とコメントを写さない（FR-018）。
    - `drinkCups` は `order.getDrinkCups().length` と同じ。hot 1 杯と others を組んだセットは 1、others だけは 0。
    - `createdAt` が有限でない注文は捨てる。`readyAt`・`cancelledAt` が有限でなければ `null` にする。
    - 同じ `id` が複数あれば、後のものを使う。
  - red を確かめる。
- [X] T011 `services/pos/app/lib/analytics/stackModel.test.ts` に `describe("[unit] stackObservations")` を書く（T010 と同じファイル）
  - 入力は `StackOrder` を手で書く。選択日を `"2026-11-07"` とし、時刻は `+09:00` 付きの文字列から `Date.parse` で作る。
  - 次を確かめる（research.md R3、contracts の不変条件 6・7）:
    - 戻り値の `observations` は選択日の注文だけで、受付時刻の昇順に並ぶ。
    - 注文 i の `stack` は、同じ営業日の先行注文 j のうち、`created_j < created_i`、かつ（`ready_j` が `null` か `created_i < ready_j`）、かつ（`cancelled_j` が `null` か `created_i < cancelled_j`）を満たすものの `drinkCups` の合計である。
      - `ready_j === created_i` のとき、j は数えない。
      - j の取消の時刻より後に受け付けた i からは、j を数えない。取消の前に受け付けた i からは数える。
    - グッズのみの注文（`drinkCups = 0`）は、後の注文の stack を増やさない。グッズのみの注文自身も観測に入る。
    - `brokenTime` は `ready !== null && ready < created` のときだけ真である。壊れた記録は、後の注文の stack に入らない。
    - 選択日より前の日の注文は、stack に数えない。そのうち取消されておらず `ready === null` のものだけが `otherDays` に入る。前日の提供済み・取消済みは入らない。
    - 選択日より後の日の注文は、どちらにも入らない。
  - red を確かめる。
- [X] T012 `services/pos/app/lib/analytics/stackModel.test.ts` に `describe("[unit] SC-001: 雙峰祭2025 の当てはめ")` を書く（同じファイル）
  - `import baseline from "./data/baseline-2025.json"` で同梱データを読む。
  - テストの中に `baselineStackOrders(rows)` を書く。行 `[orderId, createdAt, readyAt, servedAt, billing, [[name, type]]]` を `StackOrder` に写す:
    - `id = String(orderId)`、`number = orderId`
    - `created = Date.parse(createdAt)`、`ready = readyAt ? Date.parse(readyAt) : null`、`cancelled = null`
    - `drinkCups` は `type !== "others"` の品目の数（R の `is_service_item()`）
    - `day = jstDate(created)`
  - データにある営業日（2025-11-02・2025-11-03）ごとに `stackObservations` を呼び、`ready !== null && !brokenTime` の観測を `{ stack, minutes: (ready − created) / 60000 }` にして 2 日分をつなぎ、`fitStackModel` に渡す。
  - 期待値は実装の前に R の出力（research.md R7）で固定する:
    - `ok === true`、`nObs === 978`
    - `Number(x.toPrecision(3))` が、a1 = 7.28、b1 = −0.554、c1 = 5.99、b = 0.444 と一致する。
  - red を確かめる。

### Implementation for Foundational

- [X] T013 `services/pos/app/lib/analytics/stackModelFit.ts` に `stackModelMinutes`（`Math.max(b * (stack - a1) + c1, c1)`）と `predictWithFit`（不能なら `null`）を書く → T006 が green
- [X] T014 `services/pos/app/lib/analytics/stackModelFit.ts` に `fitFromStart` を書く（research.md R2 の手順をそのまま実装する）
  - パラメータは θ = (a1, b1, c1)。`b = b1 + c1 / nStaff`。
  - ヤコビアンは解析的に求める:
    - `b × (x − a1) > 0` の点: (∂a1, ∂b1, ∂c1) = (−b, x − a1, (x − a1) / nStaff + 1)
    - それ以外の点: (0, 0, 1)
  - 1 反復の手順:
    1. 残差 r = y − f(θ) と J（n × 3）を作る。
    2. J を Householder の QR 分解にかける。階数が 3 未満なら失敗とする（勾配が特異）。
    3. 相対オフセット `sqrt(Σ(Qᵀr)[1:3]² / Σ(Qᵀr)[4:n]²)` が 1e-5 以下なら収束とする。
    4. 増分 δ は `R δ = (Qᵀr)[1:3]` の後退代入で求める。
    5. step halving: fac は 1 から始め、`SSR(θ + fac·δ) ≤ SSR(θ)` になるまで半分にする。受け入れたら `fac = min(2·fac, 1)`。fac が 1/1024 を下回ったら失敗とする。
    6. 50 回を超えたら失敗とする。
  - 係数が有限でないときも失敗とする。
  - 成功なら `iterations`（収束までの反復の回数）・`start`・`stackMin`・`stackMax` を入れる。
  - 依存パッケージは足さない。
- [X] T015 `services/pos/app/lib/analytics/stackModelFit.ts` に `fitStackModel` を書く → T007〜T009 が green
  - `nObs < 20` なら `{ ok: false, reason: "insufficient", nObs, needed: 20 }` を返す。当てはめは試さない。
  - `STACK_FIT_STARTS` を順に `fitFromStart` に渡し、最初の `ok: true` を返す。
  - どれも失敗なら `{ ok: false, reason: "no-convergence", nObs }` を返す。
  - 前回の結果を初期値に使わない（research.md R9）。
- [X] T016 [P] `services/pos/app/lib/analytics/stackModel.ts` に `stackOrders` を書く（data-model.md §1 の「検証」のとおり）→ T010 が green
  - `assignee`・`comments` を読まない。
  - 重複は `new Map(...)` で後のものを残す（既存の `liveAnalysisOrders` と同じ書き方）。
- [X] T017 `services/pos/app/lib/analytics/stackModel.ts` に `stackObservations` を書く（research.md R3。受付時刻で並べた二重ループでよい）→ T011 が green
- [X] T018 `services/pos/app/lib/analytics/stackModel.test.ts` の T012（SC-001）が green になることを確かめる
  - 合わないときは、期待値を変えずに `stackModelFit.ts` を research.md R2 の手順に合わせて直す。
  - 手順の差の例: 収束の判定の分母、step halving の受け入れ条件、初期値の順。

**Checkpoint**: 当てはめと stack の計算が、2025 年のデータで解析リポジトリと一致する。ここからユーザーストーリーに進める

---

## Phase 3: User Story 1 - 当日データで当て直した係数と現在の状況を見る (Priority: P1) 🎯 MVP

**Goal**: 新しいタブ「提供時間モデル」を足し、選択中の期間の注文で当て直した係数・件数・いまの状況・警告を出す。注文の配信に合わせて自動で当て直す

**Independent Test**:

- 当日の注文が 20 件以上ある状態でタブを開き、係数（a1・b1・c1・N・b）・件数・いまの stack・予測が出ることを見る。
- 別端末で注文を提供可能にしたあと、再読み込みなしで件数と係数が変わることを見る。
- 20 件未満の日では「当てはめ不能（件数不足）：あと k 件で当てはめます」と固定モデルだけが出ることを見る。

### Tests for User Story 1（先に書き、red を確かめる）⚠️

- [X] T019 [US1] `services/pos/app/lib/analytics/stackModel.test.ts` に `describe("[unit] stackModelView: 分類と件数")` を書く
  - 入力は `StackOrder` を手で書き、`stackObservations` を通す。`window` は `{ start, end, now }`（`TimeWindow`）で作る。
  - 時点 asOf での分類を確かめる（data-model.md §2 の `classify`、contracts の不変条件 5）:
    - `created < window.start` の注文は、当てはめにも件数にも入らない。ただし後の注文の stack には数える（FR-002）。
    - `cancelled !== null && cancelled < asOf` は `counts.cancelled`。`cancelled ≥ asOf` は、その時点ではまだ取消されていないとして扱う。
    - 提供可能のあとに `asOf` より前に取消された注文は、当てはめから外れて `cancelled` に数える。
    - `brokenTime` は `counts.broken`。
    - `ready !== null && ready < asOf` は当てはめの対象（`serviceMinutes = (ready − created) / 60000`）。
    - `ready === null` か `ready ≥ asOf` は `counts.pending`。
  - `counts.fitted === fit.nObs` が成り立つ。
  - `counts.latestTimestamp` は、期間の観測にある打刻（受付・提供可能・取消）のうち `< asOf` のものの最大値になる。無ければ `null`。
  - `view.asOf === asOf`。`view.live === (asOf < window.end)`。
  - red を確かめる。
- [X] T020 [US1] `services/pos/app/lib/analytics/stackModel.test.ts` に `describe("[unit] stackModelView: 2025-11-02 13:00 時点の切り詰め")` を書く
  - T012 の `baselineStackOrders` を使う。`stackObservations(orders, "2025-11-02")` を `window = dayWindow("2025-11-02", asOf)`、`asOf = Date.parse("2025-11-02T13:00:00+09:00")` で `stackModelView` に渡す。
  - 期待値は実装の前に R の出力（research.md R7）で固定する:
    - `fit.ok === true`、`fit.nObs === 154`
    - `Number(x.toPrecision(3))` が、a1 = 5.40、b1 = −0.803、c1 = 6.89、b = 0.346 と一致する。
  - red を確かめる。
- [X] T021 [US1] `services/pos/app/lib/analytics/stackModel.test.ts` に `describe("[unit] stackModelView: いまの状況")` を書く（data-model.md §5）
  - `now.stack` は、選択日に受け付け、asOf で取消されておらず、`ready === null` か `ready ≥ asOf` の注文の `drinkCups` の合計である。`window.start` より前の注文も含む。
  - `now.pendingOrders` はその件数である。
  - `now.oldestWaitMinutes` は、そのうちいちばん古い受付からの `(asOf − created) / 60000` である。対象が無ければ `null`。
  - `now.predictedFixed === predictReadyMinutes(now.stack)`（不変条件 4）。
  - `now.predictedFit` は、当てはめが成功なら `predictWithFit(view.fit, now.stack)`、不能なら `null`。
  - `now.extrapolated` は、当てはめが成功していて `now.stack > fit.stackMax` のときだけ真である。
  - `now.otherDayPending === input.otherDays.length`。
  - 19 件しか当てはめ対象が無い入力では、次のようになる（US1 の受け入れシナリオ 3）:
    - `view.fit` が `{ ok: false, reason: "insufficient", nObs: 19, needed: 20 }`
    - `now.predictedFit === null`。`now.predictedFixed` は数値。
  - `view.fixed` は `STACK_MODEL` そのもの（`toBe`）。値を写していない。
  - red を確かめる。
- [X] T022 [US1] `services/pos/app/lib/analytics/stackModel.test.ts` に `describe("[unit] stackWarnings")` を書く（research.md R12、data-model.md §11）
  - `StackFit` を手で書いて渡す。
  - `ok: true` で `a1 < stackMin` または `a1 > stackMax` のとき、`{ kind: "a1-out-of-range", a1, stackMin, stackMax }` を返す。`a1` がちょうど端（`stackMin`・`stackMax`）のときは返さない。
  - `ok: true` で `b ≤ 0` のとき、`{ kind: "non-positive-slope", b }` を返す（`b = 0` を含む）。
  - `ok: true` で `nowStack > stackMax` のとき、`{ kind: "extrapolation", stack: nowStack, stackMax }` を返す。
  - `otherDayPending > 0` のとき、`{ kind: "other-day-pending", count }` を返す。これは当てはめが不能でも返す。
  - `ok: false` のときは、`a1-out-of-range`・`non-positive-slope`・`extrapolation` を返さない。
  - どれにも当たらなければ `[]` を返す。
  - `stackModelView` の `warnings` が `stackWarnings(view.fit, view.now.stack, view.now.otherDayPending)` と一致する（前日の未完了がある入力で 1 つ確かめる）。
  - red を確かめる。

### Implementation for User Story 1

- [X] T023 [US1] `services/pos/app/lib/analytics/stackModel.ts` の `stackModelView` に、時点での分類・`counts`・`fit`・`asOf`・`live`・`fixed` を書く → T019・T020 が green
  - 分類は、内部の関数 `classify(observation, window, asOf)` 1 つにまとめる。推移（US3）でも同じものを使う。
  - `fit` は、当てはめの対象を `{ stack, minutes }` にして `fitStackModel` に渡す。
  - US2 の欄（`points`・`curve`・`accuracy`・`bins`）は空配列、`yMax`・`clippedCount` は 0 のままにする（US2 のテストで red になる）。
- [X] T024 [US1] `services/pos/app/lib/analytics/stackModel.ts` の `stackModelView` に `now`（`NowState`）を書く → T021 が green
  - 固定モデルの予測は、必ず `predictReadyMinutes(stack)` を呼ぶ。係数を写さない（research.md R8）。
- [X] T025 [US1] `services/pos/app/lib/analytics/stackModel.ts` に `stackWarnings` を書き、`stackModelView` の `warnings` に使う → T022 が green
- [X] T026 [P] [US1] `services/pos/app/components/organisms/dashboard/stackModel/StackModelSection.tsx` を新しく作る（ページ本体）
  - props: `{ orders: readonly OrderEntity[]; day: string; window: TimeWindow; cutoff: number; intervalMinutes: BucketMinutes }`
  - メモは plan.md「データの流れ」の ①〜③ にする:
    - ① `useMemo(() => stackOrders(orders), [orders])`
    - ② `useMemo(() => stackObservations(①, day), [①, day])`
    - ③ `useMemo(() => stackModelView(②, window, cutoff), [②, window, cutoff])`
  - 表示は contracts/dashboard-tab-ui.md §2 の 1〜3 の順にする。
  - **係数**:
    - 主役の 3 つは「空いているときの提供時間 c1（分）」「待ちが伸び始める杯数 a1（杯）」「1 杯増えるごとに延びる時間 b（分/杯）」とする。値は `toPrecision(3)` で出し、平易な名前を添える（FR-016）。
    - 補助として、b1 と「N = 6 人（固定）」を出す。
    - それぞれの横に、固定モデル（雙峰祭2025）の値を出す。値は `view.fixed` から取り、b は `fixed.b1 + fixed.c1 / fixed.nStaff`。
  - **件数と時点**:
    - 件数は「当てはめ n 件・未完了 n 件・取消 n 件・除外（時刻の逆転）n 件」とする。
    - 時点は「最後に反映した打刻 HH:MM:SS」とする。`jstClock(counts.latestTimestamp)` を使い、`null` なら出さない。
  - **折り畳み「モデル式と定義」**（`<details>`）に、次を書く:
    - 式 `max(b × (stack − a1) + c1, c1)`・`b = b1 + c1 / N`
    - stack と提供時間の定義
    - 当てはめ方（非線形最小二乗・等重み・外れ値を除外しない・初期値 3 候補・最低 20 件）
    - 反復の回数（`fit.iterations`）
  - **いまの状況**:
    - いまの stack（杯）・未完了の件数・いちばん古い未完了の経過時間（分）
    - 予測 2 つ（当てはめ・固定モデル）
    - 見出しは、`view.live` なら「いまの状況（HH:MM）」、そうでなければ「期間末（HH:MM）時点の状況」とする。
  - **警告**: contracts/dashboard-tab-ui.md §4 の文言をそのまま使う。該当するときだけ出す。常時の注意文は置かない。
  - **当てはめ不能のとき**（contracts §3 の表）:
    - 件数不足: 「当てはめ不能（件数不足）：あと k 件で当てはめます」（k = `needed − nObs`）と固定モデルの値。
    - 収束しない: 「当てはめ不能（収束しない）」。
    - どちらも当てはめの数値は出さない。いまの状況は固定モデルの予測だけにする。
  - 担当者名とコメントを、どこにも出さない（FR-018）。
  - 見た目は既存のダッシュボードの部品（`DashboardWorkspace.tsx` の `SectionHeading` などの class）に合わせる。
- [X] T027 [US1] `services/pos/app/components/organisms/dashboard/DashboardWorkspace.tsx` にページを登録する（contracts/dashboard-tab-ui.md §1）
  - `SECTIONS` の末尾（「25年度比較」の後）に `{ id: "model", name: "提供時間モデル", description: "stack杯数で提供時間を当てはめ", icon: ChartSpline }` を足す。`ChartSpline` は `lucide-react` から import する。
  - 本文の分岐は、`!isOrdersLoaded ? <LoadingState />` より後、最後の `else`（25年度比較）より前に `section === "model" ? (<StackModelSection orders={sourceOrders} day={selectedDate} window={window} cutoff={cutoff} intervalMinutes={intervalMinutes} />)` を足す。
  - `showInterval` の条件に `section === "model"` を足す。
  - 既定のページ（`"sales"`）、ほかのページの分岐と JSX、矢印キーのロジックは変えない。
- [ ] T028 [US1] quickstart.md §4 の #1〜#4・#7・#8 を手元で確かめる（`pnpm pos dev`）
  - #1・#2: ナビの 7 番目にあり、矢印キーで 7 ページを循環する。
  - #3: 件数不足の表示になる。
  - #4: 10 秒以内に自動で更新される（SC-002）。
  - #7: 期間末の見出しになる。
  - #8: 未来の期間で既存のエラーが出る。

**Checkpoint**: User Story 1 だけで、当日の係数といまの状況が読める（MVP）

---

## Phase 4: User Story 2 - 実測とモデル曲線を重ねて当てはまりを確かめる (Priority: P2)

**Goal**: 散布図（実測の点・当てはめた曲線・固定モデルの曲線・折れ点 a1）、精度の要約（3 通り）、stack の区間表を出し、係数の信用の度合いを判断できるようにする

**Independent Test**: 当日の注文が十分ある状態で、次を確かめる。

- 散布図に当てはめた注文の点がすべて描かれ（表示範囲外は件数で示す）、2 本の曲線と a1 が重なる。
- 精度の表に「この当てはめ」「固定モデル」「一律に平均」の 3 行が出る。
- 点を選ぶと、注文番号・stack・実測・予測が出る。

### Tests for User Story 2（先に書き、red を確かめる）⚠️

- [X] T029 [US2] `services/pos/app/lib/analytics/stackModel.test.ts` に `describe("[unit] stackModelView: 散布図")` を書く（data-model.md §7）
  - `points` は当てはめの対象 1 件につき 1 点で、`number`・`stack`・`minutes`（実測）・`predictedFit`（`predictWithFit(fit, stack)`。不能なら `null`）・`predictedFixed`（`predictReadyMinutes(stack)`）を持つ。
  - `curve` は、0 から `max(上限の stack, now.stack)` まで 0.5 杯刻みである。
    - 上限の stack は、当てはめが成功なら `fit.stackMax`、不能なら当てはめの対象の stack の最大（対象が無ければ 0）。
    - 各点の `fit` は `predictWithFit(fit, stack)`（不能なら `null`）、`fixed` は `predictReadyMinutes(stack)`。
  - `yMax` は、次の 2 つの大きい方を 5 分単位に切り上げた値である（research.md R11）。
    - 実測の Q3 + 3 × IQR。分位点は `services/pos/app/lib/analytics/operations.ts` の `quantile`（type 7）で求める。
    - `curve` の最大（`fit` と `fixed`）。
  - `clipped` は `minutes > yMax` のときだけ真で、`clippedCount` はその件数である。
  - 確かめ方: 60 分の外れ値を 1 件含む手書きのデータで `clippedCount === 1`、`yMax % 5 === 0`。
  - 2025-11-02 13:00 時点（T020 と同じ入力）では、`points.length === 154`、かつ全点の `predictedFit` が数値になる。
  - red を確かめる。
- [X] T030 [US2] `services/pos/app/lib/analytics/stackModel.test.ts` に `describe("[unit] stackModelView: 精度の要約")` を書く（data-model.md §8）
  - `accuracy` は `method` が `"fit"`・`"fixed"`・`"mean"` の順の 3 行である。
  - 各行の値:
    - `n` は当てはめの対象の件数。
    - `meanResidual` は（実測 − 予測）の平均。
    - `mae` は |実測 − 予測| の平均。
    - `medianAbsError` は |実測 − 予測| の type 7 の中央値。
  - `"mean"` の予測は、当てはめの対象の実測の平均（標本内）である。
  - 19 件の手書きデータ（当てはめ不能）で次を確かめる:
    - `"fit"` の行は `n` 以外の値がすべて `null`。
    - `"fixed"` と `"mean"` の行は、手で計算した値と `toBeCloseTo` で一致する。
  - 2025-11-02 13:00 時点では、`"fit"` の行の値が `predictWithFit(view.fit, stack)` で計算し直した値と一致する。
  - red を確かめる。
- [X] T031 [US2] `services/pos/app/lib/analytics/stackModel.test.ts` に `describe("[unit] stackModelView: stack の区間表")` を書く（data-model.md §9）
  - 区間は `lo = floor(stack / 2) × 2`、`hi = lo + 1` とする。観測がある区間だけを、`lo` の昇順に並べる。
  - `n`・`p10`・`median`・`p90`（実測の type 7 の分位点）を、手書きのデータで手計算した値と比べる。
  - `predictedFit` は `predictWithFit(fit, lo + 0.5)`（不能なら `null`）、`predictedFixed` は `predictReadyMinutes(lo + 0.5)`。
  - 観測の無い区間（例: stack 4・5 の注文が無い）は行を作らない。
  - red を確かめる。

### Implementation for User Story 2

- [X] T032 [US2] `services/pos/app/lib/analytics/stackModel.ts` の `stackModelView` に `points`・`curve`・`yMax`・`clippedCount` を書く → T029 が green
  - 分位点は `operations.ts` の `quantile` を再利用する。昇順に並べた配列を渡す。
- [X] T033 [US2] `services/pos/app/lib/analytics/stackModel.ts` の `stackModelView` に `accuracy` を書く → T030 が green
- [X] T034 [US2] `services/pos/app/lib/analytics/stackModel.ts` の `stackModelView` に `bins` を書く → T031 が green
- [X] T035 [P] [US2] `services/pos/app/components/organisms/dashboard/stackModel/StackModelScatter.tsx` を新しく作る（research.md R11、contracts/dashboard-tab-ui.md §2.4・§5）
  - props: `{ view: StackModelView }`
  - recharts の `ComposedChart` で描く。
    - 実測は `Scatter`。`clipped` の点は描かない。
    - 当てはめた曲線は実線の `Line`（`dataKey="fit"`）。
    - 固定モデルは破線の `Line`（`strokeDasharray`、`dataKey="fixed"`）。
    - 折れ点は `ReferenceLine x={a1}` にラベル「a1」を付ける。当てはめが成功したときだけ出す。
  - 凡例は「実測（注文）」「この当てはめ（実線）」「固定モデル（破線）」「折れ点 a1」とする。色だけで区別せず、線種と点の形を併用する。
  - 軸は、横軸を「注文時点の stack（杯）」、縦軸を「提供時間（分）」とし、縦軸の `domain` を `[0, view.yMax]` にする。
  - Tooltip は「注文 #番号・stack n 杯・実測 x.x 分・予測 y.y 分（固定 z.z 分）」とする。当てはめが不能なら、予測は固定モデルだけにする。
  - `clippedCount > 0` なら、「表示範囲外に n 件（縦軸 y 分超）。当てはめには含めています。」と出す。
  - すべての系列を `isAnimationActive={false}` にし、`accessibilityLayer` を付ける。
  - 下に `ChartValues`（`./../operations/ChartValues`）を置き、全点の「注文番号・stack・実測・予測（当てはめ）・予測（固定）」を出す。
- [X] T036 [P] [US2] `services/pos/app/components/organisms/dashboard/stackModel/StackModelTables.tsx` を新しく作る（FR-012・FR-013）
  - props: `{ view: StackModelView }`
  - 精度の表:
    - 行は「この当てはめ」「固定モデル」「一律に平均」。
    - 列は「件数」「平均残差（分、実測 − 予測。正なら予測より遅い）」「平均絶対誤差（分）」「絶対誤差の中央値（分）」。
    - `"fit"` の行の値が `null` なら「当てはめ不能」と出す。
  - 区間表:
    - 列は「stack（杯）」（`lo〜hi`）・「件数」・「10%点」・「中央値」・「90%点」・「予測（当てはめ）」・「予測（固定）」。単位は分。
    - 予測（当てはめ）が `null` なら「当てはめ不能」と出す。
- [X] T037 [US2] `services/pos/app/components/organisms/dashboard/stackModel/StackModelSection.tsx` の警告の下に、`StackModelScatter` と `StackModelTables` をこの順で置く（contracts/dashboard-tab-ui.md §2 の 4・5）
- [ ] T038 [US2] quickstart.md §4 の #5（点の Tooltip）・#9（指名とコメントが出ない、すべての軸に単位がある）を手元で確かめる

**Checkpoint**: User Story 1・2 がそれぞれ単独で動く

---

## Phase 5: User Story 3 - 係数の時間推移からオペレーションの変化を読む (Priority: P3)

**Goal**: 選択中の期間を集計間隔（15／30／60 分）で区切り、各区切りの終わりまでのデータで当て直した a1・c1・b を、3 つのグラフで時刻とともに出す

**Independent Test**: 注文が数百件ある過去の営業日を選び、次を確かめる。

- a1・c1・b の推移が、集計間隔ごとの点で出る。
- 最後の点が係数の欄（US1）と一致する。
- 集計間隔を 60 分にすると、点の間隔が 60 分になる。

### Tests for User Story 3（先に書き、red を確かめる）⚠️

- [X] T039 [US3] `services/pos/app/lib/analytics/stackModel.test.ts` に `describe("[unit] trendPointFromFit")` を書く（data-model.md §10）
  - `ok: true` の結果では、`{ asOf, partial, nObs, a1, c1, b, reason: null }` を返す。
  - `ok: false` の結果では、`a1`・`c1`・`b` が `null`、`reason` が `"insufficient"` か `"no-convergence"`、`nObs` は結果の `nObs` になる。0 や直前の値で埋めない。
  - red を確かめる。
- [X] T040 [US3] `services/pos/app/lib/analytics/stackModel.test.ts` に `describe("[unit] stackModelTrend")` を書く（research.md R10、contracts の不変条件 3）
  - 入力は T020 と同じ 2025-11-02 の観測とする。`window = dayWindow("2025-11-02", …)` にする。
  - `asOf = 13:00` で、間隔 60 分のとき:
    - 点の `asOf` は `window.start + k × 60 分`（k = 1〜13）の 13 点である。
    - どれも `partial === false`。
    - 最後の点の係数は、T020 の値（a1 = 5.40、c1 = 6.89、b = 0.346、`nObs` = 154）と有効数字 3 桁で一致する。
  - `asOf = 13:10` で、間隔 15 分のとき:
    - 点の間隔は 15 分である。
    - 最後の点だけが `partial === true` で、その `asOf` は 13:10 である。
    - 最後の点の係数は、`stackModelView(input, window, asOf).fit` と一致する。
  - 各点の値は、その点の `asOf` での `stackModelView(...).fit` を `trendPointFromFit` で写したものと `toEqual` で一致する（後の打刻を使わない）。全点で確かめる。
  - 営業開始前の早い時刻の点（当てはめ対象が 20 件未満）は、`a1 === null`、`reason === "insufficient"` になる。
  - `asOf === window.start` のときは `[]` を返す。
  - red を確かめる。

### Implementation for User Story 3

- [X] T041 [US3] `services/pos/app/lib/analytics/stackModel.ts` に `trendPointFromFit` と `stackModelTrend` を書く → T039・T040 が green
  - 時点は `window.start + k × intervalMinutes × 60000`（k = 1, 2, …）のうち `≤ asOf` のものとする。最後の区切りが途中なら、`asOf` も 1 点加えて `partial: true` にする。
  - 各点の当てはめは、US1 の `classify` と `fitStackModel` を同じように通す。`stackModelView` と同じ観測の絞り込みにして、値が一致するようにする。
- [X] T042 [P] [US3] `services/pos/app/components/organisms/dashboard/stackModel/StackModelTrend.tsx` を新しく作る（research.md R11、contracts/dashboard-tab-ui.md §2.6・§5）
  - props: `{ points: TrendPoint[]; fixed: typeof STACK_MODEL }`
  - a1・c1・b を、3 つの小さな `LineChart` に分けて描く。
    - 縦軸のラベルは「a1（杯）」「c1（分）」「b（分/杯）」、横軸は「時刻（JST）」（`jstClock(asOf).slice(0, 5)`）。
    - `connectNulls={false}` にして、不能の点は線を切る。
    - 固定モデルの値（a1・c1・`b1 + c1 / nStaff`）を、破線の `ReferenceLine` にラベル「固定モデル」を付けて重ねる。
    - `partial` の点は白抜きで描く。
    - `isAnimationActive={false}`、`accessibilityLayer` を付ける。
  - `a1 !== null` の点が 1 つも無ければ、グラフの代わりに「当てはめ可能な時点がまだありません」と出す。
  - 各グラフの下に `ChartValues` を置き、「時刻・件数・値（不能なら理由）」を出す。
- [X] T043 [US3] `services/pos/app/components/organisms/dashboard/stackModel/StackModelSection.tsx` に、推移のメモ ④ を足し、`StackModelTrend` をページの最後に置く（research.md R9）
  - 完了した区切りの終わりは `completedUntil = window.start + Math.floor((cutoff − window.start) / (intervalMinutes × 60000)) × intervalMinutes × 60000` とする。
  - ④ は `useMemo(() => stackModelTrend(②, window, completedUntil, intervalMinutes), [②, window.start, window.end, intervalMinutes, completedUntil])` とする。10 秒ごとの時計の更新では計算し直さない。
  - `cutoff > completedUntil` なら、③ の `view.fit` から `trendPointFromFit(view.fit, cutoff, true)` を作って末尾に足す。
- [ ] T044 [US3] quickstart.md §4 の #6 を手元で確かめる（集計間隔を 15 → 60 分にすると点の間隔が変わり、最後の点が係数の欄と一致する）

**Checkpoint**: すべてのユーザーストーリーが、それぞれ単独で動く

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: ドキュメント・品質ゲート・性能・既存ページへの影響の確認

- [X] T045 [P] `documents/analytics/dashboard.md` を更新する
  - ナビのページ数を 6 → 7 にする。
  - 「提供時間モデル」の節を足す。内容は、目的（係数からオペレーションを読む）、表示の構成（係数・いまの状況・警告・散布図・精度・区間表・推移）、固定モデルとの比較、当てはめ不能の表示、計算はブラウザの中だけで保存しないこと。
- [X] T046 品質ゲートを流す（quickstart.md §3）。全部が通ること
  - `pnpm run lint`
  - `pnpm pos typecheck`
  - `pnpm common typecheck`
  - `pnpm pos test:unit`
  - `cd api && go test ./...`
- [X] T047 テストが実装を確かめていることを 1 度だけ確かめる（plan.md「実装の進め方」）
  - `services/pos/app/lib/analytics/stackModelFit.ts` の step halving の受け入れ条件か、`b = b1 + c1 / nStaff` を一時的に壊す。
  - `pnpm pos test:unit` で、SC-001（T012）と T007 が red になることを見る。
  - 元に戻して green に戻ることを見る。壊した状態は commit しない。
- [ ] T048 SC-003（性能）を確かめる（quickstart.md §4「実データに近い量での確認」）
  - 注文が数百〜1,000 件ある日で、ページの切り替えと表示条件の変更から 2 秒以内に表示されることを、ブラウザの Performance タブで測る。
  - 超えたときは research.md R9 の次の手段（推移のメモの見直し、Web Worker）を検討し、結果をユーザーに報告する。
- [ ] T049 SC-004 と FR-018 を確かめる
  - quickstart.md §4 の #10: ほかの 6 ページの表示と操作が、実装前と変わらない。
  - `grep -nE "assignee|comment" services/pos/app/lib/analytics/stackModel.ts services/pos/app/lib/analytics/stackModelFit.ts services/pos/app/components/organisms/dashboard/stackModel/*.tsx` が何も出さない。
- [X] T050 変更の範囲を確かめる（quickstart.md §1）
  - `git diff --stat main -- api openapi modules .github` が何も出さない。
  - `git diff --stat main` の変更が、`services/pos/app/`・`documents/analytics/dashboard.md`・`specs/` だけに限られる。

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup（Phase 1）**: 依存なし。T003・T004・T005 は並行してよい。T002 は単独。
- **Foundational（Phase 2）**: Setup の完了が前提。**全ストーリーを止める。**
  - `stackModelFit` の系（T006〜T009 → T013〜T015）と、`stackModel` の系（T010〜T011 → T016〜T017）は、別のファイルなので並行してよい。
  - T012（SC-001）と T018 は、両方の系が終わってから green になる。
- **User Story 1（Phase 3）**: Foundational の完了が前提。
- **User Story 2（Phase 4）**: Foundational の完了が前提。
  - 計算（T029〜T034）は US1 の `stackModelView`（T023）の上に積む。
  - 画面（T037）は US1 の `StackModelSection.tsx`（T026）に部品を置く。
- **User Story 3（Phase 5）**: Foundational の完了が前提。
  - 計算（T041）は US1 の `classify`（T023）を再利用する。
  - 画面（T043）は `StackModelSection.tsx`（T026）に置く。
- **Polish（Phase 6）**: 入れたいストーリーが全部終わってから。

### User Story Dependencies

- **US1（P1）**: Foundational の後に始められる。ほかのストーリーに依存しない。
- **US2（P2）**: `stackModel.ts`・`stackModel.test.ts`・`StackModelSection.tsx` を US1 と共有する。そのため、実際には US1 の後に進める。US1 の表示は US2 が無くても成り立つ。
- **US3（P3）**: 同じ理由で、US1 の後に進める。US2 には依存しない（US2 を飛ばして US3 を入れてもよい）。

### Within Each User Story

- テストを書き、**期待した理由で失敗する（red）ことを確かめてから**実装に進む。テストを弱めて通さない。
- 計算（`lib/analytics/`）→ 画面の部品（`stackModel/*.tsx`）→ ページへの組み込み → 手元での確認、の順にする。
- 同じファイル（`stackModel.ts`・`stackModel.test.ts`・`stackModelFit.test.ts`）のタスクは、番号の順に進める。

### Parallel Opportunities

- Phase 1: T003・T004・T005
- Phase 2: `stackModelFit.test.ts`（T006〜T009）と `stackModel.test.ts`（T010〜T011）。実装の T013〜T015 と T016〜T017。
- US1: 画面の T026 は、計算の T023〜T025 と並行してよい（型は T004 で置いてある）。
- US2: 画面の T035・T036 は互いに並行してよい。計算の T032〜T034 とも並行してよい。
- US3: 画面の T042 は、計算の T041 と並行してよい。
- Polish: T045 は、ほかと並行してよい。

---

## Parallel Example: Foundational

```bash
# 2 つのテストファイルを並行して書く（どちらも red を確かめる）
Task: "T006〜T009 stackModelFit.test.ts（stackModelMinutes・復元・不能・初期値の順）"
Task: "T010〜T011 stackModel.test.ts（stackOrders・stackObservations）"

# 2 つの実装の系を並行して進める
Task: "T013〜T015 stackModelFit.ts（Gauss-Newton・fitStackModel）"
Task: "T016〜T017 stackModel.ts（stackOrders・stackObservations）"
```

## Parallel Example: User Story 2

```bash
# 計算（T032〜T034、stackModel.ts）を進めながら、画面の部品を並行して作る
Task: "T035 StackModelScatter.tsx（散布図・2 本の曲線・a1・表示範囲外）"
Task: "T036 StackModelTables.tsx（精度の要約・stack の区間表）"
```

---

## Implementation Strategy

### MVP First（User Story 1 Only）

1. Phase 1（Setup）を終える。
2. Phase 2（Foundational）を終える。SC-001 が green になることが、ここでの関門である。
3. Phase 3（US1）を終える。
4. **止めて確かめる**: quickstart.md §4 の #1〜#4・#7・#8 で、US1 を単独で確かめる。
5. ユーザーに報告する（commit・push・PR は許可を得てから）。

### Incremental Delivery

1. Setup + Foundational → 計算の土台（R と一致）
2. US1 → タブ・係数・いまの状況（MVP）
3. US2 → 散布図・精度・区間表（係数の裏付け）
4. US3 → 係数の推移（オペレーションの変化）
5. Polish → ドキュメント・品質ゲート・性能・既存ページの確認

各ストーリーは、前のストーリーの表示を壊さずに足す。

---

## Notes

- [P] は、別のファイルで、未完了のタスクに依存しないもの。
- [Story] は、タスクとユーザーストーリーの対応を追うためのもの。
- テストは red を確かめてから実装する。red の理由は、アサーションの不一致でなければならない。
- commit・push は、ユーザーの許可を得てから行う。commit するときは、テスト → 実装の順が履歴で追えるようにする。
- `api/`・`openapi/`・`modules/common/`・`.github/` には触れない。
- 避けること: 曖昧なタスク、同じファイルでの衝突、ストーリーの独立を壊す依存。
