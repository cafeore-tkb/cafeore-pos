# Data Model: 提供時間モデル（stack モデル）の当日当てはめタブ

ここで定義するのは、すべて**ブラウザのメモリ上の派生データ**である。DB のテーブル、Go のモデル、API の型は足さず、変えもしない（`api/`・`openapi/`・`modules/common/` は無変更）。入力は `useOrdersWSContext().allOrders`（`OrderEntity[]`）だけである。

時刻はすべて epoch ミリ秒（`number`）、時間の長さは分（`number`）、営業日は JST の `YYYY-MM-DD`（`jstDate`）で表す。

関数のシグネチャは [contracts/stack-model-module.md](./contracts/stack-model-module.md) にある。

---

## 1. StackOrder（注文の写し）

`OrderEntity` から当てはめに要る列だけを写したもの。指名（`menus[].assignee`）とコメント（`comments`）は**写さない**（FR-018）。

| フィールド | 型 | 出どころ | 説明 |
|---|---|---|---|
| `id` | `string` | `order.id ?? String(order.orderId)` | 重複除去のキー（既存の `liveAnalysisOrders` と同じ） |
| `number` | `number` | `order.orderId` | 注文番号（散布図の点を選んだときの表示用） |
| `created` | `number` | `order.createdAt` | 受付時刻 |
| `ready` | `number \| null` | `order.readyAt` | 注文単位の提供可能の時刻（全カップがそろった時刻）。無ければ `null` |
| `cancelled` | `number \| null` | `order.cancelledAt` | 取消の時刻。無ければ `null` |
| `drinkCups` | `number` | `order.getDrinkCups().length` | 作るカップの数（グッズを除き、セットは構成品で数える）。レジの `currentStack()` と同じ数え方 |
| `day` | `string` | `jstDate(created)` | 営業日（JST） |

**検証**: `created` が有限でない注文は捨てる。`ready`・`cancelled` が有限でなければ `null` として扱う（既存の `time()` と同じ）。同じ `id` が複数あれば、後のものを使う。

## 2. StackObservation（当てはめ用の注文観測。spec の Key Entities「当てはめ用の注文観測」）

1 注文 1 行。選択日の `StackOrder` から作る。

| フィールド | 型 | 説明 |
|---|---|---|
| `id`・`number`・`created`・`ready`・`cancelled`・`drinkCups` | StackOrder と同じ | |
| `stack` | `number` | 受付の瞬間の stack（杯）。research.md R3 の条件で、同じ営業日の先行注文のドリンク杯数を足したもの。時点に依らない |
| `brokenTime` | `boolean` | `ready !== null && ready < created`（壊れた記録） |

**時点 as_of での状態**（`classify(observation, window, asOf)` で決まる。保存はしない）:

```text
  受付 < window.start                     → 期間外（stack には数える。当てはめ・件数には入れない）
  cancelled !== null && cancelled < asOf  → cancelled（取消）
  brokenTime                              → broken（壊れた記録。除外して数える）
  ready !== null && ready < asOf          → fitted（当てはめ対象。serviceMinutes = (ready − created) / 60000）
  それ以外                                → pending（未完了）
```

状態の遷移（時点が進むとき。打刻の取り消しが無い前提）:

```text
pending ──(ready が付く)──▶ fitted
pending ──(取消)──────────▶ cancelled
fitted  ──(取消)──────────▶ cancelled   ※提供可能のあとに取消された注文は、その時点以降は当てはめから外れる
fitted  ──(提供可能の取り消し: readyAt が null に戻る)──▶ pending   ※配信で届けば次の再計算に反映される
```

## 3. StackFit（当てはめ結果。spec の Key Entities「当てはめ結果」）

成功と不能の判別共用体。不能のときは係数を**持たない**（SC-006: 誤った数値を出さない）。

```text
StackFit =
  | { ok: true,  a1, b1, c1, nStaff: 6, b, nObs, iterations, start, stackMin, stackMax }
  | { ok: false, reason: "insufficient", nObs, needed: 20 }
  | { ok: false, reason: "no-convergence", nObs }
```

| フィールド | 型 | 説明 |
|---|---|---|
| `a1` | `number` | 平坦部のしきい値（杯）。「待ちが伸び始める杯数」 |
| `b1` | `number` | 傾きの定数部分（分/杯）。負になりうる |
| `c1` | `number` | 最低提供時間（分）。「空いているときの提供時間」 |
| `nStaff` | `6` | 抽出担当の人数。固定（FR-007） |
| `b` | `number` | 実効傾き `b1 + c1 / nStaff`（分/杯）。「1 杯増えるごとに延びる時間」 |
| `nObs` | `number` | 当てはめに使った件数（fitted の数） |
| `iterations` | `number` | 収束までの反復の回数（確認用。画面の折り畳みに出す） |
| `start` | `{a1,b1,c1}` | 収束した初期値の候補 |
| `stackMin`・`stackMax` | `number` | 当てはめに使った観測の stack の範囲（警告と外挿の判定に使う） |
| `needed` | `20` | 当てはめに要る件数（「あと needed − nObs 件」の表示に使う） |

**検証規則**:

- `nObs < 20` なら `insufficient` とする。当てはめを試さない。
- どの初期値でも、次のどれかになれば `no-convergence` とする。
  - 勾配が特異（QR の階数 < 3）
  - step factor が 1/1024 を下回る
  - 50 回の反復を超える
  - 係数が有限でない

## 4. FixedModel（固定モデル）

`readyTimeEstimate.ts` の `STACK_MODEL`（export を足すだけ）をそのまま参照する。写さない。

| フィールド | 値 | 説明 |
|---|---|---|
| `a1` | 7.2829 | 雙峰祭2025 の当てはめ |
| `b1` | −0.55405 | |
| `c1` | 5.98696 | |
| `nStaff` | 6 | |
| `b`（派生） | `b1 + c1 / 6` ≈ 0.4438 | 画面で計算して表示する |

予測は必ず `predictReadyMinutes(stack)` を通す（レジの表示と一致させる）。本機能から値を変える操作は無い。

## 5. NowState（いまの状況。FR-009）

| フィールド | 型 | 説明 |
|---|---|---|
| `asOf` | `number` | 時点（`cutoff = min(window.end, now)`） |
| `live` | `boolean` | `window.end > now`。真なら「いま」、偽なら「期間末（HH:MM）時点」と表示する |
| `stack` | `number` | 時点の stack。選択日に受け付け、時点で取消されておらず、ready が無いか `ready ≥ asOf` の注文のドリンク杯数の合計。期間の開始前の注文も含む |
| `pendingOrders` | `number` | 上の注文の件数 |
| `oldestWaitMinutes` | `number \| null` | 上の注文のうち、いちばん古いものの経過時間（分）。無ければ `null` |
| `predictedFit` | `number \| null` | 当てはめたモデルでの予測（分）。不能なら `null` |
| `predictedFixed` | `number` | 固定モデルでの予測（分） |
| `extrapolated` | `boolean` | 当てはめが成功していて、`stack > stackMax` |
| `otherDayPending` | `number` | 選択日より前に受け付け、取消されておらず ready が無い注文の件数 |

## 6. FitCounts（件数。FR-008）

| フィールド | 説明 |
|---|---|
| `fitted` | 当てはめ対象の件数（= `StackFit.nObs`） |
| `pending` | 期間内に受け付けた未完了の件数 |
| `cancelled` | 期間内に受け付け、時点までに取消された件数 |
| `broken` | 期間内に受け付けた壊れた記録の件数 |
| `latestTimestamp` | 期間の観測で見えているいちばん遅い打刻（受付・提供可能・取消のうち `< asOf` のもの）。「当てはめの時点（最後にデータを反映した時刻）」として表示する。無ければ `null` |

## 7. ScatterPoint（散布図の点。FR-011）

fitted の観測 1 件につき 1 点。

| フィールド | 説明 |
|---|---|
| `number` | 注文番号 |
| `stack` | 横軸（杯） |
| `minutes` | 縦軸。実測の提供時間（分） |
| `predictedFit` | 当てはめの予測（分）。不能なら `null` |
| `predictedFixed` | 固定モデルの予測（分） |
| `clipped` | 縦軸の表示範囲を超えるか。超える点は描かず、件数だけを出す |

曲線は別の配列（`{ stack, fit: number|null, fixed: number }[]`、0〜max(stackMax, いまの stack) を 0.5 杯刻み）で持つ。

## 8. AccuracyRow（精度の要約。FR-012。spec の Key Entities「精度の要約」）

fitted の観測について、予測のしかたごとに 1 行ずつ作る。

| フィールド | 説明 |
|---|---|
| `method` | `"fit"`（この当てはめ）／ `"fixed"`（固定モデル）／ `"mean"`（stack を使わず一律に平均） |
| `n` | 件数 |
| `meanResidual` | 平均残差（実測 − 予測、分）。正なら予測より遅い |
| `mae` | 平均絶対誤差（分） |
| `medianAbsError` | 絶対誤差の中央値（分。type 7 の分位点） |

`"fit"` の行は、当てはめが不能なら値をすべて `null` にし、画面には「当てはめ不能」と出す。`"mean"` の予測値は、fitted の実測の平均（標本内）とする（R の `baseline` と同じ）。

## 9. StackBin（stack の区間表。FR-013）

当てはめに使った観測を、stack の幅 2 杯で区切る（`lo = floor(stack / 2) × 2`。R の `stack_bins()` と同じ）。観測がある区間だけを、`lo` の昇順に並べる。

| フィールド | 説明 |
|---|---|
| `lo`・`hi` | 区間の杯数（`hi = lo + 1`）。表示は「lo〜hi 杯」 |
| `n` | 件数 |
| `p10`・`median`・`p90` | 実測の提供時間の 10%・50%・90% 点（分。type 7） |
| `predictedFit` | 区間の中央（`lo + 0.5`）での当てはめの予測（分）。不能なら `null` |
| `predictedFixed` | 区間の中央での固定モデルの予測（分） |

## 10. TrendPoint（係数の推移点。FR-014。spec の Key Entities「係数の推移点」）

| フィールド | 説明 |
|---|---|
| `asOf` | 区切りの終わりの時刻（最後が途中なら `cutoff`） |
| `partial` | 区切りの途中の点か（最後の 1 点だけが真になりうる） |
| `nObs` | その時点で当てはめに使えた件数 |
| `a1`・`c1`・`b` | その時点の当てはめの係数。不能なら `null`（0 や直前の値で埋めない） |
| `reason` | 不能の理由（`"insufficient"`／`"no-convergence"`）。成功なら `null` |

**不変条件**: 最後の点の `asOf` は `cutoff` と等しい。観測も係数の欄と同じなので、値が一致する（User Story 3 の Independent Test）。

## 11. StackWarning（警告。FR-015）

```text
StackWarning =
  | { kind: "a1-out-of-range", a1, stackMin, stackMax }
  | { kind: "non-positive-slope", b }
  | { kind: "extrapolation", stack, stackMax }
  | { kind: "other-day-pending", count }
```

警告の文言は固定で、データには持たない。文言は [contracts/dashboard-tab-ui.md](./contracts/dashboard-tab-ui.md) にある。

## 12. StackModelView（ページ全体の計算結果）

`stackModelView()` が返すもの。`StackModelSection` はこれを描画するだけにする。

```text
StackModelView = {
  asOf, live,
  fit: StackFit,
  fixed: typeof STACK_MODEL,
  counts: FitCounts,
  now: NowState,
  points: ScatterPoint[], curve: {stack, fit, fixed}[], yMax, clippedCount,
  accuracy: AccuracyRow[3],
  bins: StackBin[],
  warnings: StackWarning[],
}
```

推移（`TrendPoint[]`）は再計算の単位が違う（research.md R9）ので、別の関数 `stackModelTrend()` が返す。
