import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { distribution } from "~/lib/analytics/operations";
import { ChartValues } from "./ChartValues";
import {
  CURRENT_YEAR_COLOR,
  PREVIOUS_YEAR_COLOR,
  PREVIOUS_YEAR_LINE,
} from "./YearChartStyle";

export const minutes = (value: number | null) =>
  value === null ? "未計測" : `${value.toFixed(1)}分`;
export function DurationCharts({
  stats,
  chart = "all",
  compact = false,
  hideBoxPlot = false,
  maximumCount,
  maximumMinutes,
  year = "current",
}: {
  stats: ReturnType<typeof distribution>;
  compact?: boolean;
  chart?: "histogram" | "cdf" | "box" | "all";
  hideBoxPlot?: boolean;
  maximumCount?: number;
  maximumMinutes?: number;
  year?: "current" | "previous";
}) {
  const fill = year === "previous" ? PREVIOUS_YEAR_COLOR : CURRENT_YEAR_COLOR;
  const stroke = year === "previous" ? PREVIOUS_YEAR_LINE : CURRENT_YEAR_COLOR;
  if (!stats.count)
    return (
      <p className="p-4 text-muted-foreground">
        お渡し時間の記録がまだありません。待っている分は0分に数えません。
      </p>
    );
  const range = Math.max(stats.max ?? 0, ...stats.outliers, 1);
  const pct = (v: number | null) => `${((v ?? 0) / range) * 100}%`;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: "真ん中の時間", value: minutes(stats.p50) },
          { label: "9割を渡すまで", value: minutes(stats.p90) },
          { label: "記録した杯数", value: `${stats.count}杯` },
        ].map((item) => (
          <div key={item.label} className="border-stone-200 border-b py-3">
            <p className="text-[11px] text-stone-500">{item.label}</p>
            <p
              className={`mt-1 font-extrabold text-lg tabular-nums ${year === "previous" ? "text-green-950" : "text-blue-950"}`}
            >
              {item.value}
            </p>
          </div>
        ))}
      </div>
      {chart === "cdf" && (
        <div className="flex flex-wrap gap-2 text-xs">
          {[10, 15, 20].map((limit) => {
            const percent =
              stats.cdf.filter((point) => point.minutes <= limit).at(-1)
                ?.percent ?? 0;
            return (
              <span key={limit} className="py-1.5">
                {limit}分以内に <strong>{percent.toFixed(0)}%</strong> お渡し
              </span>
            );
          })}
        </div>
      )}
      <div className="space-y-5">
        {chart === "all" || chart === "histogram" ? (
          <div className="h-56" aria-label="お渡しまでの時間と杯数（5分ごと）">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={stats.histogram}
                accessibilityLayer
                margin={{ top: 16, right: 8, left: 16, bottom: 24 }}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="label"
                  label={{
                    value: "提供所要時間（区間）",
                    position: "bottom",
                    offset: 2,
                  }}
                  tick={{ fontSize: 10 }}
                  interval="preserveStartEnd"
                  minTickGap={12}
                  angle={-20}
                  height={45}
                />
                <YAxis
                  allowDecimals={false}
                  domain={[0, maximumCount ?? "auto"]}
                  label={{
                    value: "提供済み（杯）",
                    angle: -90,
                    position: "insideLeft",
                  }}
                />
                <Tooltip formatter={(value) => [`${value}杯`, "提供済み"]} />
                <Bar
                  dataKey="count"
                  name="お渡しした杯数"
                  fill={fill}
                  isAnimationActive={false}
                  radius={[5, 5, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : null}
        {chart === "all" || chart === "cdf" ? (
          <div className="h-56" aria-label="何分以内に何パーセント渡せたか">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={
                  stats.cdf[0]?.minutes > 0
                    ? [{ minutes: 0, percent: 0 }, ...stats.cdf]
                    : stats.cdf
                }
                accessibilityLayer
                margin={{ top: 16, right: 16, left: 24, bottom: 24 }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="minutes"
                  type="number"
                  domain={[0, maximumMinutes ?? "auto"]}
                  unit="分"
                  label={{
                    value: "提供所要時間（分）",
                    position: "bottom",
                    offset: 4,
                  }}
                />
                <YAxis
                  domain={[0, 100]}
                  unit="%"
                  label={{
                    value: "累積割合（%）",
                    angle: -90,
                    position: "insideLeft",
                    offset: -12,
                  }}
                />
                <ReferenceLine
                  x={15}
                  stroke="#f97316"
                  strokeDasharray="4 4"
                  label={{ value: "15分", fill: "#c2410c", fontSize: 11 }}
                />
                <Tooltip
                  labelFormatter={(value) => `${Number(value).toFixed(2)}分`}
                  formatter={(value: number) => [
                    `${Number(value).toFixed(2)}%`,
                    "この時間までに渡せた割合",
                  ]}
                />
                <Line
                  type="stepAfter"
                  dataKey="percent"
                  name="この時間までに渡せた割合（%）"
                  stroke={stroke}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : null}
      </div>
      {(chart === "all" || chart === "histogram") && (
        <>
          <p className="text-stone-500 text-xs">
            各区間の杯数です。40分以上は上限のない区間の合計で、密度を表すヒストグラムではありません。
          </p>
          <ChartValues
            columns={["提供所要時間", "提供済み（杯）"]}
            rows={stats.histogram.map((b) => [b.label, b.count])}
          />
        </>
      )}
      {(chart === "all" || chart === "cdf") && (
        <ChartValues
          columns={["提供所要時間（分）", "累積割合（%）"]}
          rows={stats.cdf.map((b) => [b.minutes, b.percent])}
        />
      )}
      {(chart === "all" || chart === "box") && !hideBoxPlot ? (
        <div
          aria-label={`箱ひげ図：下ひげ${minutes(stats.min)}、第1四分位${minutes(stats.q1)}、中央値${minutes(stats.p50)}、第3四分位${minutes(stats.q3)}、上ひげ${minutes(stats.max)}`}
          className="border-stone-200 border-t pt-4"
        >
          <p className="mb-3 text-muted-foreground text-xs">
            箱は「真ん中の半分」、中の線は真ん中の時間。長いほど待ち時間の差が大きいです。
          </p>
          <div className="relative mx-3 h-9">
            <div
              className="absolute top-4 h-px bg-stone-500"
              style={{
                left: pct(stats.min),
                width: pct((stats.max ?? 0) - (stats.min ?? 0)),
              }}
            />
            <div
              className="absolute top-1 h-7 border"
              style={{
                borderColor: stroke,
                backgroundColor:
                  year === "previous" ? PREVIOUS_YEAR_COLOR : "#dbeafe",
                left: pct(stats.q1),
                width: pct((stats.q3 ?? 0) - (stats.q1 ?? 0)),
              }}
            />
            {[stats.min, stats.p50, stats.max].map((v, i) => (
              <span
                key={["min", "median", "max"][i]}
                className="absolute top-1 h-7 border-stone-700 border-l-2"
                style={{ left: pct(v) }}
              />
            ))}
            {[...new Set(stats.outliers)].map((v) => (
              <span
                key={v}
                title={`外れ値 ${v}分`}
                className="absolute top-3 h-2 w-2 rounded-full bg-rose-600"
                style={{ left: pct(v) }}
              />
            ))}
          </div>
          <div className="mx-3 flex justify-between text-xs">
            <span>0分</span>
            <span>提供所要時間（分）</span>
            <span>{range.toFixed(1)}分</span>
          </div>
          <ChartValues
            columns={["統計量", "時間（分）"]}
            rows={[
              ["下ひげ", stats.min],
              ["Q1", stats.q1],
              ["中央値", stats.p50],
              ["Q3", stats.q3],
              ["上ひげ", stats.max],
              ...stats.outliers.map((v, i): [string, number] => [
                `外れ値 ${i + 1}`,
                v,
              ]),
            ]}
          />
          <p className="text-xs">
            短い側 {minutes(stats.min)} / 真ん中 {minutes(stats.p50)} / 長い側{" "}
            {minutes(stats.max)} / 特に離れた記録 {stats.outliers.length}杯
          </p>
        </div>
      ) : null}
      <details className="text-stone-500 text-xs">
        <summary className="cursor-pointer">時間の見方を詳しく</summary>
        <p className="mt-2">
          渡し終えた分だけの実測です。真ん中は中央値、9割を渡すまではP90。次の注文の待ち時間予測ではありません。
          {!hideBoxPlot &&
            "箱ひげ図の線の端は箱の幅の1.5倍までの範囲にある最小・最大です。"}
          特に離れた記録も平均や割合には含めます。平均 {minutes(stats.mean)}。
        </p>
      </details>
    </div>
  );
}
