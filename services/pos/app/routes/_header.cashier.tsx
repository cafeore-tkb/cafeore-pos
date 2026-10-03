import {
  OrderEntity,
  cashierRepository,
  orderRepository,
  orderSchema,
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
import { z } from "zod";
import { useOnlineStatus } from "~/components/functional/useOnlineStatus";
import { CashierV2 } from "~/components/pages/CashierV2";
import { useOrdersWSContext } from "./context/OrdersWSContext";

export const meta: MetaFunction = () => {
  return [{ title: "レジ / 珈琲・俺POS" }];
};

// コンポーネントではデータの取得と更新のみを行う
export default function Cashier() {
  const { items } = useMenuMaster();
  const { orders, status } = useOrdersWSContext();
  const { isOnline: isNetworkOnline } = useOnlineStatus();
  const submit = useSubmit();
  const canSubmitOrder = useMemo(
    () => isNetworkOnline && status === "open",
    [isNetworkOnline, status],
  );

  // 保存の成否を呼び出し元で待てるよう、submit を通さずに直接保存する。
  // submit だと直後のレジ状態同期の submit で打ち切られ、失敗しても気づけない (#732)
  // 時間切れで打ち切っても通信は止まらず、あとでサーバー側の保存が成功することがある。
  // 送り直しで二重にできないよう、同じ注文には同じ idempotencyKey を付ける
  const submitPayload = useCallback(
    async (newOrder: OrderEntity, idempotencyKey: string | undefined) => {
      const savedOrder = await withTimeout(
        orderRepository.save(newOrder, { idempotencyKey }),
        SUBMIT_TIMEOUT_MS,
      );
      // レジ状態へは、保存後に入力を空にする同期でまとめて書き込む
      lastSubmittedOrderId = savedOrder.id;
      return savedOrder;
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

// 応答が返らないままレジが固まらないよう、保存を待つ時間の上限
const SUBMIT_TIMEOUT_MS = 10_000;

const withTimeout = <T,>(promise: Promise<T>, ms: number): Promise<T> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${ms / 1000} 秒待っても応答がありません`)),
      ms,
    );
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });

// 直前に確定した注文の ID（cashier-mini の「ご注文ありがとうございました」表示用）。
// 別々に読み書きすると入力を空にする同期と上書きし合うので、同期で一緒に書き込む
let lastSubmittedOrderId: string | null = null;

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

  // 次の注文の入力が始まるまでは、どの同期でも載せ続ける。
  // 1 回だけ載せると、直後の注文番号の更新などの同期で null に上書きされ、表示が出ないことがある
  if (syncOrder.menus.length > 0) {
    lastSubmittedOrderId = null;
  }

  cashierRepository.set({
    id: "cashier-state",
    edittingOrder: OrderEntity.fromOrder(syncOrder),
    submittedOrderId: lastSubmittedOrderId,
  });

  return new Response("ok");
};
