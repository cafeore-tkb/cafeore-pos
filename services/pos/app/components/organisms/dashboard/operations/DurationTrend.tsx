import { jstClock, jstDate } from "@cafeore/common";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type {
  BucketMinutes,
  operationsReport,
} from "~/lib/analytics/operations";
import { minutes } from "./DurationCharts";

const series = [
  { key: "mean", name: "平均", color: "#0f766e" },
  { key: "median", name: "中央値", color: "#2563eb" },
  { key: "max", name: "最大", color: "#e11d48" },
  { key: "min", name: "最小", color: "#a16207" },
] as const;
export function DurationTrend({
  buckets,
  intervalMinutes,
}: {
  buckets: ReturnType<typeof operationsReport>["durationBuckets"];
  intervalMinutes: BucketMinutes;
}) {
  const chronological = [...buckets].sort((a, b) => a.at - b.at);
  const label = (at: number) =>
    `${jstDate(at).slice(5)} ${jstClock(at).slice(0, 5)}`;
  return (
    <section className="space-y-3" aria-label="時間帯ごとの提供時間">
      <h4 className="font-bold">{intervalMinutes}分ごとの提供時間</h4>
      <p className="text-stone-600 text-xs">
        その時間帯に受けた注文の、受付から提供まで（1杯ごと）。まだ渡していない杯は除きます。左が古い時間帯、右が最新です。記録がない枠は線をつなぎません。最大・最小には外れ値も含みます。
      </p>
      {buckets.some((b) => b.count > 0) ? (
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={chronological}
              accessibilityLayer
              margin={{ left: 8, right: 12, top: 12, bottom: 12 }}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="at"
                tickFormatter={label}
                minTickGap={30}
                tick={{ fontSize: 11 }}
              />
              <YAxis
                tickFormatter={(value) => `${value}分`}
                width={55}
                domain={[0, "auto"]}
              />
              <Tooltip
                labelFormatter={(value) => `${label(Number(value))}〜`}
                formatter={(value: number) => minutes(value)}
              />
              <Legend />
              {series.map((s) => (
                <Line
                  key={s.key}
                  dataKey={s.key}
                  name={s.name}
                  stroke={s.color}
                  strokeWidth={2}
                  type="linear"
                  connectNulls={false}
                  isAnimationActive={false}
                  dot={{ r: 2 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="rounded-lg bg-stone-50 p-4 text-sm">
          提供時間の記録がまだありません。
        </p>
      )}
      <details>
        <summary className="cursor-pointer text-sm">
          時間帯ごとの数値・杯数
        </summary>
        <div className="max-h-72 overflow-auto">
          <table className="w-full whitespace-nowrap text-left text-xs">
            <thead>
              <tr>
                {["受付時間帯", "提供済み", ...series.map((s) => s.name)].map(
                  (name) => (
                    <th key={name} className="p-2">
                      {name}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {chronological.map((b) => (
                <tr key={b.at} className="border-t">
                  <td className="p-2">
                    {label(b.at)}〜
                    {jstClock(b.at + intervalMinutes * 60000).slice(0, 5)}
                    {!b.complete ? "（途中）" : ""}
                  </td>
                  <td className="p-2">{b.count}杯</td>
                  {series.map((s) => (
                    <td key={s.key} className="p-2">
                      {minutes(b[s.key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
