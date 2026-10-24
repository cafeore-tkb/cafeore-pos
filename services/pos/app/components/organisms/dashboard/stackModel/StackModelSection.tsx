import { type OrderEntity, jstClock } from "@cafeore/common";
import {
  ChartScatter,
  ChartSpline,
  Gauge,
  Sigma,
  Table,
  TriangleAlert,
} from "lucide-react";
import { useMemo } from "react";
import type { BucketMinutes, TimeWindow } from "~/lib/analytics/operations";
import {
  type StackModelView,
  type StackWarning,
  stackModelTrend,
  stackModelView,
  stackObservations,
  stackOrders,
  trendPointFromFit,
} from "~/lib/analytics/stackModel";
import { STACK_FIT_MIN_OBS } from "~/lib/analytics/stackModelFit";
import { StackModelScatter } from "./StackModelScatter";
import { StackModelTables } from "./StackModelTables";
import { StackModelTrend } from "./StackModelTrend";

/** 有効数字 3 桁 */
const sig3 = (value: number) => value.toPrecision(3);
/** 分を小数第 1 位まで */
const min1 = (value: number) => `${value.toFixed(1)}分`;

export function StackModelSection({
  orders,
  day,
  window,
  cutoff,
  intervalMinutes,
}: {
  orders: readonly OrderEntity[];
  day: string;
  window: TimeWindow;
  cutoff: number;
  intervalMinutes: BucketMinutes;
}) {
  const mapped = useMemo(() => stackOrders(orders), [orders]);
  const input = useMemo(() => stackObservations(mapped, day), [mapped, day]);
  const view = useMemo(
    () => stackModelView(input, window, cutoff),
    [input, window, cutoff],
  );
  // 完了した区切りの点は、区切りが進むまで計算し直さない（10 秒ごとの時計の更新では途中の点だけ）
  const { start, end } = window;
  const step = intervalMinutes * 60_000;
  const completedUntil = start + Math.floor((cutoff - start) / step) * step;
  const completed = useMemo(
    // 推移は window.start しか使わない。now を渡すと時計の更新のたびにメモが外れる
    () =>
      stackModelTrend(
        input,
        { start, end, now: completedUntil },
        completedUntil,
        intervalMinutes,
      ),
    [input, start, end, intervalMinutes, completedUntil],
  );
  const trend =
    cutoff > completedUntil
      ? [...completed, trendPointFromFit(view.fit, cutoff, true)]
      : completed;

  return (
    <div className="space-y-5">
      <Coefficients view={view} />
      <NowStatus view={view} />
      <Warnings warnings={view.warnings} />
      <section className="min-w-0 border-stone-200 border-t pt-6">
        <Heading
          icon={ChartScatter}
          title="実測とモデル曲線"
          description="当てはめに使った注文の stack と提供時間に、当てはめた曲線と固定モデルの曲線を重ねます。点を選ぶと値が出ます。"
        />
        <div className="mt-5">
          <StackModelScatter view={view} />
        </div>
      </section>
      <section className="min-w-0 border-stone-200 border-t pt-6">
        <Heading
          icon={Table}
          title="当てはまりの確認"
          description="予測の誤差と、stack の区間ごとの実測の分布です。"
        />
        <div className="mt-5">
          <StackModelTables view={view} />
        </div>
      </section>
      <section className="min-w-0 border-stone-200 border-t pt-6">
        <Heading
          icon={ChartSpline}
          title="係数の推移"
          description={`${intervalMinutes}分ごとの区切りの終わりまでの注文で当て直した係数です。当てはめ不能な時点は線を切ります。白抜きの点は区切りの途中です。破線は固定モデルです。`}
        />
        <div className="mt-5">
          <StackModelTrend points={trend} fixed={view.fixed} />
        </div>
      </section>
    </div>
  );
}

function Heading({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof Gauge;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="pt-1 text-stone-500">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <div>
        <h3 className="font-black text-lg tracking-tight">{title}</h3>
        <p className="mt-1 text-stone-500 text-xs">{description}</p>
      </div>
    </div>
  );
}

function Coefficients({ view }: { view: StackModelView }) {
  const { fit, fixed, counts } = view;
  const fixedB = fixed.b1 + fixed.c1 / fixed.nStaff;
  const main = [
    {
      key: "c1",
      name: "空いているときの提供時間",
      unit: "分",
      fit: fit.ok ? fit.c1 : null,
      fixed: fixed.c1,
    },
    {
      key: "a1",
      name: "待ちが伸び始める杯数",
      unit: "杯",
      fit: fit.ok ? fit.a1 : null,
      fixed: fixed.a1,
    },
    {
      key: "b",
      name: "1杯増えるごとに延びる時間",
      unit: "分/杯",
      fit: fit.ok ? fit.b : null,
      fixed: fixedB,
    },
  ];
  return (
    <section className="border-stone-200 border-t pt-6">
      <Heading
        icon={Sigma}
        title="係数"
        description="選択中の期間の注文で当て直した stack モデルの係数です。右は固定モデル（雙峰祭2025・レジの予測と同じ）の値です。"
      />
      {!fit.ok && (
        <p className="mt-4 border-amber-500 border-l-2 pl-3 font-bold text-amber-900 text-sm">
          {fit.reason === "insufficient"
            ? `当てはめ不能（件数不足）：あと ${fit.needed - fit.nObs} 件で当てはめます`
            : "当てはめ不能（収束しない）"}
        </p>
      )}
      <dl className="mt-5 grid gap-x-8 gap-y-5 sm:grid-cols-3">
        {main.map((item) => (
          <div key={item.key} className="py-2">
            <dt className="font-bold text-stone-600 text-xs sm:text-sm">
              {item.name}（{item.key}）
            </dt>
            <dd className="mt-3">
              {item.fit !== null && (
                <span className="font-black text-2xl tabular-nums tracking-tight sm:text-3xl">
                  {sig3(item.fit)}
                  <span className="ml-1 font-bold text-sm">{item.unit}</span>
                </span>
              )}
              <span
                className={`block text-stone-500 tabular-nums ${item.fit !== null ? "mt-2 text-xs" : "font-bold text-lg"}`}
              >
                固定モデル {sig3(item.fixed)}
                {item.unit}
              </span>
            </dd>
          </div>
        ))}
      </dl>
      <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-stone-600 text-xs tabular-nums">
        <div className="flex gap-1">
          <dt>b1（傾きの定数部分）</dt>
          <dd>
            {fit.ok ? `${sig3(fit.b1)}分/杯・` : ""}固定モデル {sig3(fixed.b1)}
            分/杯
          </dd>
        </div>
        <div className="flex gap-1">
          <dt>N（抽出担当）</dt>
          <dd>{fixed.nStaff}人（固定）</dd>
        </div>
      </dl>
      <p className="mt-4 text-sm tabular-nums">
        当てはめ {counts.fitted}件・未完了 {counts.pending}件・取消{" "}
        {counts.cancelled}件・除外（時刻の逆転）{counts.broken}件
      </p>
      {counts.latestTimestamp !== null && (
        <p className="mt-1 text-stone-500 text-xs tabular-nums">
          最後に反映した打刻 {jstClock(counts.latestTimestamp)}
        </p>
      )}
      <details className="mt-4 text-stone-600 text-xs">
        <summary className="cursor-pointer py-2 font-bold">
          モデル式と定義
        </summary>
        <div className="space-y-2 leading-relaxed">
          <p>
            予測提供時間 = <code>max(b × (stack − a1) + c1, c1)</code>、
            <code>b = b1 + c1 / N</code>（N = {fixed.nStaff}）
          </p>
          <p>
            stack:
            その注文を受け付けた瞬間に、同じ営業日に受け付けてまだ提供可能になっていない（取消されていない）注文のドリンク杯数の合計です。グッズは数えません。
          </p>
          <p>
            提供時間:
            受付から、注文の全カップが提供可能になるまでの時間（分）です。
          </p>
          <p>
            当てはめ方:
            非線形最小二乗（Gauss-Newton）。等重みで、外れ値は除外しません。初期値は
            3
            候補を順に試し、最初に収束したものを使います。当てはめに使える注文が{" "}
            {STACK_FIT_MIN_OBS}件未満なら当てはめません。
          </p>
          {fit.ok && <p>反復の回数: {fit.iterations}回</p>}
        </div>
      </details>
    </section>
  );
}

function NowStatus({ view }: { view: StackModelView }) {
  const { now } = view;
  const clock = jstClock(now.asOf).slice(0, 5);
  return (
    <section className="border-stone-200 border-t pt-6">
      <Heading
        icon={Gauge}
        title={
          now.live ? `いまの状況（${clock}）` : `期間末（${clock}）時点の状況`
        }
        description="この時点で提供可能になっていない注文と、いま注文したときの予測です。"
      />
      <dl className="mt-5 grid grid-cols-2 gap-x-8 gap-y-5 xl:grid-cols-5">
        <Metric label="いまの stack" value={`${now.stack}杯`} />
        <Metric label="未完了の注文" value={`${now.pendingOrders}件`} />
        <Metric
          label="いちばん古い未完了"
          value={
            now.oldestWaitMinutes === null
              ? "なし"
              : `${now.oldestWaitMinutes.toFixed(0)}分経過`
          }
        />
        {now.predictedFit !== null && (
          <Metric label="予測（この当てはめ）" value={min1(now.predictedFit)} />
        )}
        <Metric label="予測（固定モデル）" value={min1(now.predictedFixed)} />
      </dl>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="py-2">
      <dt className="font-bold text-stone-600 text-xs sm:text-sm">{label}</dt>
      <dd className="mt-3 font-black text-2xl tabular-nums tracking-tight">
        {value}
      </dd>
    </div>
  );
}

const warningText = (warning: StackWarning) => {
  switch (warning.kind) {
    case "a1-out-of-range":
      return `折れ点 a1（${warning.a1.toFixed(2)} 杯）が、当てはめたデータの stack の範囲（${warning.stackMin}〜${warning.stackMax} 杯）の外です。`;
    case "non-positive-slope":
      return "傾き b が 0 以下です。";
    case "extrapolation":
      return `いまの stack（${warning.stack} 杯）は、当てはめに使った最大（${warning.stackMax} 杯）を超えています。`;
    case "other-day-pending":
      return `前日以前に受け付けて、まだ提供可能になっていない注文が ${warning.count} 件あります。いまの stack には数えていません。`;
  }
};

function Warnings({ warnings }: { warnings: StackWarning[] }) {
  if (!warnings.length) return null;
  return (
    <section aria-label="警告" className="border-stone-200 border-t pt-6">
      <ul className="space-y-2">
        {warnings.map((warning) => (
          <li
            key={warning.kind}
            className="flex items-start gap-2 border-amber-500 border-l-2 pl-3 text-amber-900 text-sm"
          >
            <TriangleAlert
              className="mt-0.5 h-4 w-4 shrink-0"
              aria-hidden="true"
            />
            {warningText(warning)}
          </li>
        ))}
      </ul>
    </section>
  );
}
