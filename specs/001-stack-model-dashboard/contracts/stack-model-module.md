# Contract: stack モデルの計算モジュール

UI（`components/organisms/dashboard/stackModel/*`）と計算（`lib/analytics/stackModel*.ts`）の境界を定める。計算の側は React・DOM・WebSocket に依存しない純粋関数だけで書き、単体テストの対象にする。型の中身は [data-model.md](../data-model.md) を正とする。

この機能は外部向けのインターフェース（HTTP API・WebSocket のメッセージ・DB）を**足さない**。`openapi/openapi.yaml` と `modules/common/types/api.ts` は変えない。

---

## `services/pos/app/lib/analytics/stackModelFit.ts`

```ts
/** 解析リポジトリの QUICKVIEW_STARTS と同じ順序。最初に収束したものを使う */
export const STACK_FIT_STARTS: readonly { a1: number; b1: number; c1: number }[];
/** これより当てはめに使える観測が少なければ当てはめない（QUICKVIEW_MIN_OBS） */
export const STACK_FIT_MIN_OBS = 20;
/** 抽出担当の人数。2026 年は 6 人で固定（FR-007） */
export const STACK_FIT_N_STAFF = 6;

/** max(b × (stack − a1) + c1, c1)。b は実効傾き */
export function stackModelMinutes(stack: number, a1: number, b: number, c1: number): number;

/**
 * nls（Gauss-Newton、step halving、相対オフセット 1e-5、最大 50 反復、minFactor 1/1024）互換の当てはめ。
 * points は当てはめ対象だけを渡す（未完了・取消・壊れた記録は呼び出し側で除く）。
 * 等重み・外れ値を除外しない。
 */
export function fitStackModel(
  points: readonly { stack: number; minutes: number }[],
  nStaff?: number, // 既定 STACK_FIT_N_STAFF
): StackFit;

/** 当てはめ結果での予測（分）。不能なら null */
export function predictWithFit(fit: StackFit, stack: number): number | null;

/**
 * 1 つの初期値だけで当てはめる（手順は fitStackModel と同じ）。
 * fitStackModel は STACK_FIT_STARTS を順にこれへ渡し、最初の ok: true を返す。
 * 初期値を順に試すことのテストの基準に使うために公開する。
 */
export function fitFromStart(
  points: readonly { stack: number; minutes: number }[],
  start: { a1: number; b1: number; c1: number },
  nStaff?: number, // 既定 STACK_FIT_N_STAFF
): StackFit;
```

**事後条件**:

- `ok: true` なら、`a1`・`b1`・`c1`・`b` はすべて有限である。`b === b1 + c1 / nStaff` が成り立つ。
- `ok: false` の結果は数値の係数を持たない（型で表示を防ぐ。SC-006）。
- 同じ入力には、常に同じ出力を返す（乱数や前回の結果を使わない）。

## `services/pos/app/lib/analytics/stackModel.ts`

```ts
import type { OrderEntity } from "@cafeore/common";
import type { TimeWindow, BucketMinutes } from "./operations";

/** OrderEntity から必要な列だけを写す。指名・コメントは読まない（FR-018） */
export function stackOrders(orders: readonly OrderEntity[]): StackOrder[];

/**
 * 選択日（JST）の注文に、受付時点の stack を付ける。stack は時点に依らない（research.md R3）。
 * 戻り値は受付時刻の昇順。選択日より前の日の未完了の注文は otherDays に入れる（stack には数えない）。
 */
export function stackObservations(
  orders: readonly StackOrder[],
  day: string,
): { observations: StackObservation[]; otherDays: StackOrder[] };

/**
 * 時点 asOf（= min(window.end, now)）でのページ全体の計算結果。
 * 当てはめの対象は window.start ≤ created < asOf、かつ取消されず、created ≤ ready < asOf の注文。
 */
export function stackModelView(
  input: ReturnType<typeof stackObservations>,
  window: TimeWindow,
  asOf: number,
): StackModelView;

/**
 * 集計間隔ごとの区切りの終わり（と途中の最後の点）での当てはめ。
 * completedUntil より前の点は、入力が同じなら同じ結果になる（UI はこれを useMemo のキーにする）。
 */
export function stackModelTrend(
  input: ReturnType<typeof stackObservations>,
  window: TimeWindow,
  asOf: number,
  intervalMinutes: BucketMinutes,
): TrendPoint[];

/** 警告の判定（research.md R12）。当てはめが不能なら other-day-pending だけを返しうる */
export function stackWarnings(
  fit: StackFit,
  nowStack: number,
  otherDayPending: number,
): StackWarning[];

/**
 * 当てはめ結果を推移の点に写す。不能なら a1・c1・b を null にし、reason を入れる。
 * stackModelTrend と、画面で途中の最後の点を作るときの両方で使う。
 */
export function trendPointFromFit(
  fit: StackFit,
  asOf: number,
  partial: boolean,
): TrendPoint;
```

**不変条件（単体テストで確かめる）**:

1. **SC-001**: 2025 年の同梱データ（978 件）で、`fit.a1`・`b1`・`c1`・`b` が 7.28・−0.554・5.99・0.444 と有効数字 3 桁で一致する。
2. **時点の切り詰め**: 2025-11-02 13:00 時点で、154 件の観測から a1 = 5.40・b1 = −0.803・c1 = 6.89 になる。
3. `stackModelTrend(...).at(-1)` の係数は、同じ時点の `stackModelView(...).fit` と一致する。
4. **固定モデル**: `view.now.predictedFixed === predictReadyMinutes(view.now.stack)`。
5. 次の注文は当てはめの観測に入らない。
   - 取消（時点までに取消されたもの）
   - 壊れた記録（`ready < created`）
   - 未完了（ready が無いか、時点以降に ready が付いたもの）
   - 期間の開始前の注文
6. stack に数えないもの:
   - 選択日より前の日の注文
   - 取消の時刻より後に受け付けた注文から見た、その取消済みの注文
7. グッズのみの注文（`drinkCups = 0`）は stack を増やさない。当てはめには使う。

## `services/pos/app/lib/readyTimeEstimate.ts`（既存・最小の変更）

```diff
-const STACK_MODEL = {
+export const STACK_MODEL = {
```

`predictReadyMinutes`・`currentStack` のシグネチャと挙動は変えない。既存のテスト（`readyTimeEstimate.test.ts`）がそのまま通ること。
