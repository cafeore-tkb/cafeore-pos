import { jstClock } from "@cafeore/common";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TrendPoint } from "~/lib/analytics/stackModel";
import type { STACK_MODEL } from "~/lib/readyTimeEstimate";
import { ChartValues } from "../operations/ChartValues";

const COLOR = "#0f766e";
const FIXED_COLOR = "#b45309";

const REASONS: Record<NonNullable<TrendPoint["reason"]>, string> = {
  insufficient: "当てはめ不能（件数不足）",
  "no-convergence": "当てはめ不能（収束しない）",
};

const clock = (point: TrendPoint) =>
  `${jstClock(point.asOf).slice(0, 5)}${point.partial ? "（途中）" : ""}`;

export function StackModelTrend({
  points,
  fixed,
}: {
  points: TrendPoint[];
  fixed: typeof STACK_MODEL;
}) {
  if (!points.some((p) => p.a1 !== null)) {
    return (
      <p className="text-sm text-stone-500">
        当てはめ可能な時点がまだありません
      </p>
    );
  }
  const charts = [
    { valueKey: "a1", label: "a1（杯）", fixed: fixed.a1 },
    { valueKey: "c1", label: "c1（分）", fixed: fixed.c1 },
    {
      valueKey: "b",
      label: "b（分/杯）",
      fixed: fixed.b1 + fixed.c1 / fixed.nStaff,
    },
  ] as const;
  return (
    <div className="grid min-w-0 gap-6 xl:grid-cols-3">
      {charts.map((chart) => (
        <TrendChart key={chart.valueKey} points={points} {...chart} />
      ))}
    </div>
  );
}

function TrendChart({
  points,
  valueKey,
  label,
  fixed,
}: {
  points: TrendPoint[];
  valueKey: "a1" | "c1" | "b";
  label: string;
  fixed: number;
}) {
  const data = points.map((p) => ({
    time: clock(p),
    value: p[valueKey],
    partial: p.partial,
  }));
  return (
    <section className="min-w-0" aria-label={`${label}の推移`}>
      <h4 className="font-bold text-sm">{label}</h4>
      <div className="mt-2 h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            accessibilityLayer
            margin={{ top: 12, right: 12, left: 16, bottom: 26 }}
          >
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="time"
              label={{ value: "時刻（JST）", position: "bottom", offset: 6 }}
              tickLine={false}
              minTickGap={24}
            />
            <YAxis
              domain={["auto", "auto"]}
              label={{
                value: label,
                angle: -90,
                position: "insideLeft",
                offset: -4,
              }}
              tickLine={false}
              width={44}
              tickFormatter={(value: number) =>
                String(Number(value.toPrecision(3)))
              }
            />
            <Tooltip
              formatter={(value: number) => [value.toPrecision(3), label]}
            />
            <ReferenceLine
              y={fixed}
              stroke={FIXED_COLOR}
              strokeDasharray="6 4"
              ifOverflow="extendDomain"
              label={{
                value: "固定モデル",
                position: "insideTopRight",
                fill: FIXED_COLOR,
                fontSize: 11,
              }}
            />
            <Line
              dataKey="value"
              name={label}
              type="linear"
              stroke={COLOR}
              strokeWidth={2}
              connectNulls={false}
              isAnimationActive={false}
              dot={(props: {
                cx?: number;
                cy?: number;
                index?: number;
                payload?: { partial: boolean; value: number | null };
              }) => (
                <circle
                  key={`dot-${props.index}`}
                  cx={props.cx}
                  cy={props.cy}
                  r={props.payload?.value === null ? 0 : 3}
                  stroke={COLOR}
                  strokeWidth={1.5}
                  fill={props.payload?.partial ? "#fff" : COLOR}
                />
              )}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <ChartValues
        columns={["時刻（JST）", "件数", label]}
        rows={points.map((p) => [
          clock(p),
          p.nObs,
          p[valueKey] === null
            ? REASONS[p.reason ?? "insufficient"]
            : (p[valueKey] as number).toPrecision(3),
        ])}
      />
    </section>
  );
}
