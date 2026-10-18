import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
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
}: { stats: ReturnType<typeof distribution> }) {
  if (!stats.count)
    return (
      <p className="p-4 text-muted-foreground">
        有効な提供打刻がありません。未提供を0分として集計しません。
      </p>
    );
  const range = Math.max(stats.max ?? 0, stats.q3 ?? 0, 1);
  const pct = (v: number | null) => `${((v ?? 0) / range) * 100}%`;
  return (
    <div className="space-y-4">
      <p className="text-sm">
        完了した{stats.count}杯：中央値 {minutes(stats.p50)} / P90{" "}
        {minutes(stats.p90)} / 平均 {minutes(stats.mean)}
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="h-56" aria-label="提供時間のヒストグラム（5分刻み）">
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
                name="提供済み（杯）"
                fill="#78716c"
                isAnimationActive={false}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="h-56" aria-label="提供時間の累積分布">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={stats.cdf}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="minutes" type="number" unit="分" />
              <YAxis domain={[0, 100]} unit="%" />
              <Tooltip />
              <Line
                type="stepAfter"
                dataKey="percent"
                name="この時間以内に提供（%）"
                stroke="#047857"
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div
        aria-label={`箱ひげ図：下ひげ${minutes(stats.min)}、第1四分位${minutes(stats.q1)}、中央値${minutes(stats.p50)}、第3四分位${minutes(stats.q3)}、上ひげ${minutes(stats.max)}`}
        className="rounded-lg border p-4"
      >
        <p className="mb-3 text-muted-foreground text-xs">
          箱ひげ図（ひげは1.5×IQR内の最小・最大、外れ値も集計に残す）
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
          下ひげ {minutes(stats.min)} / Q1 {minutes(stats.q1)} / 中央値{" "}
          {minutes(stats.p50)} / Q3 {minutes(stats.q3)} / 上ひげ{" "}
          {minutes(stats.max)} / 外れ値 {stats.outliers.length}杯
        </p>
      </div>
    </div>
  );
}
