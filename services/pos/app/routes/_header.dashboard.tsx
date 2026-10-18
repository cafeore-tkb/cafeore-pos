import { type OrderEntity, jstClock, jstDate } from "@cafeore/common";
import { CalendarRange, Upload } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import type { MetaFunction } from "react-router";
import { ItemBarChart } from "~/components/organisms/dashboard/ItemBarChart";
import { OrderList } from "~/components/organisms/dashboard/OrderList";
import { OperationsDashboard } from "~/components/organisms/dashboard/operations/OperationsDashboard";
import { Input } from "~/components/ui/input";
import { dayWindow } from "~/lib/analytics/operations";
import { useFileUpload } from "~/lib/fileUpload";
import { useOrdersWSContext } from "./context/OrdersWSContext";

export const meta: MetaFunction = () => {
  return [{ title: "注文状況 / 珈琲・俺POS" }];
};

export default function Dashboard() {
  const { orders, allOrders, isOrdersLoaded } = useOrdersWSContext();
  const [pastOrders, setPastOrders] = useState<OrderEntity[]>();
  const [pastDate, setPastDate] = useState("");
  const pastDays = useMemo(
    () =>
      [
        ...new Set(
          (pastOrders ?? []).flatMap((order) => {
            const at = new Date(order.createdAt).getTime();
            return Number.isFinite(at) ? [jstDate(at)] : [];
          }),
        ),
      ].sort(),
    [pastOrders],
  );
  const referenceDate = pastDays.includes(pastDate) ? pastDate : pastDays[0];
  const { handleFileUpload } = useFileUpload(
    useCallback(
      (sortedPastOrders: OrderEntity[]) => setPastOrders(sortedPastOrders),
      [],
    ),
  );

  return (
    <div className="min-h-[calc(100vh-0.5rem)] bg-stone-100/80 p-2 sm:p-4 lg:p-6">
      <div className="mx-auto max-w-[1600px]">
        <OperationsDashboard
          additionalPanels={(period) => {
            const cutoff = Math.min(period.end, period.now);
            const selectedOrders = orders?.filter(
              (order) =>
                order.createdAt.getTime() >= period.start &&
                order.createdAt.getTime() < cutoff,
            );
            // 過去年の開始日へ同じ時刻を移し、今年の観測済み期間と同じ長さだけ比較する。
            const referenceStart = referenceDate
              ? dayWindow(referenceDate, period.now).start +
                period.start -
                dayWindow(jstDate(period.start), period.now).start
              : null;
            const referenceEnd =
              referenceStart === null
                ? null
                : referenceStart + Math.max(0, cutoff - period.start);
            const selectedPastOrders =
              referenceStart === null || referenceEnd === null
                ? undefined
                : pastOrders?.filter(
                    (order) =>
                      new Date(order.createdAt).getTime() >= referenceStart &&
                      new Date(order.createdAt).getTime() < referenceEnd,
                  );
            return [
              {
                id: "itemBar",
                name: "商品ごとの杯数",
                content: (
                  <>
                    <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-stone-200 bg-stone-50/80 p-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex items-start gap-3">
                        <span className="rounded-xl bg-white p-2 text-teal-800 shadow-sm ring-1 ring-stone-200">
                          <Upload className="h-5 w-5" aria-hidden="true" />
                        </span>
                        <div>
                          <p className="font-bold text-sm">過去データと比較</p>
                          <p className="mt-1 text-stone-500 text-xs">
                            JSONファイルを読み込むと、同じ時間帯・同じ長さで比較します。
                          </p>
                        </div>
                      </div>
                      <label
                        htmlFor="item-comparison-file"
                        className="shrink-0 text-sm"
                      >
                        <span className="sr-only">比較用の過去データ</span>
                        <Input
                          id="item-comparison-file"
                          className="w-full cursor-pointer bg-white sm:w-72"
                          type="file"
                          accept=".json"
                          onChange={handleFileUpload}
                        />
                      </label>
                    </div>
                    {pastDays.length > 0 && (
                      <label className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-teal-100 bg-teal-50/70 p-3 text-sm">
                        <CalendarRange
                          className="h-5 w-5 text-teal-700"
                          aria-hidden="true"
                        />
                        <span className="font-bold">比較開始日</span>
                        <select
                          aria-label="商品ごとの杯数の過去比較開始日"
                          className="min-h-10 rounded-lg border border-teal-200 bg-white px-3 py-2"
                          value={referenceDate}
                          onChange={(event) => setPastDate(event.target.value)}
                        >
                          {pastDays.map((day) => (
                            <option key={day}>{day}</option>
                          ))}
                        </select>
                        {referenceStart !== null && referenceEnd !== null && (
                          <span>
                            {jstDate(referenceStart)}{" "}
                            {jstClock(referenceStart).slice(0, 5)}〜
                            {jstDate(referenceEnd)}{" "}
                            {jstClock(referenceEnd).slice(0, 5)}
                            （終了は含まない）
                          </span>
                        )}
                      </label>
                    )}
                    <ItemBarChart
                      orders={selectedOrders}
                      pastOrders={selectedPastOrders}
                    />
                  </>
                ),
              },
              {
                id: "orderList",
                name: "注文記録",
                content: (
                  <OrderList
                    orders={
                      isOrdersLoaded
                        ? allOrders.filter(
                            (order) =>
                              order.createdAt.getTime() >= period.start &&
                              order.createdAt.getTime() < cutoff,
                          )
                        : undefined
                    }
                  />
                ),
              },
            ];
          }}
        />
      </div>
    </div>
  );
}
