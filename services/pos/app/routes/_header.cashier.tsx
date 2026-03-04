import {
  type ItemEntity,
  OrderEntity,
  type WithId,
  cashierRepository,
  getItemMaster,
  initializeItemMaster,
  orderRepository,
  orderSchema,
  stringToJSONSchema,
  useOrdersWS,
} from "@cafeore/common";
import { parseWithZod } from "@conform-to/zod";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ClientActionFunction, MetaFunction } from "react-router";
import { z } from "zod";
import { useAuth } from "~/components/functional/AuthProvider";
import { useFlaggedSubmit } from "~/components/functional/useFlaggedSubmit";
import { CashierV2 } from "~/components/pages/CashierV2";

export const meta: MetaFunction = () => {
  return [{ title: "レジ / 珈琲・俺POS" }];
};

// コンポーネントではデータの取得と更新のみを行う
export default function Cashier() {
  const user = useAuth();
  const disableFirebase = useMemo(() => user == null, [user]);
  const [items, setItems] = useState<WithId<ItemEntity>[]>([]);
  const { orders } = useOrdersWS();
  const submit = useFlaggedSubmit({ disableFirebase });

  useEffect(() => {
    initializeItemMaster().then(() => {
      setItems(getItemMaster());
    });
  }, []);

  const submitPayload = useCallback(
    (newOrder: OrderEntity) => {
      submit(
        { newOrder: JSON.stringify(newOrder.toOrder()) },
        { method: "POST" },
      );
    },
    [submit],
  );

  const syncOrder = useCallback(
    (order: OrderEntity) => {
      submit({ syncOrder: JSON.stringify(order.toOrder()) }, { method: "PUT" });
    },
    [submit],
  );

  return (
    <CashierV2
      items={items}
      orders={orders}
      submitPayload={submitPayload}
      syncOrder={syncOrder}
    />
  );
}

// TODO(toririm): リファクタリングするときにファイルを切り出す
export const clientAction: ClientActionFunction = async (args) => {
  const method = args.request.method;
  switch (method) {
    case "POST":
      return submitOrderAction(args);
    case "PUT":
      return syncOrderAction(args);
    default:
      return new Response("Method not allowed", { status: 405 });
  }
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

  const savedOrder = await orderRepository.save(order);

  const cashierState = await cashierRepository.get();
  if (cashierState == null) {
    return console.log("cashierState is null");
  }
  await cashierRepository.set({
    ...cashierState,
    submittedOrderId: savedOrder.id,
  });

  return new Response("ok");
};

export const syncOrderAction: ClientActionFunction = async ({ request }) => {
  const formData = await request.formData();

  const schema = z.object({
    syncOrder: stringToJSONSchema.pipe(orderSchema),
  });
  const submission = parseWithZod(formData, {
    schema,
  });
  if (submission.status !== "success") {
    console.error(submission.error);
    return submission.reply();
  }

  const { syncOrder } = submission.value;

  cashierRepository.set({
    id: "cashier-state",
    edittingOrder: OrderEntity.fromOrder(syncOrder),
    submittedOrderId: null,
  });

  return new Response("ok");
};
