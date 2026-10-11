import type { OrderEntity, SquarePaymentType } from "@cafeore/common";
import { jstClock, jstDate } from "@cafeore/common";
import type { PrintJob, TextLine, TextSize } from "./document";

/**
 * レシートと領収書の印刷データ。レシート用のプリンターで刷る。
 *
 * 用紙の幅（58mm / 80mm）や機種で 1 行に入る文字数が変わるので、どの幅でも収まる
 * RECEIPT_COLUMNS 桁で 1 行ずつ組み、紙の中央に寄せて刷る（flow の align: center）。
 * 桁は半角 1・全角 2 で数える。
 */

/** レシートと領収書の発行者 */
export const RECEIPT_ISSUER = "珈琲・俺";

/** 1 行の桁数（半角で数える） */
export const RECEIPT_COLUMNS = 32;

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

const NORMAL: TextSize = [1, 1];
/** 縦だけ 2 倍（横の桁数は変わらない） */
const TALL: TextSize = [1, 2];
const LARGE: TextSize = [2, 2];

// 半角（ASCII・Latin-1・半角カナ）は 1 桁、それ以外は 2 桁
const charWidth = (char: string) => {
  const code = char.codePointAt(0) ?? 0;
  return code <= 0xff || (code >= 0xff61 && code <= 0xff9f) ? 1 : 2;
};

/** 文字列が何桁を占めるか */
export const displayWidth = (text: string) =>
  Array.from(text).reduce((acc, char) => acc + charWidth(char), 0);

/** width 桁に収まるよう後ろを切る */
const truncate = (text: string, width: number) => {
  let result = "";
  let used = 0;
  for (const char of Array.from(text)) {
    const w = charWidth(char);
    if (used + w > width) break;
    result += char;
    used += w;
  }
  return result;
};

/**
 * 左に left、右端に right を置いた、ちょうど RECEIPT_COLUMNS 桁の文字列。間は空白で埋める。
 * 入りきらなければ left の後ろを切る（right は金額なので切らない）。
 */
export const padLine = (left: string, right = "") => {
  const room = RECEIPT_COLUMNS - displayWidth(right);
  const head = truncate(left, right === "" ? room : room - 1);
  return `${head}${" ".repeat(room - displayWidth(head))}${right}`;
};

/** 中央に置いた、ちょうど RECEIPT_COLUMNS 桁の文字列 */
const centered = (text: string) => {
  const head = truncate(text, RECEIPT_COLUMNS);
  const space = RECEIPT_COLUMNS - displayWidth(head);
  const before = Math.floor(space / 2);
  return `${" ".repeat(before)}${head}${" ".repeat(space - before)}`;
};

/** ￥1,234。全角の円記号はシールと同じ（Shift_JIS に必ずある） */
export const yen = (amount: number) =>
  `${amount < 0 ? "-" : ""}￥${Math.abs(amount).toLocaleString("ja-JP")}`;

const line = (text: string, size: TextSize = NORMAL): TextLine => [
  { text, size },
];
const blank: TextLine = [];
const rule = line("-".repeat(RECEIPT_COLUMNS));

const orderNo = (order: OrderEntity) => `No.${order.orderId}`;

/** 中央に寄せて刷る 1 枚 */
const receiptJob = (lines: TextLine[]): PrintJob => ({
  labels: [{ type: "flow", align: "center", lines }],
});

/** 同じ名前・値段の商品をまとめた明細 */
const receiptItems = (order: OrderEntity) => {
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
  return [...rows.values()];
};

/**
 * 会計のたびに刷るレシート
 *
 * 商品ごとの金額・割引・合計と、現金ならお預り・お釣り、Square なら決済手段を載せる。
 * 日時は注文を確定した時刻（日本時間）。
 */
export const orderReceiptJob = (
  order: OrderEntity,
  payment: ReceiptPayment,
): PrintJob => {
  const createdAt = order.createdAt.getTime();
  const date = jstDate(createdAt).replaceAll("-", "/");
  const time = jstClock(createdAt).slice(0, 5);
  const lines: TextLine[] = [
    line(RECEIPT_ISSUER, LARGE),
    blank,
    line(padLine(`${date} ${time}`, orderNo(order))),
    rule,
  ];

  for (const { name, price, count } of receiptItems(order)) {
    lines.push(
      line(padLine(count > 1 ? `${name} x${count}` : name, yen(price * count))),
    );
  }
  lines.push(rule);

  if (order.discount > 0) {
    lines.push(line(padLine("小計", yen(order.total))));
    lines.push(line(padLine("割引", yen(-order.discount))));
  }
  lines.push(line(padLine("合計", yen(order.billingAmount)), TALL));

  if (payment.method === "cash") {
    lines.push(line(padLine("お預り", yen(order.received))));
    lines.push(line(padLine("お釣り", yen(order.getCharge()))));
  } else {
    const label =
      (payment.paymentType && SQUARE_PAYMENT_LABEL[payment.paymentType]) ??
      "キャッシュレス決済";
    lines.push(line(padLine(label, yen(order.billingAmount))));
  }

  lines.push(blank);
  lines.push(line(centered("ありがとうございました")));
  return receiptJob(lines);
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
export const formalReceiptJob = (order: OrderEntity): PrintJob =>
  receiptJob([
    line("領収書", LARGE),
    blank,
    line(padLine("", orderNo(order))),
    blank,
    line(padLine("_".repeat(RECEIPT_COLUMNS - 4), "様")),
    blank,
    line(`${yen(order.billingAmount)}-`, LARGE),
    blank,
    line(padLine("但し お品代として")),
    line(padLine("上記正に領収いたしました")),
    blank,
    line(padLine(jaDate(order.createdAt.getTime()))),
    rule,
    line(padLine("", RECEIPT_ISSUER)),
  ]);
