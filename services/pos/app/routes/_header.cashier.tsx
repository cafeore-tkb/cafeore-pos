import {
  OrderEntity,
  orderRepository,
  orderSchema,
  stringToJSONSchema,
  useItemMaster,
} from "@cafeore/common";
import { parseWithZod } from "@conform-to/zod";
import { useCallback, useMemo } from "react";
import type { ClientActionFunction, MetaFunction } from "react-router";
import { z } from "zod";
import { useAuth } from "~/components/functional/AuthProvider";
import { useFlaggedSubmit } from "~/components/functional/useFlaggedSubmit";
import { usePublishCashierDisplay } from "~/components/functional/usePublishCashierDisplay";
import { CashierV2 } from "~/components/pages/CashierV2";
import { useOrdersWSContext } from "./context/OrdersWSContext";

export const meta: MetaFunction = () => {
  return [{ title: "レジ / 珈琲・俺POS" }];
};

// コンポーネントではデータの取得と更新のみを行う
export default function Cashier() {
  const user = useAuth();
  const disableFirebase = useMemo(() => user == null, [user]);
  const { items } = useItemMaster();
  const { orders, status } = useOrdersWSContext();
  const submit = useFlaggedSubmit({ disableFirebase });
  // 客用画面へは同じパソコンのウィンドウに直接配信する
  const { publishEdittingOrder, publishSubmittedOrder } =
    usePublishCashierDisplay();

  const submitPayload = useCallback(
    (newOrder: OrderEntity) => {
      publishSubmittedOrder(newOrder);
      submit(
        { newOrder: JSON.stringify(newOrder.toOrder()) },
        { method: "POST" },
      );
    },
    [submit, publishSubmittedOrder],
  );

  return (
    <CashierV2
      items={items}
      orders={orders}
      wsStatus={status}
      submitPayload={submitPayload}
      syncOrder={publishEdittingOrder}
    />
  );
}

// TODO(toririm): リファクタリングするときにファイルを切り出す
export const clientAction: ClientActionFunction = async (args) => {
  if (args.request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  return submitOrderAction(args);
};

export const submitOrderAction: ClientActionFunction = async ({ request }) => {
  const formData = await request.formData();

  const schema = z.object({
    newOrder: stringToJSONSchema.pipe(orderSchema),
  });
  const submission = parseWithZod(formData, {
    schema,
  });
  if (submission.status !== "success") {
    console.error(submission.error);
    return submission.reply();
  }

  const { newOrder } = submission.value;
  const order = OrderEntity.fromOrder(newOrder);

  await orderRepository.save(order);

  return new Response("ok");
};
