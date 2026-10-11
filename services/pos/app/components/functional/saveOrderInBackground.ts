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

// まだ保存できていない注文（オフラインで溜めた注文と、保存に失敗した注文）を、読み込み直しても
// 送れるようこの端末に残す。idempotencyKey → 注文。キーの名前は、失敗した注文だけを残していたころのまま
const UNSENT_ORDERS_KEY = "cashier-failed-orders";

// オフラインで溜めている注文の数を出すトースト
const OFFLINE_TOAST_ID = "cashier-offline-orders";

/**
 * レジで確定した注文を、画面を待たせずに裏で保存する (#732)
 *
 * 送る前にこの端末に残し、保存できたら消す。online が false（オフライン）なら送らずに溜めておき、
 * つながったら sendUnsentOrders でまとめて送る。
 * 失敗したら、保存できるまで消えないトーストで知らせ、「再送」で同じ内容を送り直せるようにする。
 * 応答が届かなくてもサーバー側では保存できていることがあるので、同じ注文には同じ
 * idempotencyKey を付けて送り、送り直しで二重にしない
 */
const saveOrderInBackground = (order: OrderEntity, online: boolean) => {
  const idempotencyKey = newKey();
  updateUnsentOrders((orders) => ({
    ...orders,
    [idempotencyKey]: order.toOrder(),
  }));
  if (!online) {
    notifyOfflineOrders();
    return;
  }
  saver(order, idempotencyKey, false)().then(
    // cashier-mini の「ご注文ありがとうございました」の表示用
    (savedOrder) =>
      cashierRepository.setSubmittedOrder(savedOrder).catch(console.error),
    (error) =>
      notifySaveFailed(
        order.orderId,
        error,
        saver(order, idempotencyKey, true),
        idempotencyKey,
      ),
  );
};

let sending = false;

/**
 * 端末に残っている、まだ保存できていない注文を、確定した順にまとめて送る。つながったときと、開いたときに呼ぶ
 *
 * 確定した時刻（created_at）と同じキーを付けるので、遅れて送っても注文の時刻は確定したときのまま、
 * すでに保存できていた注文は二重にならない。送れなかった注文は、1 件ずつ再送できるトーストに出す
 */
const sendUnsentOrders = async () => {
  if (sending) return;
  sending = true;
  try {
    const entries = Object.entries(readUnsentOrders()).sort(
      ([, a], [, b]) => a.createdAt.getTime() - b.createdAt.getTime(),
    );
    if (entries.length === 0) {
      toast.dismiss(OFFLINE_TOAST_ID);
      return;
    }
    toast.loading(`溜めた注文 ${entries.length} 件を送っています`, {
      id: OFFLINE_TOAST_ID,
      description: null,
      duration: Number.POSITIVE_INFINITY,
    });
    let sent = 0;
    for (const [idempotencyKey, stored] of entries) {
      const order = OrderEntity.fromOrder(stored);
      const save = saver(order, idempotencyKey, true);
      try {
        await save();
        sent++;
        toast.dismiss(idempotencyKey);
      } catch (error) {
        notifySaveFailed(order.orderId, error, save, idempotencyKey);
      }
    }
    if (sent === entries.length) {
      toast.success(`溜めた注文 ${sent} 件を送りました`, {
        id: OFFLINE_TOAST_ID,
        duration: 4000,
      });
    } else {
      toast.dismiss(OFFLINE_TOAST_ID);
    }
  } finally {
    sending = false;
  }
};

/**
 * オフラインのあいだ、溜めている注文の数を消えないトーストで出す（無ければ消す）
 */
const notifyOfflineOrders = () => {
  const orders = Object.values(readUnsentOrders());
  if (orders.length === 0) {
    toast.dismiss(OFFLINE_TOAST_ID);
    return;
  }
  toast.warning(`オフライン：注文 ${orders.length} 件を溜めています`, {
    id: OFFLINE_TOAST_ID,
    description: `${orders.map((order) => `No.${order.orderId}`).join("・")}。つながったら自動で送ります`,
    duration: Number.POSITIVE_INFINITY,
    dismissible: false,
  });
};

// 保存できたら端末に残した分も消す。後から送るとき（溜めた注文・再送）は確定した時刻も送る
const saver =
  (order: OrderEntity, idempotencyKey: string, sendCreatedAt: boolean) => () =>
    withTimeout(
      orderRepository.save(order, {
        idempotencyKey,
        createdAt: sendCreatedAt ? order.createdAt : undefined,
      }),
      SAVE_TIMEOUT_MS,
    ).then((savedOrder) => {
      updateUnsentOrders(({ [idempotencyKey]: _, ...rest }) => rest);
      return savedOrder;
    });

const notifySaveFailed = (
  orderId: number,
  error: unknown,
  save: () => Promise<unknown>,
  toastId: string,
) => {
  console.error(error);
  toast.error(`No.${orderId} の保存に失敗しました`, {
    id: toastId,
    description: error instanceof Error ? error.message : String(error),
    duration: Number.POSITIVE_INFINITY,
    dismissible: false,
    action: {
      label: "再送",
      onClick: (event) => {
        // 保存できるまではトーストを消さない
        event.preventDefault();
        toast.loading(`No.${orderId} を再送しています`, {
          id: toastId,
          action: null,
        });
        save().then(
          () => toast.dismiss(toastId),
          (error) => notifySaveFailed(orderId, error, save, toastId),
        );
      },
    },
  });
};

// JSON では Date が ISO 文字列になるので、レジ状態と同じ wire スキーマで戻す
const unsentOrdersSchema = z.record(
  z.string(),
  cashierStateWireSchema.shape.edittingOrder,
);

// 使えない・壊れた値なら、残っていないものとして扱う
const readUnsentOrders = () => {
  try {
    return unsentOrdersSchema.parse(
      JSON.parse(localStorage.getItem(UNSENT_ORDERS_KEY) ?? "{}"),
    );
  } catch (error) {
    console.error(error);
    return {};
  }
};

const updateUnsentOrders = (
  update: (orders: Record<string, Order>) => Record<string, Order>,
) => {
  try {
    const orders = update(readUnsentOrders());
    localStorage.setItem(UNSENT_ORDERS_KEY, JSON.stringify(orders));
  } catch (error) {
    console.error(error);
  }
};

// randomUUID は https か localhost でしか使えないので、使えないときは getRandomValues で UUID（v4）を作る
const newKey = (): string => {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${ms / 1000} 秒待っても応答がありません`)),
      ms,
    );
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });

export { notifyOfflineOrders, saveOrderInBackground, sendUnsentOrders };
