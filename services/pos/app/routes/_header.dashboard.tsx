import type { OrderEntity } from "@cafeore/common";
import { useCallback, useState } from "react";
import type { MetaFunction } from "react-router";
import { ItemBarChart } from "~/components/organisms/dashboard/ItemBarChart";
import { OrderStatusList } from "~/components/organisms/dashboard/MasterState";
import { OrderList } from "~/components/organisms/dashboard/OrderList";
import { ServeTimeGraph } from "~/components/organisms/dashboard/ServeTimeGraph";
import { OperationsDashboard } from "~/components/organisms/dashboard/operations/OperationsDashboard";
import { Input } from "~/components/ui/input";
import { useFileUpload } from "~/lib/fileUpload";
import { useOrdersWSContext } from "./context/OrdersWSContext";

export const meta: MetaFunction = () => {
  return [{ title: "注文状況 / 珈琲・俺POS" }];
};

export default function Dashboard() {
  const { orders, allOrders } = useOrdersWSContext();
  const unseved = orders?.reduce((acc, cur) => {
    if (cur.servedAt == null) {
      return acc + 1;
    }
    return acc;
  }, 0);

  const [pastOrders, setPastOrders] = useState<OrderEntity[]>();
  const { handleFileUpload } = useFileUpload(
    useCallback(
      (sortedPastOrders: OrderEntity[]) => setPastOrders(sortedPastOrders),
      [],
    ),
  );

  return (
    <div className="h-full">
      <div className="sticky top-0 flex justify-between p-4">
        <h1 className="w-auto whitespace-nowrap text-3xl">ダッシュボード</h1>
        <p>提供待ちオーダー数：{unseved}</p>
        <div className="flex items-center gap-2 p-2">
          <div className="whitespace-nowrap font-bold text-sm">
            <p>過去のデータを</p>
            <p>読み込む</p>
          </div>
          <Input
            className="w-60"
            type="file"
            accept=".json"
            onChange={handleFileUpload}
          />
        </div>
      </div>
      <div className="p-4">
        <OperationsDashboard
          additionalPanels={(period) => {
            const cutoff = Math.min(period.end, period.now);
            const selectedOrders = (allOrders ?? orders)?.filter(
              (order) =>
                order.createdAt.getTime() >= period.start &&
                order.createdAt.getTime() < cutoff,
            );
            const selectedPastOrders = pastOrders?.filter(
              (order) =>
                order.createdAt.getTime() >= period.start &&
                order.createdAt.getTime() < cutoff,
            );
            return [
              {
                id: "itemBar",
                name: "種類別注文数",
                content: (
                  <>
                    <p className="mb-3 text-sm">
                      選択期間に受注した注文。読み込んだ過去データも同じ日時で絞り込みます。年をまたいだ時間帯比較は「2025年との比較」で確認できます。
                    </p>
                    <ItemBarChart
                      orders={selectedOrders}
                      pastOrders={selectedPastOrders}
                    />
                  </>
                ),
              },
              {
                id: "serveTimeGraph",
                name: "提供時間推移",
                content: (
                  <>
                    <p className="mb-3 text-sm">
                      選択期間に受注した注文の、現在記録されている提供時間です。
                    </p>
                    <ServeTimeGraph orders={selectedOrders} />
                  </>
                ),
              },
              {
                id: "orderList",
                name: "注文一覧",
                content: <OrderList orders={selectedOrders} />,
              },
              {
                id: "masterState",
                name: "オーダーストップ記録",
                content: (
                  <>
                    <p className="mb-3 text-sm">
                      選択期間に記録された停止・再開です。
                    </p>
                    <OrderStatusList start={period.start} end={cutoff} />
                  </>
                ),
              },
            ];
          }}
        />
      </div>
    </div>
  );
}
