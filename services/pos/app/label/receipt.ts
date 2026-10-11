import type { OrderEntity, SquarePaymentType } from "@cafeore/common";
import { jstClock, jstDate } from "@cafeore/common";

/**
 * レシートと領収書に載せる中身。レシート用のプリンターで刷る。
 *
 * ここでは何を載せるかだけを決め、どこにどう描くかは receipt-canvas.ts が決める。
 */

/** レシートと領収書の発行者 */
export const RECEIPT_ISSUER = "珈琲・俺";

/** 発行者の読み（ロゴの横、名前の下に小さく載せる） */
export const RECEIPT_ISSUER_READING = "カフェ・オレ";

/**
 * レシートに載せる支払い方法
 *
 * paymentType は Square の決済依頼の payment_type（API では文字列）。
 * 知らない値や分からないときは、決済手段を出さずにキャッシュレス決済とだけ載せる。
 */
export type ReceiptPayment =
  | { method: "cash" }
  | { method: "square"; paymentType?: string };

const SQUARE_PAYMENT_LABEL: Partial<Record<string, string>> = {
  CARD_PRESENT: "クレジットカード",
  FELICA_ALL: "電子マネー",
  QR_CODE: "QRコード決済",
} satisfies Record<SquarePaymentType, string>;

/** 左に名前（と個数）、右に金額を置く 1 行 */
export type ReceiptRow = {
  label: string;
  /** x2。名前が長くて切るときも、これは切らずに残す */
  quantity?: string;
  amount: string;
};

/** 会計のたびに刷るレシートの中身 */
export type OrderReceipt = {
  /** 2026/11/07 10:23 */
  dateTime: string;
  /** No.123 */
  orderNo: string;
  /** 明細。同じ名前・値段の商品は 1 行にまとめる */
  items: ReceiptRow[];
  /** 小計と割引。割引が無ければ空 */
  adjustments: ReceiptRow[];
  /** 合計の金額（請求額） */
  total: string;
  /** 現金ならお預り・お釣り、Square なら決済手段 */
  payments: ReceiptRow[];
  /** 引換券番号として大きく載せる注文番号 */
  claimNumber: string;
};

/** 求められたときだけ刷る領収書の中身 */
export type FormalReceipt = {
  /** No.123 */
  orderNo: string;
  /** ￥1,150- */
  amount: string;
  /** 但し書き */
  note: string;
  /** 2026年11月7日 */
  date: string;
};

/** ￥1,234。全角の円記号はシールと同じ */
export const yen = (amount: number) =>
  `${amount < 0 ? "-" : ""}￥${Math.abs(amount).toLocaleString("ja-JP")}`;

const orderNo = (order: OrderEntity) => `No.${order.orderId}`;

/** 同じ名前・値段の商品をまとめた明細 */
const receiptItems = (order: OrderEntity): ReceiptRow[] => {
  const rows = new Map<
    string,
    { name: string; price: number; count: number }
  >();
  for (const menu of order.menus) {
    const key = JSON.stringify([menu.name, menu.price]);
    const row = rows.get(key);
    if (row) {
      row.count += 1;
    } else {
      rows.set(key, { name: menu.name, price: menu.price, count: 1 });
    }
  }
  return [...rows.values()].map(({ name, price, count }) => ({
    label: name,
    ...(count > 1 && { quantity: `x${count}` }),
    amount: yen(price * count),
  }));
};

/**
 * 会計のたびに刷るレシート
 *
 * 商品ごとの金額・割引・合計と、現金ならお預り・お釣り、Square なら決済手段を載せる。
 * 日時は注文を確定した時刻（日本時間）。
 */
export const orderReceipt = (
  order: OrderEntity,
  payment: ReceiptPayment,
): OrderReceipt => {
  const createdAt = order.createdAt.getTime();
  const date = jstDate(createdAt).replaceAll("-", "/");
  const time = jstClock(createdAt).slice(0, 5);

  const adjustments =
    order.discount > 0
      ? [
          { label: "小計", amount: yen(order.total) },
          { label: "割引", amount: yen(-order.discount) },
        ]
      : [];

  const payments =
    payment.method === "cash"
      ? [
          { label: "お預り", amount: yen(order.received) },
          { label: "お釣り", amount: yen(order.getCharge()) },
        ]
      : [
          {
            label:
              (payment.paymentType &&
                SQUARE_PAYMENT_LABEL[payment.paymentType]) ??
              "キャッシュレス決済",
            amount: yen(order.billingAmount),
          },
        ];

  return {
    dateTime: `${date} ${time}`,
    orderNo: orderNo(order),
    items: receiptItems(order),
    adjustments,
    total: yen(order.billingAmount),
    payments,
    claimNumber: `${order.orderId}`,
  };
};

/** 2026年11月7日 */
const jaDate = (ms: number) => {
  const [y, m, d] = jstDate(ms).split("-").map(Number);
  return `${y}年${m}月${d}日`;
};

/**
 * 求められたときだけ刷る領収書
 *
 * 宛名は手で書けるよう空けておく。日付は注文を受けた日、金額は請求額（割引後）。
 */
export const formalReceipt = (order: OrderEntity): FormalReceipt => ({
  orderNo: orderNo(order),
  amount: `${yen(order.billingAmount)}-`,
  note: "但し 飲食代として",
  date: jaDate(order.createdAt.getTime()),
});
