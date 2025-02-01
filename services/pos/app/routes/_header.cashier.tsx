import { parseWithZod } from "@conform-to/zod";
import {
  type ClientActionFunction,
  type MetaFunction,
  useSearchParams,
} from "@remix-run/react";
import { itemSource } from "common/data/items";
import { stringToJSONSchema } from "common/lib/custom-zod";
import { OrderEntity, orderSchema } from "common/models/order";
import { cashierRepository } from "common/repositories/global";
import { orderRepository } from "common/repositories/order";
import { useCallback } from "react";
import { z } from "zod";
import { useFlaggedSubmit } from "~/components/functional/useFlaggedSubmit";
import { useSyncOrders } from "~/components/functional/useSyncOrders";
import { CashierV2 } from "~/components/pages/CashierV2";

export const meta: MetaFunction = () => {
  return [{ title: "レジ / 珈琲・俺POS" }];
};

const DISABLE_FIREBASE = "dont_connect_to_firebase";

// コンポーネントではデータの取得と更新のみを行う
export default function Cashier() {
  // dont_connect_to_firebase = true にすると、Firebase に接続しない
  const [searchParams, setSearchParams] = useSearchParams();
  const disableFirebase = searchParams.get(DISABLE_FIREBASE) === "true";
  const items = itemSource;
  const orders = useSyncOrders({ disableFirebase });
  const submit = useFlaggedSubmit({ disableFirebase });

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
