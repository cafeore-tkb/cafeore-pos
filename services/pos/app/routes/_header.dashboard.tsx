import { type OrderEntity, jstClock, jstDate } from "@cafeore/common";
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
    <div className="h-full">
      <div className="p-4">
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
                    <label
                      htmlFor="item-comparison-file"
                      className="mb-3 flex flex-wrap items-center gap-2 text-sm"
                    >
                      比較用の過去データ
                      <Input
                        id="item-comparison-file"
                        className="w-60"
                        type="file"
                        accept=".json"
                        onChange={handleFileUpload}
                      />
                    </label>
                    <p className="mb-3 text-sm">
                      この期間の注文を表示します。過去側は、下の開始日から同じ時間帯・同じ長さで比べます。
                    </p>
                    {pastDays.length > 0 && (
                      <label className="mb-3 flex flex-wrap items-center gap-2 text-sm">
                        過去データの比較開始日
                        <select
                          aria-label="商品ごとの杯数の過去比較開始日"
                          className="min-h-10 rounded border bg-white p-2"
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
