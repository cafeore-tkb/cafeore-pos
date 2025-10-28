import {
  type OrderEntity,
  collectionSub,
  orderConverter,
} from "@cafeore/common";
import type { MetaFunction } from "@remix-run/react";
import { orderBy } from "firebase/firestore";
import { useCallback, useState } from "react";
import useSWRSubscription from "swr/subscription";
import { ItemBarChart } from "~/components/organisms/dashboard/ItemBarChart";
import { OrderList } from "~/components/organisms/dashboard/OrderList";
import { ServeTimeGraph } from "~/components/organisms/dashboard/ServeTimeGraph";
import { Input } from "~/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { useFileUpload } from "~/lib/fileUpload";

export const meta: MetaFunction = () => {
  return [{ title: "注文状況 / 珈琲・俺POS" }];
};

export default function Dashboard() {
  const { data: orders } = useSWRSubscription(
    "orders",
    collectionSub({ converter: orderConverter }, orderBy("orderId", "desc")),
  );
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
      <Tabs defaultValue="itemBar">
        <TabsList>
          <TabsTrigger value="itemBar">種類別注文数</TabsTrigger>
          <TabsTrigger value="serveTimeGraph">提供時間推移</TabsTrigger>
          <TabsTrigger value="orderList">注文一覧</TabsTrigger>
        </TabsList>
        <TabsContent value="itemBar" className="p-2">
          <div className="w-2/3">
            <ItemBarChart orders={orders} pastOrders={pastOrders} />
          </div>
        </TabsContent>
        <TabsContent value="serveTimeGraph" className="p-2">
          <div className="w-2/3">
            <ServeTimeGraph orders={orders} />
          </div>
        </TabsContent>
        <TabsContent value="orderList" className="flex p-2">
          <OrderList orders={orders} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
