import {
  type Order,
  OrderEntity,
  cashierRepository,
  cashierStateWireSchema,
  orderRepository,
} from "@cafeore/common";
import { toast } from "sonner";
import { z } from "zod";

// 応答が返らないまま、失敗に気づけないことがないよう、保存を待つ時間の上限
const SAVE_TIMEOUT_MS = 10_000;

// 保存に失敗した注文を、読み込み直しても再送できるようこの端末に残す。idempotencyKey → 注文
const FAILED_ORDERS_KEY = "cashier-failed-orders";

/**
 * レジで確定した注文を、画面を待たせずに裏で保存する (#732)
 *
 * 失敗したら、保存できるまで消えないトーストで知らせ、「再送」で同じ内容を送り直せるようにする。
 * 応答が届かなくてもサーバー側では保存できていることがあるので、同じ注文には同じ
 * idempotencyKey を付けて送り、送り直しで二重にしない
 */
const saveOrderInBackground = (order: OrderEntity) => {
  const idempotencyKey = newKey();
  const save = saver(order, idempotencyKey);
  save().then(
    // cashier-mini の「ご注文ありがとうございました」の表示用
    (savedOrder) =>
      cashierRepository.setSubmittedOrder(savedOrder).catch(console.error),
    (error) => {
      if (idempotencyKey) {
        updateFailedOrders((orders) => ({
          ...orders,
          [idempotencyKey]: order.toOrder(),
        }));
      }
      notifySaveFailed(order.orderId, error, save);
    },
  );
};

/**
 * 前に開いていたときに保存できなかった注文を、同じキーで再送できるトーストに出し直す
 */
const notifyStoredFailedOrders = () => {
  for (const [idempotencyKey, order] of Object.entries(readFailedOrders())) {
    notifySaveFailed(
      order.orderId,
      "読み込み直す前に保存できなかった注文です",
      saver(OrderEntity.fromOrder(order), idempotencyKey),
      idempotencyKey,
    );
  }
};

// 保存できたら端末に残した分も消す
const saver = (order: OrderEntity, idempotencyKey: string | undefined) => () =>
  withTimeout(
    orderRepository.save(order, { idempotencyKey }),
    SAVE_TIMEOUT_MS,
  ).then((savedOrder) => {
    if (idempotencyKey) {
      updateFailedOrders(({ [idempotencyKey]: _, ...rest }) => rest);
    }
    return savedOrder;
  });

const notifySaveFailed = (
  orderId: number,
  error: unknown,
  save: () => Promise<unknown>,
  toastId?: string | number,
) => {
  console.error(error);
  const id = toast.error(`No.${orderId} の保存に失敗しました`, {
    id: toastId,
    description: error instanceof Error ? error.message : String(error),
    duration: Number.POSITIVE_INFINITY,
    dismissible: false,
    action: {
      label: "再送",
      onClick: (event) => {
        // 保存できるまではトーストを消さない
        event.preventDefault();
        toast.loading(`No.${orderId} を再送しています`, { id, action: null });
        save().then(
          () => toast.dismiss(id),
          (error) => notifySaveFailed(orderId, error, save, id),
        );
      },
    },
  });
};

// JSON では Date が ISO 文字列になるので、レジ状態と同じ wire スキーマで戻す
const failedOrdersSchema = z.record(
  z.string(),
  cashierStateWireSchema.shape.edittingOrder,
);

// 使えない・壊れた値なら、残っていないものとして扱う（そのときは今までどおりトーストだけ）
const readFailedOrders = () => {
  try {
    return failedOrdersSchema.parse(
      JSON.parse(localStorage.getItem(FAILED_ORDERS_KEY) ?? "{}"),
    );
  } catch (error) {
    console.error(error);
    return {};
  }
};

const updateFailedOrders = (
  update: (orders: Record<string, Order>) => Record<string, Order>,
) => {
  try {
    const orders = update(readFailedOrders());
    localStorage.setItem(FAILED_ORDERS_KEY, JSON.stringify(orders));
  } catch (error) {
    console.error(error);
  }
};

// randomUUID は https か localhost でしか使えない。使えないときはキーを付けずに保存し、端末にも残さない
const newKey = () =>
  typeof crypto?.randomUUID === "function" ? crypto.randomUUID() : undefined;

const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${ms / 1000} 秒待っても応答がありません`)),
      ms,
    );
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });

export { notifyStoredFailedOrders, saveOrderInBackground };
