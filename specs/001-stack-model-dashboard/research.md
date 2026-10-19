# Research: 提供時間モデル（stack モデル）の当日当てはめタブ

Phase 0 の調査結果。Technical Context に「NEEDS CLARIFICATION」は残っていない。以下は、計画の前提にした判断の記録である。

参照した資料:

- 解析リポジトリ: `cafeore_analysis/R/model_svtime.R`・`R/quickview.R`・`R/metrics.R`・`R/import_pos2026.R`、および `output/tables/stack_quickview_*_params.json`
- POS 側: `services/pos/app/lib/readyTimeEstimate.ts`、`components/organisms/dashboard/DashboardWorkspace.tsx`、`lib/analytics/operations.ts`・`historical.ts`、`modules/common/src/models/order.ts`・`hooks/useOrdersWS.ts`
- サーバー側（読んだだけで、変更しない）: `api/internal/handlers/order.go` の `ordersMessage`。WebSocket の `orders` は全注文（取消・過去日を含む）を配る

---

## R1. 当てはめをどこで計算するか

- **Decision**: ブラウザ（`services/pos` の SPA）の中で、`useOrdersWSContext().allOrders` から計算する。サーバー（Go）・API・DB には何も足さない。
- **Rationale**:
  - ユーザーの指示（Go のコードと DB 側には触らない）と、FR-017（新しい保存・書き込みをしない）に合う。
  - ダッシュボードは既に全注文（取消・過去日を含む）を WebSocket で受け取っており、注文の変化は即座に配信される。そのため SC-002（10 秒以内の反映）を追加の仕組みなしで満たせる。
  - 既存のページ（`operationsReport`）も同じ方式でブラウザで集計している。
- **Alternatives considered**:
  - Go に当てはめの API を足す: 指示に反する。さらに OpenAPI の更新（憲法 II）と配信（憲法 IV）の検討が要る。
  - R のサービスを呼ぶ: 外部サービスとインフラが増える（憲法の「複雑さを足すとき」）。営業中の店の画面が外部の可用性に依存する。

## R2. 非線形最小二乗のアルゴリズム

- **Decision**: R の `stats::nls` の既定（Gauss-Newton）と同じ手順を、`stackModelFit.ts` に自前で書く。
  - **パラメータ**: θ = (a1, b1, c1)。N = 6 で固定。
  - **モデル**: `f(x) = max(b(x − a1) + c1, c1)`、`b = b1 + c1/N`
  - **ヤコビアン**は解析的に求める。
    - 折れ点より右（`b(x − a1) > 0`）: ∂f/∂a1 = −b、∂f/∂b1 = x − a1、∂f/∂c1 = (x − a1)/N + 1
    - それ以外: (0, 0, 1)
  - **1 反復の手順**:
    1. 残差 r = y − f(θ)、ヤコビアン J（n×3）を作る。
    2. J を Householder の QR 分解にかける。階数が 3 未満なら「勾配が特異」として、この初期値は失敗とする。
    3. 収束の判定は、R の `nlsModel` の `convCrit` と同じ相対オフセット `sqrt(Σ(Qᵀr)[1:3]² / Σ(Qᵀr)[4:n]²)` が 1e-5 以下になったときとする。
    4. 増分 δ は `qr.coef(QR, r)`（R δ = (Qᵀr)[1:3] の後退代入）で求める。
    5. step halving: 係数 fac は 1 から始め、`SSR(θ + fac·δ) ≤ SSR(θ)` になるまで半分にする。受け入れたら fac = min(2·fac, 1)。fac が 1/1024 を下回ったら失敗とする。
    6. 反復は最大 50 回で、超えたら失敗とする。
  - **初期値の候補**: `{a1:5, b1:0.1, c1:2}`、`{a1:10, b1:0.1, c1:2}`、`{a1:15, b1:0.1, c1:2}` を順に試し、最初に収束したものを使う（`QUICKVIEW_STARTS`）。
  - **前提と失敗の扱い**:
    - 観測が 20 件未満なら試さない（`QUICKVIEW_MIN_OBS`）。
    - 等重みで、外れ値は除外しない。
    - 結果の係数が有限でないときも失敗とする。
- **Rationale**:
  - spec の Assumptions は「違いが出たら解析リポジトリに合わせる」と定めている。同じ局所解に落ちるよう、手順（初期値・step halving・収束の判定）まで揃える。
  - パラメータが 3 つなので、QR は小さく自前で書ける。依存パッケージを足さずに済む。
  - R の `numericDeriv`（前進差分）との違いは、ヤコビアンの近似誤差だけである。どちらも同じ停留点へ収束するので、有効数字 3 桁の一致（SC-001）は保てる。SC-001 は単体テストで確かめる。
- **Alternatives considered**:
  - Levenberg-Marquardt（`ml-levenberg-marquardt` など）: 依存パッケージが増え、R と別の局所解に行きうる。
  - a1 をグリッドで探し、(b, c1) を線形回帰で解く（プロファイル法）: 大域最適になるため、`nls` の局所解と食い違う場合がある。
  - 正規方程式（JᵀJ の逆行列）: QR より数値的に不安定である。さらに R と同じ収束の判定（Qᵀr）が作れない。
- **注意（テストの書き方）**: R の `nls` と同じく、残差がちょうど 0 の人工データでは相対オフセットの分母が 0 になり、収束と判定できない。合成データのテストには必ずばらつきを入れる。

## R3. stack の数え方と計算の仕方

- **Decision**: 注文 i の stack を、次の条件をすべて満たす先行注文 j のドリンク杯数の合計とする。
  - 選択日と同じ JST 営業日に受け付けた注文である（`jstDate(created)` が一致する）。
  - `created_j < created_i`
  - `ready_j` が無い、または `created_i < ready_j`
  - `cancelled_j` が無い、または `created_i < cancelled_j`

  この値は、注文を受け付けた時刻と、その時点で既にあった先行注文だけで決まる。後から付く打刻（`created_i` より後の ready・cancel）は「その時点では未完了」として数える。時点 as_of でデータを切り詰めても結果は変わらない。そこで、注文ごとの stack は営業日ごとに 1 回だけ計算し（受付時刻で並べた二重ループ。1,000 件で約 50 万回の比較）、時点ごとの当てはめでは観測を絞り込むだけにする。
- **Rationale**:
  - R の `add_stack()`（`created_i > created_j & (is.na(ready_j) | created_i < ready_j)`）と同じ判定である。
  - 営業日で限るのは `filter_service_dates()`・`stack_at()` と同じ扱いで、spec の Edge Cases（営業日のまたぎ）にも合う。
  - 取消を「受付から取消まで」数えるのは、spec の Edge Cases の決定である（R は取消を扱わない）。
  - 時点に依らないので、推移（最大 96 点）でも stack を計算し直さずに済む。
- **Alternatives considered**:
  - 時点ごとに計算し直す: 結果は同じで、計算量だけが点の数の倍になる。
  - 区間木やソートで O(n log n) にする: 1,000 件では O(n²) でも数 ms で済むので、読みやすさを優先した。

## R4. 提供時間に使う時刻と、ドリンク杯数

- **Decision**:
  - **提供時間**は、注文単位の `OrderEntity.readyAt − createdAt`（分）とする。
  - **ドリンク杯数**は `OrderEntity.getDrinkCups().length`（種類の `makes_cup` が真の構成品を数量分に展開した数）とする。
- **Rationale**:
  - 提供時間: R の `sv_min = ready_at − created_at` に合わせる。レジの `currentStack()` も、全カップがそろった時刻（注文単位の `readyAt`）を使っている。カップ単位で数えると予測が短めに出る。
  - ドリンク杯数: レジの `currentStack()` と同じ数え方にする（固定モデルとの比較を同じ定義で行うため）。サーバーが作る `cups[]` の数（R の `drink_cups`）とは、作られ方からして一致する。セットは構成品で数え、グッズは含まない。
- **Alternatives considered**:
  - カップ単位の `readyAt` の最大値: 注文単位の `readyAt` と同じ意味になるはずだが、レジと解析の定義からずれる。
  - `order.cups.length`: 保存前の注文ではカップが空のことがある。配信される注文は保存済みなので実害は無いが、レジに揃えた。

## R5. 取消・壊れた記録・未完了・未受信の扱い

- **Decision**: 当てはめに入れない注文と、表示のしかたを次のように分ける。

  | 状態 | 判定（時点 as_of で） | 当てはめ | stack | 表示 |
  |---|---|---|---|---|
  | 当てはめ対象 | 期間内に受付、取消なし、`created ≤ ready < as_of` | 使う | R3 のとおり | 散布図の点 |
  | 未完了 | 期間内に受付、取消なし、ready が無いか `ready ≥ as_of` | 使わない | 数える | 「未完了 n 件」 |
  | 取消 | `cancelled < as_of` | 使わない | 受付から取消まで数える | 件数だけ |
  | 壊れた記録 | `ready < created` | 使わない | 数えない（ready が受付より前なので、R3 の条件で自然に外れる） | 「除外 n 件」 |
  | 他の日の未完了 | 選択日より前の日に受付、取消なし、ready が無い | 使わない | 数えない | 「前日以前の未完了 n 件」の警告 |

  時点より後の取消は、その時点では取消されていないものとして扱う。未受信（`isOrdersLoaded === false`）のときは、既存の `LoadingState` をそのまま出す（ダッシュボードの既存の分岐がページの前で処理する）。
- **Rationale**: spec の Edge Cases と FR-004・FR-006・FR-015 の決定をそのまま実装する。「その時点より後に付いた打刻は使わない」（FR-014）を取消にも当てはめる。
- **Alternatives considered**: 壊れた記録を R の `clean_orders()` のように丸ごと落とす。stack への寄与は R3 の条件で 0 になるので、結果は同じになる。件数を表示するために、落とさず数える。

## R6. 時点（as_of）と期間の境界

- **Decision**:
  - 時点は `cutoff = min(window.end, now)` とする（既存の `DashboardWorkspace` と同じ）。
  - 「見えている打刻」は `t < as_of` とする（半開区間）。
  - 当てはめの対象は `window.start ≤ created < as_of` の注文である。
  - stack は、`window.start` より前の同じ営業日の注文も含めて数える（FR-002）。
- **Rationale**: 既存の `operationsReport`（`served < cutoff`）と同じく半開区間に揃える。R の `snapshot_at()` は `≤ as_of` を使う。違いが出るのは打刻がちょうど as_of とミリ秒まで一致する場合だけで、検算（R7）には影響しない。

## R7. 検算データ（SC-001 ほか）

- **Decision**: 同梱済みの `services/pos/app/lib/analytics/data/baseline-2025.json`（雙峰祭2025 の 978 注文。sohosai-analysis の commit a58608b8）を、単体テストの入力にする。正解は解析リポジトリの出力 JSON から取り、テストに定数で書く。
  - **全体**（`stack_quickview_2025-11-02_03_params.json`）: a1 = 7.28290、b1 = −0.554051、c1 = 5.98696、b = 0.443775、n = 978
  - **2025-11-02 13:00 時点**（`..._asof-20251102-1300_params.json`）: a1 = 5.39577、b1 = −0.802657、c1 = 6.89308、b = 0.346190、n = 154。推移（FR-014）の時点の切り詰めの検算に使う。

  2025 年の行は `[orderId, createdAt, readyAt, servedAt, billing, [[name, type]]]` で、ドリンク杯数は `type !== "others"` の数とする（R の `is_service_item()`）。全体の検算は 2 日にまたがるので、stack は営業日ごとに数え、観測をつないでから当てはめる。
- **Rationale**: 新しいデータをリポジトリに入れずに済む。2026 年の実データ（`orders-2026-10-12_*`）は指名などを含みうるため、このリポジトリ（public）にはコピーしない。
- **Alternatives considered**: 解析リポジトリの R を CI で動かして突合する。R と renv の環境が要り、CI が重くなる。

## R8. 固定モデルの持ち方

- **Decision**: `readyTimeEstimate.ts` の `STACK_MODEL` に `export` を付け、係数の表示に使う。固定モデルの予測は `predictReadyMinutes(stack)` を呼ぶ。値を写したり二重に持ったりしない。
- **Rationale**: spec の Assumptions（「値は一か所で定め、二重に持たない」）に合う。レジと同じ関数を通すので、ダッシュボードの「固定モデルの予測」は必ずレジの表示と一致する。export を足すだけなので、レジの挙動は変わらない。
- **Alternatives considered**: 係数を `stackModelFit.ts` に写す。値が食い違う危険がある。

## R9. 再計算のタイミングと性能（SC-002・SC-003）

- **Decision**:
  - 計算は `StackModelSection` の中の `useMemo` で行う。このページを開いているときだけ走り、ほかのページの描画コストは増えない（SC-004）。
  - メモは 4 段に分ける。
    1. 注文の写し: `sourceOrders` が変わったとき
    2. 営業日の観測（stack）: 1 と選択日が変わったとき
    3. 当てはめと表示: 2・`window`・`cutoff` が変わったとき
    4. 推移: 2・`window.start`・集計間隔・「完了した区切りの最後の終わり」が変わったとき。途中の最後の点だけは 3 の結果をそのまま使う。
  - 計算量の見積もり（1,000 件）:
    - stack: 1 回あたり約 50 万回の比較
    - 当てはめ: 初期値 3 つ × 最大 50 反復 × 1,000 点
    - 推移: 15 分ごと・営業 8 時間で 32 点、終日では最大 96 点。件数の足りない時点は即座に「不能」になる。

  普段の時計の更新（10 秒ごと）では、3 と推移の最後の点だけを計算し直す。
- **Rationale**: WebSocket の配信で `allOrders` の参照が変わると、すぐに再計算される（SC-002）。Web Worker は、quickstart の計測で 2 秒を超えたときの次の手段として残す。
- **Alternatives considered**:
  - Web Worker に移す: 仕組みが増え、`OrderEntity` を渡すための写しも要る。まずはメインスレッドで測る。
  - 前回の係数を初期値に使う（warm start）: 「解析リポジトリと同じ候補」（FR-006）から外れ、結果が履歴に依存してしまう。

## R10. 推移の時点の取り方

- **Decision**:
  - 時点は `window.start + k × interval`（k = 1, 2, …）のうち `≤ cutoff` のものとする。最後の区切りが途中なら `cutoff` も 1 点加え、「途中」として区別する。
  - 各点では、R6 の規則で時点に切り詰めた観測で当てはめる。
  - 当てはめ不能な点は値を `null` にして、線を切る（`connectNulls={false}`）。0 や直前の値で埋めない。
  - 最後の点は、係数の欄（User Story 1）と同じ時点・同じ観測になるので、値が一致する。
- **Rationale**: FR-014 と User Story 3 の受け入れ条件（最後の点が係数と一致する、欠けを埋めない）を満たす。
- **Alternatives considered**: 区切りの中のデータだけで当てはめる（移動窓）。spec の Assumptions で範囲外とされている。

## R11. 描画（recharts）

- **Decision**:
  - **散布図**は `ComposedChart` で描く。
    - 実測は `Scatter`、当てはめた曲線は実線の `Line`、固定モデルは破線の `Line` にする。
    - 折れ点 a1 は `ReferenceLine x={a1}` にラベル「a1」を付ける。
    - 曲線は 0〜観測の最大 stack を 0.5 杯ごとに評価する。
    - 縦軸の上限は「四分位範囲で見た上側の外れ値の境界（Q3 + 3×IQR）」と「曲線の最大」の大きい方を 5 分単位に切り上げる。超えた点は描かず、「表示範囲外に n 件」と書く。
    - 点を選ぶと、Tooltip に注文番号・stack・実測・予測（当てはめと固定）を数値で出す。
  - **推移**は、a1・c1・b を 3 つの小さな `LineChart` に分ける。固定モデルの値を破線の `ReferenceLine` で重ね、途中の点は白抜きで描く。
  - どのグラフも、軸に対象と単位を付ける。既存の `ChartValues`（数値の表の折り畳み）を併設し、凡例・線種・文字で系列を区別する（FR-019）。
  - すべて `isAnimationActive={false}` にする（1,000 点の再描画を軽くする）。
- **Rationale**: recharts は既存の依存で、ほかのページの書き方（`accessibilityLayer`・軸ラベル・`ChartValues`）を踏襲できる。外れ値を除外せず、表示範囲だけを調整する方針は spec の Edge Cases の決定である。
- **Alternatives considered**: 散布図を SVG で手書きする。軸・Tooltip・アクセシビリティを作り直すことになる。

## R12. 警告の判定

- **Decision**:
  - **警告**（該当するときだけ、係数の近くに出す）:
    - `a1 < 観測の最小 stack` または `a1 > 観測の最大 stack`: 折れ点がデータの範囲外
    - `b ≤ 0`
    - いまの stack > 観測の最大 stack: 外挿（いまの状況の予測の横に出す）
    - 他の日の未完了 > 0: 前日以前の未完了 n 件（stack には数えていない）
  - 常時の注意文は置かない。
- **Rationale**: FR-015 をそのまま判定できる形にした。表示の文言は contracts/dashboard-tab-ui.md で固定する。利用者はモデルと当てはめの限界を承知しているので、留保の文言は付けない。

## R13. テストの方針

- **Decision**: vitest の単体テストだけで確かめる。テスト名は既存の慣習に合わせて `[unit]` を含める（`pnpm pos test:unit` は `-t unit` で絞る）。
  - `stackModelFit.test.ts`（合成データ。ばらつきを入れる）:
    - 既知の係数を復元できる。
    - 19 件では当てはめない。
    - すべて折れ点より左のデータでは失敗し、不能の理由を返す。
    - 1 つ目の初期値で収束しないデータを、2 つ目以降で拾える。
    - 有限でない値が出ない。
  - `stackModel.test.ts`:
    - SC-001: 2025 年の 978 件で、a1・b1・c1・b が有効数字 3 桁で一致する。
    - 13:00 時点: 154 件で一致する。
    - 取消・壊れた記録・未完了・営業日のまたぎ・グッズのみの注文の数え方
    - 推移の最後の点が係数の欄と一致し、不能な点は `null` になる。
    - 精度の 3 行・区間表の分位点が R と同じ type 7 になる（既存の `quantile` を再利用する）。
    - 固定モデルの予測が `predictReadyMinutes` と一致する。
  - 画面の部品は、既存のダッシュボードと同じく手元とプレビューで目視確認する（quickstart.md）。リポジトリには React Testing Library が無く、足さない。
- **Rationale**: 憲法 V（計算ロジックは DB を使わない単体テストにする）と、品質ゲート（lint・typecheck・単体テスト・`go test`）に沿う。Go のテストは、変更が無いことを確かめるために流すだけにする。
