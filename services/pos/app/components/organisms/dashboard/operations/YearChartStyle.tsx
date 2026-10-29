import { useId } from "react";
import "./yearChartStyle.css";
export const CURRENT_YEAR_COLOR = "#1e40af";
export const PREVIOUS_YEAR_COLOR = "#c8e3cf";
export const PREVIOUS_YEAR_LINE = "#91bba0";

export function YearExcessGradient({
  id,
  start = 0,
  length = 1,
  vertical = false,
}: { id: string; start?: number; length?: number; vertical?: boolean }) {
  return (
    <linearGradient
      id={id}
      gradientUnits="userSpaceOnUse"
      x1={vertical ? 0 : start}
      y1={vertical ? start : 0}
      x2={vertical ? 0 : start + length}
      y2={vertical ? start - length : 0}
    >
      <stop offset="0%" className="year-excess-stop-blue" />
      <stop offset="5%" className="year-excess-stop-purple" />
      <stop offset="10%" className="year-excess-stop-pink" />
      <stop offset="17.5%" className="year-excess-stop-yellow" />
      <stop offset="25%" className="year-excess-stop-coral" />
      <stop offset="40%" className="year-excess-stop-red" />
      <stop offset="60%" className="year-excess-stop-orange" />
      <stop offset="80%" className="year-excess-stop-warm-white" />
      <stop offset="100%" className="year-excess-stop-white" />
    </linearGradient>
  );
}

/** 棒全体の長さは今年の実数。前年を超えた区間だけ別の色で描く。 */
export function CurrentYearBar({
  x = 0,
  y = 0,
  width = 0,
  height = 0,
  payload,
  gradientId,
  vertical = false,
}: {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  payload?: { current: number; previous: number | null };
  gradientId: string;
  vertical?: boolean;
}) {
  const barGradientId = `${gradientId}-${useId().replace(/:/g, "")}`;
  if (!payload || width <= 0 || height <= 0) return null;
  const ratio =
    payload.previous !== null && payload.previous > 0 && payload.current > 0
      ? Math.min(1, payload.previous / payload.current)
      : 1;
  const base = (vertical ? height : width) * ratio;
  const excess = (vertical ? height : width) - base;
  // 前年1個分の長さを100ポイントとする。110%は10%、125%は25%の位置。
  // 前年0・未対応では比率を定義できないため、通常の濃い青のまま。
  const colorLength =
    ((vertical ? height : width) / payload.current) * (payload.previous ?? 0);
  return (
    <g data-year="current">
      <defs>
        <YearExcessGradient
          id={barGradientId}
          vertical={vertical}
          start={vertical ? y + excess : x + base}
          length={colorLength}
        />
      </defs>
      <rect
        x={x}
        y={vertical ? y + excess : y}
        width={vertical ? width : base}
        height={vertical ? base : height}
        fill={CURRENT_YEAR_COLOR}
      />
      {excess > 0 && (
        <rect
          data-year-excess="true"
          x={vertical ? x : x + base}
          y={y}
          width={vertical ? width : excess}
          height={vertical ? excess : height}
          fill={`url(#${barGradientId})`}
          stroke="#94a3b8"
          strokeWidth={0.5}
        />
      )}
    </g>
  );
}

export function YearChartLegend({
  comparison = true,
}: { comparison?: boolean }) {
  return (
    <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-stone-600 text-xs">
      <span>
        <span
          aria-hidden="true"
          className="mr-1.5 inline-block h-2 w-3"
          style={{ background: CURRENT_YEAR_COLOR }}
        />
        今年
      </span>
      {comparison && (
        <>
          <span>
            <span
              aria-hidden="true"
              className="mr-1.5 inline-block h-0.5 w-4 align-middle"
              style={{ background: PREVIOUS_YEAR_LINE }}
            />
            前年・同時刻まで
          </span>
          <span>
            <span
              aria-hidden="true"
              className="year-excess-legend mr-1.5 inline-block h-2 w-3"
            />
            前年比：100% 青 → 110% ピンク → 125% コーラル → 200% 白
          </span>
        </>
      )}
    </p>
  );
}

export function YearChartTooltip({
  active,
  row,
  unit,
}: {
  active?: boolean;
  row?: {
    name: string;
    current: number;
    previous: number | null;
    members?: string[];
  };
  unit: "杯" | "円";
}) {
  if (!active || !row) return null;
  const value = (n: number) =>
    unit === "円" ? `¥${n.toLocaleString("ja-JP")}` : `${n}杯`;
  return (
    <div className="max-w-72 space-y-1 rounded border border-stone-200 bg-white p-3 text-stone-600 text-xs shadow-sm">
      <p>{row.name}</p>
      {row.members && row.members.length > 1 && <p>{row.members.join("・")}</p>}
      <p>
        今年{" "}
        <strong className="font-extrabold text-blue-950">
          {value(row.current)}
        </strong>
      </p>
      <p>
        前年{" "}
        <strong className="font-extrabold text-green-950">
          {row.previous === null ? "未対応" : value(row.previous)}
        </strong>
      </p>
      {row.previous !== null && (
        <p>
          前年差{" "}
          <strong className="font-extrabold text-blue-950">
            {row.current - row.previous > 0 ? "+" : ""}
            {value(row.current - row.previous)}
          </strong>
        </p>
      )}
    </div>
  );
}
