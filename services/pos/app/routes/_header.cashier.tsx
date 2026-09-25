import {
  OrderEntity,
  cashierRepository,
  orderRepository,
  orderSchema,
  stringToJSONSchema,
  useMenuMaster,
} from "@cafeore/common";
import { parseWithZod } from "@conform-to/zod";
import { useCallback } from "react";
import {
  type ClientActionFunction,
  type MetaFunction,
  useSubmit,
} from "react-router";
import { z } from "zod";
import { CashierV2 } from "~/components/pages/CashierV2";
import { useOrdersWSContext } from "./context/OrdersWSContext";

export const meta: MetaFunction = () => {
  return [{ title: "レジ / 珈琲・俺POS" }];
};

// コンポーネントではデータの取得と更新のみを行う
export default function Cashier() {
  const { items } = useMenuMaster();
  const { orders, status } = useOrdersWSContext();
  const submit = useSubmit();

  // 保存の成否を呼び出し元で待てるよう、submit を通さずに直接保存する。
  // submit だと直後のレジ状態同期の submit で打ち切られ、失敗しても気づけない (#732)
  const submitPayload = useCallback(async (newOrder: OrderEntity) => {
    const savedOrder = await orderRepository.save(newOrder);
    // レジ状態の更新に失敗しても注文は保存できているので、送信は成功として扱う
    setSubmittedOrderId(savedOrder.id).catch(console.error);
  }, []);

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
      submitPayload={submitPayload}
      syncOrder={syncOrder}
    />
  );
}

// TODO(toririm): リファクタリングするときにファイルを切り出す
export const clientAction: ClientActionFunction = async (args) => {
  const method = args.request.method;
  switch (method) {
    case "PUT":
      return syncOrderAction(args);
    default:
      return new Response("Method not allowed", { status: 405 });
  }
};

// 直前に確定した注文をレジ状態に載せる（cashier-mini の「ご注文ありがとうございました」表示用）
const setSubmittedOrderId = async (submittedOrderId: string) => {
  const cashierState = await cashierRepository.get();
  if (cashierState == null) {
    return console.log("cashierState is null");
  }
  await cashierRepository.set({
    ...cashierState,
    submittedOrderId,
  });
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
