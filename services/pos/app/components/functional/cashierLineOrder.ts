import {
  type OrderEntity,
  type WithId,
  buildCaosCards,
  sortOrderLines,
  splitItemKey,
} from "@cafeore/common";

/**
 * 送る注文の明細の順
 *
 * レジが送る注文の明細を、注文番号ごとに分けていたときの組み方（sortOrderLines）の順に並べ替える。注文番号は 1 つのまま。
 * 前の注文と同じ商品の 1 杯を先に、2 杯のまとまりを次に、残りの 1 杯を後に並べる。
 * 並べ替えるのは送る注文だけで、レジの一覧・シール・レシートは入れた順のまま。
 */

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

/**
 * 明細を並べ替えた注文（複製）。払った明細の位置（payments の menuIndexes）も並べ替えた位置に直す。
 * 並べ替えなくてよければ order をそのまま返す。prev は前の注文の 1 杯の商品（previousSingles）
 */
export const sortOrderForSubmit = (
  order: OrderEntity,
  prev: readonly string[],
): OrderEntity => {
  const indexes = sortOrderLines(
    order.menus.map((menu, index) => ({ key: index, menu })),
    prev,
  );
  if (indexes.every((index, position) => index === position)) return order;
  const sorted = order.clone();
  const menus = sorted.menus;
  sorted.menus = indexes.map((index) => menus[index]);
  const positions = new Map(
    indexes.map((index, position) => [index, position]),
  );
  sorted.payments = sorted.payments.map((payment) => ({
    ...payment,
    menuIndexes: payment.menuIndexes
      .map((index) => positions.get(index) ?? index)
      .sort((a, b) => a - b),
  }));
  return sorted;
};
