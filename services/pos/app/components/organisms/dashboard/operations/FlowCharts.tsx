import { jstClock, jstDate } from "@cafeore/common";
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { FlowBucket } from "~/lib/analytics/operations";

/** 未完了の15分枠は流量には表示し、加速度の比較からは除外する。 */
export function FlowCharts({
  buckets,
  chart = "all",
}: { buckets: FlowBucket[]; chart?: "flow" | "acceleration" | "all" }) {
  // 深夜の空の枠は省略するが、営業中のゼロの枠は残す。
  const first = buckets.findIndex((b) => b.received || b.served || b.backlog);
  const data = (
    first < 0 ? buckets.slice(-8) : buckets.slice(Math.max(0, first - 1))
  ).map((b) => ({
    ...b,
    clock: `${jstDate(b.at).slice(5)} ${jstClock(b.at).slice(0, 5)}`,
    period: b.complete ? "確定した15分枠" : "集計途中",
  }));
  return (
    <div className="space-y-4">
      {chart !== "acceleration" && (
        <>
          <p className="mt-3 flex flex-wrap gap-4 text-xs">
            <span className="font-bold text-slate-600">■ 受注（杯/15分）</span>
            <span className="font-bold text-emerald-700">
              ■ 提供（杯/15分）
            </span>
            <span className="font-bold text-amber-700">
              ─ 枠末の未提供（杯）
            </span>
          </p>
          <div
            className="h-64 w-full"
            aria-label="15分ごとの受注・提供・未提供カップ数"
          >
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={data}
                margin={{ top: 10, right: 16, bottom: 0, left: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="clock" minTickGap={30} />
                <YAxis allowDecimals={false} />
                <Tooltip
                  labelFormatter={(_, payload) =>
                    `${payload[0]?.payload.clock ?? ""}〜 / ${payload[0]?.payload.period ?? ""}`
                  }
                />
                <Bar
                  dataKey="received"
                  name="受注（杯）"
                  fill="#475569"
                  isAnimationActive={false}
                />
                <Bar
                  dataKey="served"
                  name="提供（杯）"
                  fill="#059669"
                  isAnimationActive={false}
                />
                <Line
                  dataKey="backlog"
                  name="枠末の未提供（杯）"
                  stroke="#d97706"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
      {chart !== "flow" && (
        <div
          className="h-40 w-full"
          aria-label="混み合い加速度。未提供増減の前の15分との差"
        >
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ right: 16, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="clock" minTickGap={30} />
              <YAxis />
              <Tooltip />
              <ReferenceLine y={0} stroke="#64748b" />
              <Area
                type="linear"
                dataKey="acceleration"
                name="混み合い加速度（杯/15分²）"
                stroke="#be123c"
                fill="#ffe4e6"
                connectNulls={false}
                isAnimationActive={false}
              />
              <Line
                dataKey="net"
                name="未提供の増減（杯/15分）"
                stroke="#64748b"
                dot={false}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
