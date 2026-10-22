import {
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ScatterPoint, StackModelView } from "~/lib/analytics/stackModel";
import { ChartValues } from "../operations/ChartValues";

const COLORS = {
  actual: "#57534e",
  fit: "#0f766e",
  fixed: "#b45309",
  a1: "#7c3aed",
};
const FIXED_DASH = "6 4";

/** 注文 #番号・stack n 杯・実測 x.x 分・予測 y.y 分（固定 z.z 分） */
const pointLabel = (p: ScatterPoint) =>
  `注文 #${p.number}・stack ${p.stack} 杯・実測 ${p.minutes.toFixed(1)} 分・予測 ${
    p.predictedFit === null
      ? `${p.predictedFixed.toFixed(1)} 分（固定モデル）`
      : `${p.predictedFit.toFixed(1)} 分（固定 ${p.predictedFixed.toFixed(1)} 分）`
  }`;

function PointTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload?: unknown }[];
}) {
  const point = payload
    ?.map((item) => item.payload)
    .find(
      (p): p is ScatterPoint => !!p && typeof p === "object" && "minutes" in p,
    );
  if (!active || !point) return null;
  return (
    <div className="rounded-md border border-stone-200 bg-white px-3 py-2 text-xs tabular-nums shadow">
      {pointLabel(point)}
    </div>
  );
}

export function StackModelScatter({ view }: { view: StackModelView }) {
  const { fit, points, curve, yMax, clippedCount } = view;
  const visible = points.filter((p) => !p.clipped);
  return (
    <div>
      <div className="h-96">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            accessibilityLayer
            margin={{ top: 12, right: 16, left: 20, bottom: 26 }}
          >
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              type="number"
              dataKey="stack"
              domain={[0, "dataMax"]}
              allowDecimals={false}
              label={{
                value: "注文時点の stack（杯）",
                position: "bottom",
                offset: 6,
              }}
              tickLine={false}
            />
            <YAxis
              type="number"
              domain={[0, yMax]}
              allowDataOverflow
              label={{
                value: "提供時間（分）",
                angle: -90,
                position: "insideLeft",
                offset: -8,
              }}
              tickLine={false}
              width={42}
            />
            <Tooltip shared={false} content={<PointTooltip />} />
            <Legend
              verticalAlign="top"
              height={32}
              payload={[
                {
                  value: "実測（注文）",
                  type: "circle",
                  color: COLORS.actual,
                  id: "actual",
                },
                {
                  value: "この当てはめ（実線）",
                  type: "line",
                  color: COLORS.fit,
                  id: "fit",
                },
                {
                  value: "固定モデル（破線）",
                  type: "plainline",
                  color: COLORS.fixed,
                  id: "fixed",
                  payload: { strokeDasharray: FIXED_DASH },
                },
                ...(fit.ok
                  ? [
                      {
                        value: "折れ点 a1",
                        type: "plainline" as const,
                        color: COLORS.a1,
                        id: "a1",
                        payload: { strokeDasharray: "2 3" },
                      },
                    ]
                  : []),
              ]}
            />
            <Scatter
              name="実測（注文）"
              data={visible}
              dataKey="minutes"
              fill={COLORS.actual}
              fillOpacity={0.55}
              shape="circle"
              isAnimationActive={false}
            />
            {fit.ok && (
              <Line
                name="この当てはめ"
                data={curve}
                dataKey="fit"
                type="linear"
                stroke={COLORS.fit}
                strokeWidth={2.5}
                dot={false}
                activeDot={false}
                isAnimationActive={false}
              />
            )}
            <Line
              name="固定モデル"
              data={curve}
              dataKey="fixed"
              type="linear"
              stroke={COLORS.fixed}
              strokeWidth={2}
              strokeDasharray={FIXED_DASH}
              dot={false}
              activeDot={false}
              isAnimationActive={false}
            />
            {fit.ok && (
              <ReferenceLine
                x={fit.a1}
                stroke={COLORS.a1}
                strokeDasharray="2 3"
                label={{ value: "a1", position: "top", fill: COLORS.a1 }}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {clippedCount > 0 && (
        <p className="mt-2 text-stone-600 text-xs">
          表示範囲外に {clippedCount} 件（縦軸 {yMax}{" "}
          分超）。当てはめには含めています。
        </p>
      )}
      <ChartValues
        columns={[
          "注文番号",
          "stack（杯）",
          "実測（分）",
          "予測・当てはめ（分）",
          "予測・固定（分）",
        ]}
        rows={points.map((p) => [
          `#${p.number}`,
          p.stack,
          p.minutes.toFixed(1),
          p.predictedFit === null ? "当てはめ不能" : p.predictedFit.toFixed(1),
          p.predictedFixed.toFixed(1),
        ])}
      />
    </div>
  );
}
