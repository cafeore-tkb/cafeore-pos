import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { distribution } from "~/lib/analytics/operations";

export const minutes = (value: number | null) =>
  value === null ? "未計測" : `${value.toFixed(1)}分`;
export function DurationCharts({
  stats,
  chart = "all",
  compact = false,
  hideBoxPlot = false,
}: {
  stats: ReturnType<typeof distribution>;
  compact?: boolean;
  chart?: "histogram" | "cdf" | "box" | "all";
  hideBoxPlot?: boolean;
}) {
  if (!stats.count)
    return (
      <p className="p-4 text-muted-foreground">
        お渡し時間の記録がまだありません。待っている分は0分に数えません。
      </p>
    );
  const range = Math.max(stats.max ?? 0, stats.q3 ?? 0, 1);
  const pct = (v: number | null) => `${((v ?? 0) / range) * 100}%`;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: "真ん中の時間", value: minutes(stats.p50) },
          { label: "9割を渡すまで", value: minutes(stats.p90) },
          { label: "記録した杯数", value: `${stats.count}杯` },
        ].map((item) => (
          <div key={item.label} className="rounded-xl bg-teal-50 p-3">
            <p className="text-[11px] text-teal-800">{item.label}</p>
            <p className="mt-1 font-bold text-lg text-teal-950 tabular-nums">
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
              <span
                key={limit}
                className="rounded-full border border-teal-200 px-3 py-1.5"
              >
                {limit}分以内に <strong>{percent.toFixed(0)}%</strong> お渡し
              </span>
            );
          })}
        </div>
      )}
      <div
        className={
          chart === "all" && !compact
            ? "grid gap-4 lg:grid-cols-2"
            : "space-y-4"
        }
      >
        {chart === "all" || chart === "histogram" ? (
          <div className="h-56" aria-label="お渡しまでの時間と杯数（5分ごと）">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.histogram}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 10 }}
                  interval={0}
                  angle={-20}
                  height={45}
                />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Bar
                  dataKey="count"
                  name="お渡しした杯数"
                  fill="#0d9488"
                  isAnimationActive={false}
                  radius={[5, 5, 0, 0]}
                >
                  {stats.histogram.map((bin, index) => (
                    <Cell
                      key={bin.label}
                      fill={
                        ["#0d9488", "#38bdf8", "#fbbf24", "#f97316", "#e11d48"][
                          Math.min(index, 4)
                        ]
                      }
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : null}
        {chart === "all" || chart === "cdf" ? (
          <div className="h-56" aria-label="何分以内に何パーセント渡せたか">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={stats.cdf}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="minutes" type="number" unit="分" />
                <YAxis domain={[0, 100]} unit="%" />
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
                  stroke="#0d9488"
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : null}
      </div>
      {(chart === "all" || chart === "box") && !hideBoxPlot ? (
        <div
          aria-label={`箱ひげ図：下ひげ${minutes(stats.min)}、第1四分位${minutes(stats.q1)}、中央値${minutes(stats.p50)}、第3四分位${minutes(stats.q3)}、上ひげ${minutes(stats.max)}`}
          className="rounded-lg border p-4"
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
              className="absolute top-1 h-7 border border-emerald-700 bg-emerald-100"
              style={{
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
          </div>
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
