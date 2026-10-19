import { ArrowDownRight, ArrowUpRight, Coffee, Timer } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { operationsReport } from "~/lib/analytics/operations";
import { ChartValues } from "./ChartValues";

type Report = ReturnType<typeof operationsReport>;
const WAIT_BANDS = [
  { name: "5分未満", from: 0, to: 5, color: "#0d9488" },
  { name: "5〜10分", from: 5, to: 10, color: "#60a5fa" },
  { name: "10〜15分", from: 10, to: 15, color: "#fbbf24" },
  { name: "15〜20分", from: 15, to: 20, color: "#f97316" },
  {
    name: "20分以上",
    from: 20,
    to: Number.POSITIVE_INFINITY,
    color: "#e11d48",
  },
];

/** 現在（過去の期間なら期間末）の未提供だけで分ける。提供流量との比率は作らない。 */
export function OverviewVisuals({
  report,
  onSelect,
  compact = false,
}: { report: Report; onSelect: (view: string) => void; compact?: boolean }) {
  const waiting = WAIT_BANDS.map((band) => ({
    ...band,
    value: report.longest.filter(
      (cup) => cup.minutes >= band.from && cup.minutes < band.to,
    ).length,
  }));
  const net = report.latest?.net;
  const change = report.latest?.acceleration;
  const rising = net !== undefined && net > 0;
  const TrendIcon =
    net === undefined ? Coffee : rising ? ArrowUpRight : ArrowDownRight;
  const longest = report.longest[0]?.minutes;
  const products = report.products
    .map((product) => ({ name: product.name, cups: product.received }))
    .sort((a, b) => b.cups - a.cups);
  return (
    <div className="space-y-4">
      <div
        className={`flex flex-wrap items-center justify-between gap-4 border-l-2 pl-4 ${net === undefined ? "border-stone-200" : rising ? "border-orange-400" : "border-teal-500"}`}
      >
        <div className="flex items-center gap-3">
          <span
            className={`py-2 ${rising ? "text-orange-600" : "text-teal-700"}`}
          >
            <TrendIcon className="h-7 w-7" />
          </span>
          <div>
            <p className="text-stone-600 text-xs">
              直近の{report.intervalMinutes}分・集計済み
            </p>
            <h4 className="mt-1 font-bold text-lg">
              {net === undefined
                ? "集計がたまると混み具合を表示します"
                : net > 0
                  ? "待っている杯数が増えています"
                  : net < 0
                    ? "待ちを減らせています"
                    : "待っている杯数は横ばいです"}
            </h4>
            <p className="mt-1 text-sm">
              {net === undefined
                ? `最初の${report.intervalMinutes}分が終わるまでお待ちください。`
                : `待ちの増減 ${net > 0 ? "+" : ""}${net}杯`}
              {change !== undefined &&
                change !== null &&
                ` ／ 前の${report.intervalMinutes}分との差 ${change > 0 ? "+" : ""}${change}杯`}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => onSelect("acceleration")}
          className="min-h-10 font-bold text-sm underline underline-offset-4"
        >
          混雑のグラフ →
        </button>
      </div>
      <div className={`grid min-w-0 gap-4 ${compact ? "" : "xl:grid-cols-2"}`}>
        <section className="min-w-0 border-stone-200 border-t pt-5">
          <div className="flex items-center justify-between gap-2">
            <h4 className="flex items-center gap-2 font-bold">
              <Timer className="h-4 w-4 text-orange-600" />
              待っている杯数
            </h4>
            <span className="font-bold text-stone-600 text-xs">
              最長 {longest === undefined ? "—" : `${longest.toFixed(1)}分`}
            </span>
          </div>
          <p className="mt-1 text-stone-500 text-xs">
            期間末の待ち時間。開始前からの注文も含みます。
          </p>
          {report.longest.length ? (
            <>
              <div
                className="relative h-56"
                aria-label={`待ち時間別の未提供${report.longest.length}杯`}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={waiting}
                      dataKey="value"
                      nameKey="name"
                      innerRadius="64%"
                      outerRadius="85%"
                      paddingAngle={3}
                      isAnimationActive={false}
                    >
                      {waiting.map((band) => (
                        <Cell key={band.name} fill={band.color} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value) => [`${value}杯`, "待ち"]} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <span className="font-bold text-4xl tabular-nums">
                    {report.longest.length}
                    <span className="ml-1 text-base">杯</span>
                  </span>
                  <span className="mt-1 text-stone-500 text-xs">
                    お渡し待ち
                  </span>
                </div>
              </div>
              <ChartValues
                columns={["待ち時間区間", "未提供（杯）"]}
                rows={waiting.map((b) => [b.name, b.value])}
              />
              <ul className="grid grid-cols-2 gap-2 text-xs">
                {waiting.map((band) => (
                  <li key={band.name} className="flex items-center gap-2 py-2">
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: band.color }}
                    />
                    <span className="flex-1">{band.name}</span>
                    <strong>{band.value}杯</strong>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <div className="flex min-h-56 flex-col items-center justify-center gap-2 text-teal-700">
              <Coffee className="h-10 w-10" />
              <strong>お渡し待ちはありません</strong>
              <span className="text-stone-500 text-xs">
                この期間末までに受けた注文が対象です。
              </span>
            </div>
          )}
        </section>
        <section className="min-w-0 border-stone-200 border-t pt-5">
          <h4 className="flex items-center gap-2 font-bold">
            <Coffee className="h-4 w-4 text-sky-600" />
            よく出たドリンク
          </h4>
          <p className="mt-1 text-stone-500 text-xs">
            期間内の注文・取消を除く。杯数順。
          </p>
          {products.length ? (
            <div
              style={{ height: Math.max(224, products.length * 38) }}
              className="mt-4"
              aria-label="商品ごとの注文杯数"
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={products}
                  layout="vertical"
                  accessibilityLayer
                  margin={{ top: 8, left: 16, right: 20, bottom: 28 }}
                >
                  <CartesianGrid
                    horizontal={false}
                    stroke="#e7e5e4"
                    strokeDasharray="3 3"
                  />
                  <XAxis
                    type="number"
                    label={{
                      value: "注文杯数（杯）",
                      position: "bottom",
                      offset: 4,
                    }}
                    allowDecimals={false}
                    unit="杯"
                    tick={{ fontSize: 11 }}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    label={{
                      value: "商品",
                      angle: -90,
                      position: "insideLeft",
                      offset: -12,
                    }}
                    width={96}
                    tick={{ fontSize: 11 }}
                  />
                  <Tooltip
                    formatter={(value) => [`${value}杯`, "注文"]}
                    cursor={{ fill: "#f5f5f4" }}
                  />
                  <Bar
                    dataKey="cups"
                    fill="#0284c7"
                    radius={[0, 6, 6, 0]}
                    maxBarSize={24}
                    isAnimationActive={false}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="py-16 text-center text-sm text-stone-500">
              この期間の注文はありません。
            </p>
          )}
          <ChartValues
            columns={["商品", "注文（杯）"]}
            rows={products.map((p) => [p.name, p.cups])}
          />
          <button
            type="button"
            onClick={() => onSelect("duration")}
            className="mt-3 min-h-10 font-bold text-sm text-teal-800"
          >
            商品ごとの待ち時間を見る →
          </button>
        </section>
      </div>
    </div>
  );
}

/** 各区間の中央値を並列表示する。中央値同士を足して総時間にはしない。 */
export function ProductTimeChart({
  products,
}: { products: Report["products"] }) {
  const data = products.map((product) => ({
    name: product.name,
    prep: product.prep.p50,
    handoff: product.handoff.p50,
    total: product.total.p50,
    prepCount: product.prep.count,
    handoffCount: product.handoff.count,
    totalCount: product.total.count,
  }));
  if (!data.length)
    return (
      <p className="py-8 text-center text-stone-500">
        この期間のデータはありません。
      </p>
    );
  return (
    <div>
      <div
        style={{ height: Math.max(260, data.length * 74) }}
        aria-label="商品別の注文から準備完了・準備完了からお渡し・全体の時間の真ん中の値"
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            layout="vertical"
            accessibilityLayer
            margin={{ top: 8, left: 16, right: 20, bottom: 28 }}
          >
            <CartesianGrid
              horizontal={false}
              strokeDasharray="3 3"
              stroke="#e7e5e4"
            />
            <XAxis
              type="number"
              unit="分"
              domain={[0, "auto"]}
              label={{
                value: "所要時間の中央値（分）",
                position: "bottom",
                offset: 4,
              }}
              tick={{ fontSize: 11 }}
            />
            <YAxis
              dataKey="name"
              label={{
                value: "商品",
                angle: -90,
                position: "insideLeft",
                offset: -12,
              }}
              type="category"
              width={96}
              tick={{ fontSize: 11 }}
            />
            <Tooltip
              formatter={(value, name) => [
                typeof value === "number"
                  ? `${value.toFixed(1)}分`
                  : "記録なし",
                name,
              ]}
            />
            <Legend
              verticalAlign="top"
              wrapperStyle={{ fontSize: 11 }}
              height={60}
            />
            <Bar
              dataKey="prep"
              name="注文→準備完了"
              fill="#38bdf8"
              radius={[0, 4, 4, 0]}
              isAnimationActive={false}
            />
            <Bar
              dataKey="handoff"
              name="準備完了→お渡し"
              fill="#fbbf24"
              radius={[0, 4, 4, 0]}
              isAnimationActive={false}
            />
            <Bar
              dataKey="total"
              name="注文→お渡し"
              fill="#0d9488"
              radius={[0, 4, 4, 0]}
              isAnimationActive={false}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ChartValues
        columns={[
          "商品",
          "注文→準備完了（分）",
          "準備完了記録（杯）",
          "準備完了→提供（分）",
          "準備完了→提供の記録（杯）",
          "注文→提供（分）",
          "提供記録（杯）",
        ]}
        rows={data.map((p) => [
          p.name,
          p.prep,
          p.prepCount,
          p.handoff,
          p.handoffCount,
          p.total,
          p.totalCount,
        ])}
      />
    </div>
  );
}

export function ProductCupChart({
  products,
}: { products: Report["products"] }) {
  const data = [...products].sort((a, b) => b.received - a.received);
  if (!data.length)
    return <p className="py-6 text-sm">この期間の注文はありません。</p>;
  return (
    <div>
      <div style={{ height: Math.max(240, data.length * 40 + 60) }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            layout="vertical"
            accessibilityLayer
            margin={{ top: 12, right: 20, bottom: 28, left: 20 }}
          >
            <CartesianGrid horizontal={false} strokeDasharray="3 3" />
            <XAxis
              type="number"
              domain={[0, "auto"]}
              allowDecimals={false}
              label={{ value: "注文杯数（杯）", position: "bottom", offset: 4 }}
            />
            <YAxis
              type="category"
              dataKey="name"
              width={100}
              tick={{ fontSize: 11 }}
              label={{
                value: "商品",
                angle: -90,
                position: "insideLeft",
                offset: -16,
              }}
            />
            <Tooltip formatter={(v) => [`${v}杯`, "注文"]} />
            <Bar
              dataKey="received"
              name="注文杯数"
              fill="#0284c7"
              isAnimationActive={false}
              maxBarSize={26}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ChartValues
        columns={["商品", "注文杯数（杯）"]}
        rows={data.map((p) => [p.name, p.received])}
      />
    </div>
  );
}
