import { jstClock, jstDate } from "@cafeore/common";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { BucketMinutes, FlowBucket } from "~/lib/analytics/operations";
import { ChartValues } from "./ChartValues";

/** 未完了の時間枠は流量には表示し、加速度の比較からは除外する。 */
export function FlowCharts({
  buckets,
  chart = "all",
  intervalMinutes = 15,
  flowStyle = "bar",
  maximumCups,
}: {
  buckets: FlowBucket[];
  chart?: "flow" | "acceleration" | "all";
  intervalMinutes?: BucketMinutes;
  flowStyle?: "bar" | "line";
  maximumCups?: number;
}) {
  // 深夜の空の枠は省略するが、営業中のゼロの枠は残す。
  const first = buckets.findIndex((b) => b.received || b.served || b.backlog);
  const data = (
    first < 0 ? buckets.slice(-8) : buckets.slice(Math.max(0, first - 1))
  ).map((b) => ({
    ...b,
    clock: `${jstDate(b.at).slice(5)} ${jstClock(b.at).slice(0, 5)}`,
    period: b.complete ? `集計済みの${intervalMinutes}分` : "集計中",
  }));
  const peakReceived = Math.max(1, ...data.map((point) => point.received));
  return (
    <div className="space-y-4">
      {chart !== "acceleration" && (
        <>
          <p className="mt-3 flex flex-wrap gap-4 text-xs">
            <span className="font-bold text-sky-700">
              {flowStyle === "line" ? "─" : "■"} 注文
            </span>
            <span className="font-bold text-emerald-700">
              {flowStyle === "line" ? "─" : "■"} お渡し
            </span>
            <span className="font-bold text-amber-700">─ お渡し待ち</span>
          </p>
          <div
            className="h-64 w-full"
            aria-label={`${intervalMinutes}分ごとの注文・お渡し・お渡し待ちの杯数`}
          >
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={data}
                accessibilityLayer
                margin={{ top: 12, right: 16, bottom: 26, left: 16 }}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="clock"
                  minTickGap={30}
                  label={{
                    value: "時間枠の開始（JST）",
                    position: "bottom",
                    offset: 4,
                  }}
                />
                <YAxis
                  allowDecimals={false}
                  domain={[0, maximumCups ?? "auto"]}
                  label={{
                    value: "杯数（杯）",
                    angle: -90,
                    position: "insideLeft",
                  }}
                />
                <Tooltip
                  labelFormatter={(_, payload) =>
                    `${payload[0]?.payload.clock ?? ""}〜 / ${payload[0]?.payload.period ?? ""}`
                  }
                />
                {flowStyle === "line" ? (
                  <>
                    <Line
                      type="linear"
                      dataKey="received"
                      name="注文（杯）"
                      stroke="#0284c7"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      isAnimationActive={false}
                    />
                    <Line
                      type="linear"
                      dataKey="served"
                      name="お渡し（杯）"
                      stroke="#0d9488"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      isAnimationActive={false}
                    />
                  </>
                ) : (
                  <>
                    <Bar
                      dataKey="received"
                      name="注文（杯）"
                      fill="#38bdf8"
                      isAnimationActive={false}
                    />
                    <Bar
                      dataKey="served"
                      name="お渡し（杯）"
                      fill="#0d9488"
                      isAnimationActive={false}
                    />
                  </>
                )}
                <Line
                  type="linear"
                  dataKey="backlog"
                  name={`${intervalMinutes}分の終わりのお渡し待ち（杯）`}
                  stroke="#f59e0b"
                  strokeWidth={2}
                  dot={flowStyle === "line" ? { r: 3 } : false}
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
      {chart !== "flow" &&
        (["net", "acceleration"] as const).map((metric) => (
          <div key={metric}>
            <p className="font-bold text-xs">
              {metric === "net" ? "待ちの増減" : "待ちの増え方の変化"}
            </p>
            <div
              className="h-52 w-full"
              aria-label={`待ちの増え方の変化。前の${intervalMinutes}分との比較`}
            >
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={data}
                  accessibilityLayer
                  margin={{ top: 12, right: 16, left: 24, bottom: 26 }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="clock"
                    minTickGap={30}
                    label={{
                      value: "時間枠の開始（JST）",
                      position: "bottom",
                      offset: 4,
                    }}
                  />
                  <YAxis
                    label={{
                      value:
                        metric === "net"
                          ? `杯/${intervalMinutes}分`
                          : `杯/${intervalMinutes}分²`,
                      angle: -90,
                      position: "insideLeft",
                      offset: -12,
                    }}
                  />
                  <Tooltip />
                  <ReferenceLine y={0} stroke="#64748b" />
                  {metric === "acceleration" && (
                    <Bar
                      dataKey="acceleration"
                      name={`待ちの増え方の変化（杯/${intervalMinutes}分²）`}
                      isAnimationActive={false}
                      radius={[4, 4, 0, 0]}
                    >
                      {data.map((bucket) => (
                        <Cell
                          key={bucket.at}
                          fill={
                            (bucket.acceleration ?? 0) > 0
                              ? "#f97316"
                              : "#0d9488"
                          }
                        />
                      ))}
                    </Bar>
                  )}
                  {metric === "net" && (
                    <Line
                      dataKey="net"
                      name={`待ちの増減（杯/${intervalMinutes}分）`}
                      stroke="#64748b"
                      dot={false}
                      isAnimationActive={false}
                    />
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        ))}
      <ChartValues
        columns={[
          "時間枠（JST）",
          "枠の状態",
          "注文（杯）",
          "お渡し（杯）",
          "枠末の待ち（杯）",
          `待ちの増減（杯/${intervalMinutes}分）`,
          `増減の前枠との差（杯/${intervalMinutes}分²）`,
        ]}
        rows={data.map((b) => [
          b.clock,
          b.period,
          b.received,
          b.served,
          b.backlog,
          b.net,
          b.acceleration,
        ])}
      />
      {chart === "acceleration" && (
        <p className="text-stone-600 text-xs">
          <span className="font-bold text-orange-700">
            オレンジ：待ちが増える方向へ
          </span>{" "}
          ／{" "}
          <span className="font-bold text-teal-700">緑：待ちが減る方向へ</span>
          。灰色の線は待ちの増減です。
        </p>
      )}
      {chart === "flow" && (
        <details className="rounded-xl bg-stone-50 p-3">
          <summary className="cursor-pointer font-bold text-sm">
            注文が集中した{intervalMinutes}分を見る
          </summary>
          <p className="my-2 text-stone-500 text-xs">
            濃い青ほど注文が多い時間。各枠に杯数を表示します。
          </p>
          <div
            className="grid gap-1.5"
            style={{
              gridTemplateColumns: "repeat(auto-fit, minmax(86px, 1fr))",
            }}
          >
            {data.map((bucket) => (
              <div
                key={bucket.at}
                title={`${bucket.clock}〜 注文${bucket.received}杯`}
                className="rounded-lg border border-sky-100 p-2 text-center"
                style={{
                  backgroundColor: `rgba(14, 165, 233, ${0.05 + (0.55 * bucket.received) / peakReceived})`,
                }}
              >
                <span className="block text-[10px] text-slate-700">
                  {bucket.clock}
                </span>
                <strong className="text-sm">{bucket.received}杯</strong>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
