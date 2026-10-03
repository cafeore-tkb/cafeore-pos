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
  const submitPayload = useCallback(async (newOrder: OrderEntity) => {
    const savedOrder = await withTimeout(
      orderRepository.save(newOrder),
      SUBMIT_TIMEOUT_MS,
    );
    // レジ状態へは、保存後に入力を空にする同期でまとめて書き込む
    pendingSubmittedOrderId = savedOrder.id;
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
// 別々に読み書きすると入力を空にする同期と上書きし合うので、その同期で一緒に書き込む
let pendingSubmittedOrderId: string | null = null;

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

  // 保存直後の、入力を空にする同期でだけ載せる
  const submittedOrderId =
    syncOrder.menus.length === 0 ? pendingSubmittedOrderId : null;
  pendingSubmittedOrderId = null;

  cashierRepository.set({
    id: "cashier-state",
    edittingOrder: OrderEntity.fromOrder(syncOrder),
    submittedOrderId,
  });

  return new Response("ok");
};
