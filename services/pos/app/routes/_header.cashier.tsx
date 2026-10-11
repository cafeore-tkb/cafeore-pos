import {
  OrderEntity,
  cashierRepository,
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
import { useSquareDevice } from "~/components/functional/useSquareDevice";
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
  const squareEnabled = squareStatus?.enabled ?? false;
  // 決済画面を出す端末はレジごとに固定する（このブラウザに覚える）
  const squareDevice = useSquareDevice(squareEnabled);

  const submitPayload = useCallback(
    (newOrder: OrderEntity) => {
      submit(
        { newOrder: JSON.stringify(newOrder.toOrder()) },
        { method: "POST" },
      );
    },
    [submit],
  );

  // Square で支払い済みの注文は、登録できたかをレジが待つ。clientAction を通すと
  // 結果を受け取れないので、ここで直に送る。失敗はそのまま reject する。
  const submitSquarePayload = useCallback(
    async (newOrder: OrderEntity, squareCheckoutId: string) => {
      const savedOrder = await orderRepository.save(newOrder, {
        method: "square",
        squareCheckoutId,
      });
      // 注文は登録できている。ここで reject すると、レジが同じ決済で送り直して
      // 断られるだけなので、ログに残すだけにする。
      await cashierRepository.setSubmittedOrder(savedOrder).catch((err) => {
        console.error("レジ状態の同期に失敗しました", err);
      });
    },
    [],
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
      squareEnabled={squareEnabled}
      squareDevice={squareDevice}
      submitPayload={submitPayload}
      submitSquarePayload={submitSquarePayload}
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
