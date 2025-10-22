import { collectionSub, orderConverter } from "@cafeore/common";
import type { MetaFunction } from "react-router";
import { orderBy } from "firebase/firestore";
import useSWRSubscription from "swr/subscription";
import { Card } from "~/components/ui/card";

export const meta: MetaFunction = () => {
  return [{ title: "呼び出し画面" }];
};

export default function FielsOfCallScreen() {
  const { data: orders } = useSWRSubscription(
    "orders",
    collectionSub({ converter: orderConverter }, orderBy("orderId", "asc")),
  );

  const unserved = orders?.reduce((acc, cur) => {
    if (cur.servedAt == null) {
      return acc + 1;
    }
    return acc;
  }, 0);

  return (
    <div className="flex p-2 font-sans ">
      <div className="h-screen w-1/2 border-r p-4">
        <h1 className="mb-2 bg-theme2025 text-center font-bold text-3xl text-white">
          準備中
        </h1>
        <div className="grid grid-cols-4 gap-4">
          {orders?.map((order) => {
            const isReady = order.readyAt !== null;
            return (
              order.servedAt === null &&
              order.readyAt === null && (
                <div key={order.id}>
                  <Card className="flex items-center justify-center">
                    <div className="p-3 font-bold text-5xl">
                      {order.orderId}
                    </div>
                  </Card>
                </div>
              )
            );
          })}
        </div>
      </div>
      <div className="h-screen w-1/2 p-4">
        <h1 className="mb-2 bg-theme2025 text-center font-bold text-3xl text-white">
          お呼び出し中
        </h1>
        <div className="grid grid-cols-4 gap-4">
          {orders?.map((order) => {
            const isReady = order.readyAt !== null;
            return (
              order.servedAt === null &&
              order.readyAt !== null && (
                <div key={order.id}>
                  <Card className="flex items-center justify-center">
                    <div className="p-3 font-bold text-5xl">
                      {order.orderId}
                    </div>
                  </Card>
                </div>
              )
            );
          })}
        </div>
      </div>
    </div>
  );
}
