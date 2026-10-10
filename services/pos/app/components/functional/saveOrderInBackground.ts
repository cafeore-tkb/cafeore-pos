import {
  type OrderEntity,
  cashierRepository,
  orderRepository,
} from "@cafeore/common";
import { toast } from "sonner";

// 応答が返らないまま、失敗に気づけないことがないよう、保存を待つ時間の上限
const SAVE_TIMEOUT_MS = 10_000;

/**
 * レジで確定した注文を、画面を待たせずに裏で保存する (#732)
 *
 * 失敗したら、保存できるまで消えないトーストで知らせ、「再送」で同じ内容を送り直せるようにする。
 * 応答が届かなくてもサーバー側では保存できていることがあるので、同じ注文には同じ
 * idempotencyKey を付けて送り、送り直しで二重にしない
 */
const saveOrderInBackground = (order: OrderEntity) => {
  const idempotencyKey = newKey();
  const save = () =>
    withTimeout(
      orderRepository.save(order, { idempotencyKey }),
      SAVE_TIMEOUT_MS,
    );
  save().then(
    // cashier-mini の「ご注文ありがとうございました」の表示用
    (savedOrder) =>
      cashierRepository.setSubmittedOrder(savedOrder).catch(console.error),
    (error) => notifySaveFailed(order.orderId, error, save),
  );
};

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
    richColors: true,
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

// randomUUID は https か localhost でしか使えない。使えないときはキーを付けずに保存する
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

export { saveOrderInBackground };
