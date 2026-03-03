import {
  type OrderEntity,
  orderRepository,
  useOrdersWS,
} from "@cafeore/common";
import type { MetaFunction } from "@remix-run/react";
import { OrderInfoCard } from "~/components/molecules/OrderInfoCard";
import { PastOrderSideSheet } from "~/components/molecules/PastOrderSideSheet";

export const BASE_CLIENT_URL = "https://cafeore-2024.pages.dev";

export const meta: MetaFunction = () => {
  return [{ title: "提供 / 珈琲・俺POS" }];
};

export default function Serve() {
  const { orders } = useOrdersWS();
  const addComment = async (servedOrder: OrderEntity, descComment: string) => {
    if (servedOrder.id)
      orderRepository.addComment(servedOrder.id, "serve", descComment);
  };

  const unserved = orders?.reduce((acc, cur) => {
    if (cur.servedAt == null) {
      return acc + 1;
    }
    return acc;
  }, 0);

  return (
    <div className="p-4 font-sans">
      <div className="flex justify-between pb-4">
        <h1 className="text-3xl">提供</h1>
        <p>提供待ちオーダー数：{unserved}</p>
        <PastOrderSideSheet
          orders={orders}
          cardUser={"serve"}
          cardTiming={"past"}
          comment={addComment}
        />
      </div>

      <div className="grid grid-cols-4 gap-4">
        {orders
          ?.sort((a, b) => a.orderId - b.orderId)
          .map((order) => {
            return (
              order.servedAt === null && (
                <OrderInfoCard
                  key={order.id}
                  order={order}
                  timing={"present"}
                  user={"serve"}
                  comment={addComment}
                />
              )
            );
          })}
      </div>
    </div>
  );
}
