import { jstDate } from "@cafeore/common";
import { useMemo, useState } from "react";
import {
  type AnalysisOrder,
  type TimeWindow,
  dayWindow,
  operationsReport,
} from "~/lib/analytics/operations";
import { snapshotAnalysisOrders } from "~/lib/analytics/snapshotComparison";
import { ChartValues } from "./ChartValues";

export function SnapshotComparison({
  current,
  window,
}: { current: ReturnType<typeof operationsReport>; window: TimeWindow }) {
  const [orders, setOrders] = useState<AnalysisOrder[]>([]);
  const [date, setDate] = useState("");
  const [filename, setFilename] = useState("");
  const [failure, setFailure] = useState("");
  const days = [...new Set(orders.map((o) => jstDate(o.created)))].sort();
  const selected = days.includes(date) ? date : days[0];
  const reference = useMemo(() => {
    if (!selected) return null;
    const start =
      dayWindow(selected, window.now).start +
      window.start -
      dayWindow(jstDate(window.start), window.now).start;
    return operationsReport(orders, {
      start,
      end: start + Math.max(0, Math.min(window.end, window.now) - window.start),
      now: Number.POSITIVE_INFINITY,
    });
  }, [selected, orders, window]);
  const names = [
    ...new Set([
      ...current.products.map((p) => p.name),
      ...(reference?.products.map((p) => p.name) ?? []),
    ]),
  ].sort();
  return (
    <section className="space-y-3 border-stone-200 border-t pt-6">
      <h3 className="font-black text-lg">手元の過去JSONと商品別杯数を比較</h3>
      <p className="text-sm text-stone-600">
        旧画面のorders配列を含む注文JSON、または2025年形式を読み込めます。端末内で処理し、サーバーには送りません。選択日と同じ時刻・観測済みの長さを比較します。
      </p>
      <label className="block text-sm">
        比較用の過去JSON{" "}
        <input
          type="file"
          className="mt-2 block max-w-full"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            try {
              const next = snapshotAnalysisOrders(await file.text());
              setOrders(next);
              setDate("");
              setFilename(file.name);
              setFailure("");
            } catch (err) {
              setFailure(
                err instanceof Error ? err.message : "読み込めませんでした。",
              );
            }
            e.target.value = "";
          }}
        />
      </label>
      {failure && (
        <p role="alert" className="text-red-700 text-sm">
          {failure}
        </p>
      )}
      {selected && (
        <>
          <label className="block text-sm">
            過去データの比較開始日{" "}
            <select
              aria-label="過去JSONの比較開始日"
              className="ml-2 min-h-10 rounded border p-2"
              value={selected}
              onChange={(e) => setDate(e.target.value)}
            >
              {days.map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
          </label>
          <p className="text-stone-500 text-xs">
            {filename} /
            商品名が同じものだけ同じ行に表示。旧商品の自動的な読み替えや1杯を複数商品への展開はしません。取消は除外し、グッズは杯数に含みません。杯別記録がない旧形式は構成数量から展開した注文打刻由来の参考値です。記録形式や商品構成の違いを考慮して比較してください。
          </p>
          <div className="overflow-auto">
            <table className="w-full text-left text-sm tabular-nums">
              <thead>
                <tr>
                  <th className="p-2">商品</th>
                  <th className="p-2">選択期間（杯）</th>
                  <th className="p-2">過去の同時間帯（杯）</th>
                </tr>
              </thead>
              <tbody>
                {names.map((name) => (
                  <tr key={name} className="border-t">
                    <th scope="row" className="p-2">
                      {name}
                    </th>
                    <td className="p-2">
                      {current.products.find((p) => p.name === name)
                        ?.received ?? 0}
                    </td>
                    <td className="p-2">
                      {reference?.products.find((p) => p.name === name)
                        ?.received ?? 0}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ChartValues
            columns={["指標", "選択期間", "過去の同時間帯"]}
            rows={[
              ["請求額（円）", current.revenue, reference?.revenue ?? null],
              ["注文（件）", current.orderCount, reference?.orderCount ?? null],
            ]}
          />
        </>
      )}
    </section>
  );
}
