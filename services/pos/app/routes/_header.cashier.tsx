import {
  OrderEntity,
  type OrderPayment,
  cashierRepository,
  orderPaymentSchema,
  orderRepository,
  orderSchema,
  squareRepository,
  stringToJSONSchema,
  useMenuMaster,
} from "@cafeore/common";
import { parseWithZod } from "@conform-to/zod";
import { useCallback, useMemo } from "react";
import {
  type ClientActionFunction,
  type MetaFunction,
  useSubmit,
} from "react-router";
import useSWR from "swr";
import { z } from "zod";
import { useDeviceOnlineStatus } from "~/components/functional/useDeviceOnlineStatus";
import { CashierV2 } from "~/components/pages/CashierV2";
import { useOrdersWSContext } from "./context/OrdersWSContext";

export const meta: MetaFunction = () => {
  return [{ title: "レジ / 珈琲・俺POS" }];
};

// コンポーネントではデータの取得と更新のみを行う
export default function Cashier() {
  const { items } = useMenuMaster();
  const { orders, status } = useOrdersWSContext();
  const { isDeviceOnline } = useDeviceOnlineStatus();
  const submit = useSubmit();
  // 会計可否は端末とWebSocketで判定し、ヘッダーの/status監視には依存させない。
  const canSubmitOrder = useMemo(
    () => isDeviceOnline && status === "open",
    [isDeviceOnline, status],
  );

  // Square 連携が有効なときだけ、確定欄に Square のボタンを出す。
  const { data: squareStatus } = useSWR(
    "square-status",
    squareRepository.getStatus,
  );

  const submitPayload = useCallback(
    (newOrder: OrderEntity, payment?: OrderPayment) => {
      submit(
        {
          newOrder: JSON.stringify(newOrder.toOrder()),
          ...(payment ? { payment: JSON.stringify(payment) } : {}),
        },
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
      wsStatus={status}
      canSubmitOrder={canSubmitOrder}
      squareEnabled={squareStatus?.enabled ?? false}
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
    // 省略時は現金。Square のときは決済依頼の ID を一緒に送る。
    payment: stringToJSONSchema.pipe(orderPaymentSchema).optional(),
  });
  const submission = parseWithZod(formData, {
    schema,
  });
  if (submission.status !== "success") {
    console.error(submission.error);
    return submission.reply();
  }

  const { newOrder, payment } = submission.value;
  const order = OrderEntity.fromOrder(newOrder);

  const savedOrder = await orderRepository.save(order, payment);

  // API から読み直さず、このタブが最後に送った編集中注文に確定 ID を載せて送る
  await cashierRepository.setSubmittedOrder(savedOrder);

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

  cashierRepository
    .set({
      id: "cashier-state",
      edittingOrder: OrderEntity.fromOrder(syncOrder),
      submittedOrderId: null,
    })
    .catch((err) => {
      // キー入力のたびに呼ぶので await しない。失敗はここで拾ってログに残す
      console.error("レジ状態の同期に失敗しました", err);
    });

  return new Response("ok");
};
