import { collectionSub, orderConverter } from "@cafeore/common";
import type { MetaFunction } from "@remix-run/react";
import { orderBy } from "firebase/firestore";
import { useState } from "react";
import useSWRSubscription from "swr/subscription";
import { OrderDetail } from "~/components/organisms/OrderDetail";
import { OrderList } from "~/components/organisms/OrderList";
import { ServeTimeGraph } from "~/components/organisms/ServeTimeGraph";

export const meta: MetaFunction = () => {
  return [{ title: "注文状況 / 珈琲・俺POS" }];
};

export default function Dashboard() {
  const { data: orders } = useSWRSubscription(
    "orders",
    collectionSub({ converter: orderConverter }, orderBy("orderId", "desc")),
  );
  const [focusedOrderId, setFocusedOrderId] = useState(1);
  const unseved = orders?.reduce((acc, cur) => {
    if (cur.servedAt == null) {
      return acc + 1;
    }
    return acc;
  }, 0);

  const detailOrder = orders?.find((order) => order.orderId === focusedOrderId);
  return (
    <div className="flex justify-start p-4 pb-2 font-sans">
      <div className="h-[700px] w-1/2 overflow-auto">
        <div className="sticky top-0 flex justify-between pb-4">
          <h1 className="text-3xl">注文状況</h1>
          <p>提供待ちオーダー数：{unseved}</p>
        </div>
        <OrderList orders={orders} onOrderClick={setFocusedOrderId} />
      </div>
      <div className="w-1/2">
        <div className="sticky top-0">
          <ServeTimeGraph orders={orders} />
          {detailOrder && <OrderDetail order={detailOrder} />}
        </div>
      </div>
    </div>
  );
}
