import { useId } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { operationsReport } from "~/lib/analytics/operations";
import { ChartValues } from "./ChartValues";

type Products = ReturnType<typeof operationsReport>["products"];
const STAGES = [
  { key: "waitMean", name: "注文→抽出開始", color: "#0284c7" },
  { key: "serveMean", name: "抽出開始→提供完了", color: "#0d9488" },
] as const;
type Row = Products[number]["brewStages"] & { name: string };
const rounded = (value: number | null) =>
  value === null ? null : Number(value.toFixed(2));

/** 同じ杯の平均を積み上げる。中央値・異なる母集団の時間は加算しない。 */
export function ProductBrewTimeCharts({ products }: { products: Products }) {
  const rows: Row[] = products.map((p) => ({ name: p.name, ...p.brewStages }));
  const measured = rows.filter((row) => row.count > 0);
  const count = rows.reduce((sum, row) => sum + row.count, 0);
  const excluded = rows.reduce((sum, row) => sum + row.excluded, 0);
  const maximum = Math.max(1, ...measured.map((row) => row.totalMean ?? 0));
  return (
    <section
      className="space-y-5"
      aria-label="商品別の抽出開始で分けた提供時間"
    >
      <div>
        <h4 className="font-bold">抽出開始で分けた提供時間（平均）</h4>
        <p className="mt-2 text-stone-600 text-xs leading-relaxed">
          選択期間に受けた注文のうち、注文・抽出開始・提供完了の打刻が揃った提供済みの
          {count}杯を集計。
          3つのグラフは同じ杯・商品順・時間目盛りです。2区間の平均を足すと、注文→提供完了の平均になります。
        </p>
        <p className="mt-1 text-stone-500 text-xs leading-relaxed">
          対象外 {excluded}
          杯：開始未記録・未提供・抽出対象外・時刻不整合など。未計測を0分では補いません。
          抽出開始→提供完了には抽出・準備・お渡し待ちを含みます。元のカップの抽出開始記録を使い、入れ直しを別の抽出として合算しません。
        </p>
      </div>
      {measured.length ? (
        <>
          <StageChart
            title="注文→提供完了の内訳"
            rows={measured}
            maximum={maximum}
            stages={STAGES}
          />
          <div className="grid min-w-0 gap-6 xl:grid-cols-2">
            {STAGES.map((stage) => (
              <StageChart
                key={stage.key}
                title={stage.name}
                rows={measured}
                maximum={maximum}
                stages={[stage]}
              />
            ))}
          </div>
        </>
      ) : (
        <p className="py-6 text-sm text-stone-500">
          注文・抽出開始・提供完了の有効な記録が揃った杯がないため、グラフは表示できません。
        </p>
      )}
      <ChartValues
        columns={[
          "商品",
          "対象（杯）",
          "対象外（杯）",
          "注文→抽出開始の平均（分）",
          "抽出開始→提供完了の平均（分）",
          "注文→提供完了の平均（分）",
        ]}
        rows={rows.map((p) => [
          p.name,
          p.count,
          p.excluded,
          rounded(p.waitMean),
          rounded(p.serveMean),
          rounded(p.totalMean),
        ])}
      />
    </section>
  );
}

function StageChart({
  title,
  rows,
  maximum,
  stages,
}: {
  title: string;
  rows: Row[];
  maximum: number;
  stages: readonly (typeof STAGES)[number][];
}) {
  const id = useId();
  return (
    <section className="min-w-0" aria-labelledby={id}>
      <h5 id={id} className="font-bold text-sm">
        {title}
      </h5>
      <div
        style={{ height: Math.max(240, rows.length * 40 + 110) }}
        role="img"
        aria-label={`${title}：商品別の平均所要時間（分）`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={rows}
            layout="vertical"
            accessibilityLayer
            margin={{ top: 12, left: 16, right: 24, bottom: 28 }}
          >
            <CartesianGrid
              horizontal={false}
              strokeDasharray="3 3"
              stroke="#e7e5e4"
            />
            <XAxis
              type="number"
              domain={[0, maximum]}
              tickCount={6}
              tick={{ fontSize: 11 }}
              label={{
                value: "平均所要時間（分）",
                position: "bottom",
                offset: 4,
              }}
            />
            <YAxis
              type="category"
              dataKey="name"
              tickFormatter={(name: string) =>
                name.length > 8 ? `${name.slice(0, 8)}…` : name
              }
              width={100}
              tick={{ fontSize: 11 }}
              label={{
                value: "商品",
                angle: -90,
                position: "insideLeft",
                offset: -12,
              }}
            />
            <Tooltip
              cursor={{ fill: "#f5f5f4" }}
              content={({ active, payload }) => {
                const row = payload?.[0]?.payload as Row | undefined;
                if (!active || !row) return null;
                return (
                  <div className="border border-stone-200 bg-white p-3 text-xs shadow-sm">
                    <p className="font-bold">
                      {row.name} ／ 対象 {row.count}杯
                    </p>
                    {stages.map((stage) => (
                      <p key={stage.key} className="mt-1">
                        {stage.name}：{row[stage.key]?.toFixed(2)}分
                      </p>
                    ))}
                    {stages.length > 1 && (
                      <p className="mt-1 border-t pt-1">
                        注文→提供完了：{row.totalMean?.toFixed(2)}分
                      </p>
                    )}
                  </div>
                );
              }}
            />
            <Legend
              verticalAlign="top"
              wrapperStyle={{ fontSize: 11 }}
              height={44}
            />
            {stages.map((stage) => (
              <Bar
                key={stage.key}
                dataKey={stage.key}
                name={stage.name}
                stackId="duration"
                fill={stage.color}
                maxBarSize={24}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
