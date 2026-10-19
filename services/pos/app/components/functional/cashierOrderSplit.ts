import {
  type MenuEntity,
  OrderEntity,
  type WithId,
  buildCaosCards,
  planOrderSplit,
  shouldSplitOrder,
  splitItemKey,
} from "@cafeore/common";
import type { CashierDraft, CashierLine } from "./cashierDraft";

/**
 * 分割して一括会計（注文番号ごとに分けて、全額をまとめて会計する）
 *
 * 分割を推奨する注文（shouldSplitOrder）を注文番号ごとに分ける。分け方は会計に進むときに決め（planOrderSplit。
 * 前の注文と同じ商品の 1 杯を先頭の番号に入れる）、会計中に「分け方を編集」で直せる。
 * 会計（受取金額・Square・小計分割）はこれまでどおり全額で行い、払い終えたら分けた注文をまとめて送る
 * （1 つ目の注文が支払いを全部持ち、2 つ目以降は splitOrders で一緒に作る）。番号は今の番号から続けて使う。
 */

/** 分け方の編集で足せる番号の数 */
export const MAX_ORDER_SPLIT = 4;

/** 分け方 */
export type OrderSplit = {
  /** 番号の数（2 つ以上） */
  count: number;
  /** 行（CashierLine.key）→ 何番目の番号か（0 始まり）。無ければ 1 つ目 */
  assign: Record<number, number>;
};

/** 行が入る番号（0 始まり） */
export const splitGroupOf = (split: OrderSplit, key: number) =>
  split.assign[key] ?? 0;

/**
 * 前の注文（今の番号のすぐ前の番号の、キャンセルしていない注文）の、まだ抽出を始めていない 1 杯のカードの商品
 * （splitItemKey）。CaOS で統合できる相手（未割当か待機の、入れ直しでない 1 杯のカード）だけを数える
 */
export const previousSingles = (
  orders: readonly WithId<OrderEntity>[],
  orderId: number,
): string[] => {
  const previous = orders
    .filter((order) => order.orderId < orderId && !order.isCancelled())
    .reduce<WithId<OrderEntity> | undefined>(
      (latest, order) =>
        latest === undefined || order.orderId > latest.orderId ? order : latest,
      undefined,
    );
  if (previous === undefined) return [];
  return buildCaosCards([previous])
    .filter(
      (card) =>
        (card.status === "unassigned" || card.status === "queued") &&
        card.cups.length === 1 &&
        !card.emergency,
    )
    .map((card) => splitItemKey(card.cups[0].item));
};

/** 分け方を決める。分けなくてよければ null */
export const suggestOrderSplit = (
  lines: readonly CashierLine[],
  prev: readonly string[],
): OrderSplit | null => {
  const groups = planOrderSplit(lines, prev);
  if (groups === null) return null;
  return {
    count: groups.length,
    assign: Object.fromEntries(
      groups.flatMap((keys, group) => keys.map((key) => [key, group])),
    ),
  };
};

/** 分け方を決めて会計の段階に進んだ下書き（分けなくてよければ分けずに進む）。beginRest のあとに呼ぶ */
export const withOrderSplit = (
  draft: CashierDraft,
  split: OrderSplit | null,
): CashierDraft =>
  draft.step === "pay" ? { ...draft, orderSplit: split } : draft;

/** 分けた注文 1 つ分（画面に出す） */
export type OrderSplitGroup = {
  /** 何番目か（0 始まり） */
  index: number;
  /** 注文番号 */
  orderId: number;
  lines: CashierLine[];
  /** 抽出が要るコーヒーの杯数 */
  cups: number;
  /** まだドリッパーを 3 人以上使う（shouldSplitOrder） */
  needsSplit: boolean;
};

const brewCups = (menu: MenuEntity) =>
  menu.items.reduce(
    (acc, { item, quantity }) =>
      acc + (item.item_type.needs_brew ? quantity : 0),
    0,
  );

/** 分けた注文ごとの商品（番号は firstOrderId から続けて） */
export const orderSplitGroups = (
  lines: readonly CashierLine[],
  split: OrderSplit,
  firstOrderId: number,
): OrderSplitGroup[] =>
  Array.from({ length: split.count }, (_, index) => {
    const mine = lines.filter(
      (line) => splitGroupOf(split, line.key) === index,
    );
    const menus = mine.map((line) => line.menu);
    return {
      index,
      orderId: firstOrderId + index,
      lines: mine,
      cups: menus.reduce((acc, menu) => acc + brewCups(menu), 0),
      needsSplit: shouldSplitOrder(menus),
    };
  });

/** 商品の一覧（「ブレンド×2・浅煎り」） */
export const splitItemsText = (lines: readonly CashierLine[]) => {
  const counts = new Map<string, number>();
  for (const line of lines) {
    counts.set(line.menu.name, (counts.get(line.menu.name) ?? 0) + 1);
  }
  return [...counts]
    .map(([name, n]) => (n > 1 ? `${name}×${n}` : name))
    .join("・");
};

/** 分けた注文の番号（No.124・125 の 124, 125） */
export const splitOrderIds = (split: OrderSplit, firstOrderId: number) =>
  Array.from({ length: split.count }, (_, index) => firstOrderId + index);

/**
 * 送る注文（全部の商品を入れた注文。番号は 1 つ目、支払いは payments）を、分け方どおりの注文に分ける。
 * 1 つ目の注文に 2 つ目以降（splitOrders）を付けて返す。
 *   - 割引の杯は、1 つ目の注文から順に、その注文のコーヒーの杯数まで割り振る（引換券の番号は割り振った注文にだけ付ける）
 *   - 支払い（payments）は 1 つ目の注文がまとめて持つ。払った明細は 1 つ目の注文の明細を全部指す
 *   - 特記事項などのコメントは、どの注文にも付ける（作る人がどの番号でも読めるように）
 */
export const splitOrdersForSubmit = (
  order: OrderEntity,
  lines: readonly CashierLine[],
  split: OrderSplit,
): OrderEntity => {
  const base = order.toOrder();
  let discountCups = Math.min(
    order.getCoffeeCups().length,
    order.discountOrderCups,
  );
  const orders = orderSplitGroups(lines, split, order.orderId).map((group) => {
    const cups = Math.min(group.cups, discountCups);
    discountCups -= cups;
    return OrderEntity.fromOrder({
      ...base,
      orderId: group.orderId,
      menus: group.lines.map((line) => line.menu.toMenu()),
      discountOrderId: cups > 0 ? order.discountOrderId : null,
      discountOrderCups: cups,
      splitOrders: [],
    });
  });
  const [first, ...rest] = orders;
  const indexes = first.menus.map((_, index) => index);
  first.payments = order.payments.map((payment) => ({
    ...payment,
    menuIndexes: indexes,
  }));
  for (const child of rest) {
    child.received = 0;
    child.payments = [];
  }
  first.splitOrders = rest;
  return first;
};
