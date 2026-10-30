import {
  INVENTORY_REFRESH_MS,
  type ItemType,
  type OrderEntity,
  inventoryRepository,
  jstDate,
} from "@cafeore/common";
import { useEffect, useId, useMemo, useState } from "react";
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
import useSWR from "swr";
import { z } from "zod";
import { Input } from "~/components/ui/input";
import { dayWindow } from "~/lib/analytics/operations";
import {
  type StockoutRow,
  forecastOrders,
  outsideFitTimes,
  stockoutParams,
  stockoutRows,
  unknownItems,
} from "~/lib/analytics/stockoutForecast";

// 開店・閉店予定は日付ごとにこの端末へ保存する（T-93 判断 6）
const HOURS_KEY = "dashboard:stockout-hours:v1";
// 保存が無い日の初期値（祭の営業時間）。欄を空にすれば、開店は初回注文になる
const DEFAULT_HOURS = { open: "10:00", close: "17:00" };
const hoursSchema = z.record(z.object({ open: z.string(), close: z.string() }));
type SavedHours = z.infer<typeof hoursSchema>;
const readHours = (): SavedHours => {
  try {
    const raw = window.localStorage.getItem(HOURS_KEY);
    const parsed = hoursSchema.safeParse(raw ? JSON.parse(raw) : {});
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
};
const clockAt = (date: string, clock: string) =>
  /^([01]\d|2[0-3]):[0-5]\d$/.test(clock)
    ? Date.parse(`${date}T${clock}:00+09:00`)
    : null;
const hhmm = (ms: number) =>
  new Date(ms + 9 * 3_600_000).toISOString().slice(11, 16);
const percent = (p: number) =>
  p > 0 && p < 0.001 ? "0.1%未満" : `${(p * 100).toFixed(1)}%`;

// 在庫 API の残量は応答した時点のもの。その時刻（tau）より後に提供可能になった杯を引くために、取得した時刻を残す
const fetchInventory = async () => ({
  statuses: await inventoryRepository.getStatuses(),
  at: Date.now(),
});

const LEVELS = [0.8, 0.9, 0.95];
const CURVE_HEADROOM = 1.15;

export function StockoutForecast({
  orders,
  now,
  date,
  itemTypes,
}: {
  orders: readonly OrderEntity[];
  now: number;
  date: string;
  itemTypes: readonly ItemType[];
}) {
  const fieldId = useId();
  const [saved, setSaved] = useState<SavedHours>({});
  useEffect(() => setSaved(readHours()), []);
  const entry = saved[date] ?? DEFAULT_HOURS;
  const update = (field: "open" | "close", value: string) => {
    const next = { ...saved, [date]: { ...entry, [field]: value } };
    setSaved(next);
    try {
      window.localStorage.setItem(HOURS_KEY, JSON.stringify(next));
    } catch {
      // 保存できない端末でも、その場の入力では見込みを出す
    }
  };
  const { data: inventory, error: inventoryError } = useSWR(
    "inventory:stockout-forecast",
    fetchInventory,
    { refreshInterval: INVENTORY_REFRESH_MS },
  );
  const day = dayWindow(date, now);
  const dayOrders = useMemo(
    () =>
      forecastOrders(orders).filter(
        (o) => o.created >= day.start && o.created < day.end,
      ),
    [orders, day.start, day.end],
  );
  const itemTypeNames = useMemo(
    () =>
      new Map(
        itemTypes.flatMap((t) => (t.id ? [[t.id, t.name] as const] : [])),
      ),
    [itemTypes],
  );
  const firstOrder = dayOrders.length
    ? Math.min(...dayOrders.map((o) => o.created))
    : null;
  const open = entry.open ? clockAt(date, entry.open) : firstOrder;
  const close = entry.close ? clockAt(date, entry.close) : null;
  const problem =
    date !== jstDate(now)
      ? "見込みは当日だけ出します（在庫は現在の値のため）。"
      : close === null
        ? "閉店予定を入れると見込みを出します。"
        : open === null
          ? "まだ注文がありません。開店の時刻を入れてください。"
          : close <= open
            ? "閉店予定が開店より前です。"
            : now < open
              ? "開店前です。"
              : now > close
                ? "閉店予定を過ぎています。"
                : null;
  const rows =
    problem === null && open !== null && close !== null
      ? stockoutRows({
          orders: dayOrders,
          statuses: inventory?.statuses ?? [],
          itemTypeNames,
          tau: inventory?.at ?? now,
          hours: { open, close },
          t: now,
        })
      : [];
  const unknown = unknownItems(dayOrders);

  return (
    <section className="space-y-3 border-stone-200 border-t pt-6">
      <h3 className="font-bold">閉店までに在庫が切れる確率（目安）</h3>
      <p className="text-sm">
        いまのペースが閉店まで続くとして、閉店までに受ける杯数の分布から、在庫が切れる確率を出します。受けた杯数（売れた量）の見込みで、来店したかった人の数ではありません。グルメ豆・限定は銘柄ごとの見込みを持たないため出しません（ホットのカップと合計には入ります）。
      </p>
      <div className="flex flex-wrap items-end gap-4 bg-stone-50 p-3 text-sm">
        <div className="space-y-1">
          <label
            htmlFor={`${fieldId}-open`}
            className="block font-bold text-xs"
          >
            開店
          </label>
          <Input
            id={`${fieldId}-open`}
            type="time"
            step={60}
            value={entry.open}
            onChange={(e) => update("open", e.target.value)}
            className="w-32"
          />
          <span className="block text-stone-500 text-xs">
            {entry.open
              ? "これより前の注文は数えません"
              : firstOrder !== null
                ? `空欄なら初回注文 ${hhmm(firstOrder)}`
                : "空欄なら初回注文"}
          </span>
        </div>
        <div className="space-y-1">
          <label
            htmlFor={`${fieldId}-close`}
            className="block font-bold text-xs"
          >
            閉店予定
          </label>
          <Input
            id={`${fieldId}-close`}
            type="time"
            step={60}
            value={entry.close}
            onChange={(e) => update("close", e.target.value)}
            className="w-32"
          />
          <span className="block text-stone-500 text-xs">
            延びたら入れ直してください
          </span>
        </div>
      </div>
      {problem ? (
        <p className="text-sm text-stone-600">{problem}</p>
      ) : (
        <>
          {inventoryError && (
            <p role="alert" className="text-sm">
              在庫を取得できません。杯数の見込みだけを出します。
            </p>
          )}
          {open !== null &&
            close !== null &&
            outsideFitTimes({ open, close }, now) && (
              <p className="border-amber-500 border-l-2 pl-3 text-amber-900 text-sm">
                開店から{stockoutParams.fit_times.from_open_min}
                分以内・閉店前{stockoutParams.fit_times.until_before_close_min}
                分以内は、見込みの幅を確かめていない時間帯です。
              </p>
            )}
          {unknown.length > 0 && (
            <p className="border-amber-500 border-l-2 pl-3 text-amber-900 text-sm">
              見込みの対応表に無い商品：{unknown.join("・")}
              。どの在庫の見込みにも入れていません（ホット・アイスのカップと合計には種類で入ります）。
            </p>
          )}
          <ForecastTable rows={rows} />
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {rows.map((row) => (
              <ExceedanceCurve key={row.unit.key} row={row} />
            ))}
          </div>
        </>
      )}
      <details className="text-stone-600 text-xs">
        <summary className="cursor-pointer py-2 font-bold">
          見込みの作り方と注意
        </summary>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            閉店までに受ける杯数 R は負の二項分布。平均は「いままでの杯数 ÷
            開店からの時間 × 閉店までの時間」、まだ 0
            杯の商品は過去の祭のペースを使います。ばらつきの大きさ α
            は2024・2025年祭の4日で当てた値で、2026年では確かめていません。
          </li>
          <li>
            過去の祭の振り返りでは、開店から数時間は在庫切れを小さく見積もる傾向がありました。朝の値は割り引いて見てください。
          </li>
          <li>
            残りの在庫は在庫の残量（約{INVENTORY_REFRESH_MS / 1000}
            秒ごとに取得）から、受けたがまだ在庫から引かれていない杯（提供可能になっていない杯など）を引いた量です。淹れ直しは考えません。棚卸しの無い在庫は確率を出しません。
          </li>
          <li>
            取り消した注文：在庫は取消の時刻に使ったことになります（在庫 API
            と同じ）。杯数の見込みでは、提供可能になる前に取り消した杯を数えません。
          </li>
          <li>
            値の出どころ：sohosai-analysis {stockoutParams.commit.slice(0, 8)}（
            {stockoutParams.source.split("/blob/")[1]}）
          </li>
        </ul>
      </details>
    </section>
  );
}

function ForecastTable({ rows }: { rows: StockoutRow[] }) {
  return (
    <div className="overflow-auto">
      <table className="w-full whitespace-nowrap text-left text-sm tabular-nums">
        <thead>
          <tr>
            {[
              "見込みの単位",
              "在庫",
              "いままでの杯数",
              "閉店までの平均",
              "中央値",
              ...LEVELS.slice(1).map((q) => `${Math.round(q * 100)}%点`),
              "残りの在庫（杯）",
              "閉店までに切れる確率",
            ].map((c) => (
              <th key={c} scope="col" className="p-2">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const q = (level: number) =>
              row.quantiles.find((v) => v.q === level)?.value ?? null;
            return (
              <tr
                key={row.unit.key}
                className={`border-t ${row.alreadyOut || (row.pStockout ?? 0) >= 0.2 ? "bg-rose-50 text-rose-900" : ""}`}
              >
                <th scope="row" className="p-2">
                  {row.unit.key}
                  {row.unit.items.length > 0 && (
                    <span className="ml-1 font-normal text-stone-500 text-xs">
                      {row.unit.items.join("・")}
                    </span>
                  )}
                </th>
                <td className="p-2">{row.resource ?? "—"}</td>
                <td className="p-2">{row.forecast.n}杯</td>
                <td className="p-2">{row.forecast.mu.toFixed(1)}杯</td>
                <td className="p-2">{q(0.5)}杯</td>
                <td className="p-2">{q(0.9)}杯</td>
                <td className="p-2">{q(0.95)}杯</td>
                <td className="p-2">
                  {row.stockLeft === null ? "—" : row.stockLeft.toFixed(1)}
                </td>
                <td className="p-2 font-bold">
                  {row.pStockout === null
                    ? (row.reason ?? "—")
                    : row.alreadyOut
                      ? "すでに切れている"
                      : percent(row.pStockout)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-2 text-stone-500 text-xs">
        90%点は「残りの在庫がこれだけあれば、閉店までに切れる確率は1割以下」の杯数です。
      </p>
    </div>
  );
}

function ExceedanceCurve({ row }: { row: StockoutRow }) {
  const d = row.forecast.distribution;
  const q95 = d.quantile(0.95);
  const sMax = Math.max(
    Math.ceil(CURVE_HEADROOM * q95),
    row.stockLeft === null ? 0 : Math.ceil(row.stockLeft) + 5,
    5,
  );
  const data = Array.from({ length: sMax + 1 }, (_, s) => ({
    s,
    p: d.exceedance(s),
  }));
  return (
    <figure className="space-y-1">
      <figcaption className="font-bold text-xs">
        {row.unit.key}：残りの在庫ごとの、閉店までに切れる確率
      </figcaption>
      <div className="h-44">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            margin={{ top: 8, right: 8, bottom: 16, left: 4 }}
          >
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="s"
              type="number"
              domain={[0, sMax]}
              allowDecimals={false}
              tick={{ fontSize: 10 }}
              label={{
                value: "残りの在庫（杯）",
                position: "bottom",
                offset: 0,
                fontSize: 10,
              }}
            />
            <YAxis
              domain={[0, 1]}
              tickFormatter={(v) => `${Math.round(v * 100)}%`}
              width={40}
              tick={{ fontSize: 10 }}
            />
            <Tooltip
              labelFormatter={(s) => `残り ${s} 杯`}
              formatter={(p: number) => [percent(p), "切れる確率"]}
            />
            {LEVELS.map((q) => (
              <ReferenceLine
                key={q}
                y={1 - q}
                stroke="#a8a29e"
                strokeDasharray="2 3"
              />
            ))}
            {row.stockLeft !== null && (
              <ReferenceLine
                x={Math.max(0, row.stockLeft)}
                stroke="#be123c"
                strokeDasharray="4 3"
                label={{ value: "いまの残り", fontSize: 10, fill: "#be123c" }}
              />
            )}
            <Line
              dataKey="p"
              type="stepAfter"
              stroke="#0f766e"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
