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
import { useCallback, useEffect } from "react";
import {
  type ClientActionFunction,
  type MetaFunction,
  useSubmit,
} from "react-router";
import useSWR from "swr";
import { z } from "zod";
import {
  notifyOfflineOrders,
  saveOrderInBackground,
  sendUnsentOrders,
} from "~/components/functional/saveOrderInBackground";
import { useDeviceOnlineStatus } from "~/components/functional/useDeviceOnlineStatus";
import { usePrinterAddresses } from "~/components/functional/usePrinterAddresses";
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
  // 今すぐ保存できるか（つながっているか）は端末とWebSocketで判定し、ヘッダーの/status監視には依存させない。
  // つながっていなくても、番号を手で付ければ確定でき、注文はこの端末に溜まる（CashierV2）
  const canSaveNow = isDeviceOnline && status === "open";
  const connecting = isDeviceOnline && status === "connecting";

  // つながったら（開いたときも）溜めた注文をまとめて送る。つながっていなければ溜めている数を出す
  useEffect(() => {
    if (canSaveNow) {
      void sendUnsentOrders();
    } else if (!connecting) {
      notifyOfflineOrders();
    }
  }, [canSaveNow, connecting]);

  const submitPayload = useCallback(
    (newOrder: OrderEntity) => saveOrderInBackground(newOrder, canSaveNow),
    [canSaveNow],
  );
  // Square 連携が有効なときだけ、確定欄に Square のボタンを出す。
  const { data: squareStatus } = useSWR(
    "square-status",
    squareRepository.getStatus,
  );
  const squareEnabled = squareStatus?.enabled ?? false;
  // 決済画面を出す端末はレジごとに固定する（このブラウザに覚える）
  const squareDevice = useSquareDevice(squareEnabled);
  // プリンターは全レジ共通で、管理画面（/printer-settings）で設定する
  const printerAddresses = usePrinterAddresses();

  // Square で支払い済みの注文は、登録できたかをレジが待つ。clientAction を通すと
  // 結果を受け取れないので、ここで直に送る。失敗はそのまま reject する。
  // 登録した注文を返す（「常に返金」のとき、レジがその注文を返金する）。
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
      canSaveNow={canSaveNow}
      squareEnabled={squareEnabled}
      squareDevice={squareDevice}
      printerAddresses={printerAddresses}
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
    case "PUT":
      return syncOrderAction(args);
    default:
      return new Response("Method not allowed", { status: 405 });
  }
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
