import {
  type CaosCard,
  type ColorSetting,
  type StockResource,
  resolveItemColor,
} from "@cafeore/common";
import { type BeanIndex, cardBean } from "./beans";

// カード（1 回のドリップ。最大 2 杯）の見せ方。カードは注文のカップから組み立てたもの（@cafeore/common の buildCaosCards の CaosCard）を
// そのまま使い、名前・注文番号・色・分割の表示はここで引く。

const unique = <T>(values: T[]) => Array.from(new Set(values));

/** 注文番号を 3 桁に（「007」） */
export const orderNoLabel = (no: number) => no.toString().padStart(3, "0");

/** カードの注文番号。統合したカードは元の注文すべて（小さい順） */
export const cardOrderNos = (card: CaosCard) =>
  unique(card.cups.map((cup) => cup.orderNo)).sort((a, b) => a - b);

/** 注文番号の表示（「#152」、統合したカードは「#152+#160」）。選んだ注文を指すキーにも使う */
export const orderLabel = (card: CaosCard) =>
  cardOrderNos(card)
    .map((no) => `#${orderNoLabel(no)}`)
    .join("+");

/** カードの商品の名前（略称 abbr をそのまま。統合したカードも同じ商品なので 1 つ） */
export const cardItemName = (card: CaosCard) =>
  unique(card.cups.map((cup) => cup.item.abbr)).join("・");

/** カードの指名（「2nd」。番号の無い古い明細は自由記述）。指名なしは空 */
export const cardNominee = (card: CaosCard) =>
  unique(card.cups.flatMap((cup) => cup.nominee ?? [])).join("・");

/**
 * カードの名前（文で出すところ）。商品の略称に、指名は「（指名:2nd）」、
 * 上級生のみ（@cafeore/common の cupSeniorOnly）は「（上級生のみ）」を添える
 */
export const cardName = (card: CaosCard) => {
  const nominee = cardNominee(card);
  return [
    cardItemName(card),
    nominee ? `（指名:${nominee}）` : "",
    card.seniorOnly ? "（上級生のみ）" : "",
  ].join("");
};

/** 区分。商品の種類の表示名（display_name）をそのまま */
export const cardTypeName = (card: CaosCard) =>
  card.cups[0].item.item_type.display_name;

/** カードの杯数の合計 */
export const totalCups = (cards: readonly CaosCard[]) =>
  cards.reduce((sum, card) => sum + card.cups.length, 0);

/** 分けた注文の中のカード（「1/3・計4杯」）。index は 1 始まり */
export interface CardSplit {
  index: number;
  total: number;
  cups: number;
}

/** カードの見せ方（色の設定の色・アイテムの在庫の豆と、分けた注文の中の位置） */
export interface CardLook {
  /** 背景色（#RRGGBB）。商品の色の設定（画面 master。指名の番号のあるカードは画面 nominated、無ければ master。商品 → 種類の順）。無ければ白 */
  color?: string;
  /** 1 注文だけのカードで、注文が 2 枚以上に分かれているときだけ */
  split?: CardSplit;
  /** 豆（POS の在庫のうち、カードの商品のアイテムの在庫）。logic/beans.ts で引く。在庫が無い商品には付かない */
  bean?: StockResource;
}
export type CardLooks = ReadonlyMap<string, CardLook>;

/** カードごとの見せ方（キーはカードの key）。色の設定と在庫はあとから読み込まれたり変わったりするので、出すたびに引く */
export const cardLooks = (
  cards: readonly CaosCard[],
  settings: ColorSetting[],
  beanIndex: BeanIndex,
): CardLooks => {
  // 1 注文だけのカードを、注文ごとに注文の中の並び（カップの position）で並べる（割り当てても番号が変わらないように）
  const byOrder = new Map<string, CaosCard[]>();
  for (const card of cards) {
    if (cardOrderNos(card).length > 1) continue;
    const orderId = card.cups[0].orderId;
    byOrder.set(orderId, [...(byOrder.get(orderId) ?? []), card]);
  }
  for (const parts of byOrder.values())
    parts.sort((a, b) => a.cups[0].position - b.cups[0].position);
  const splitOf = (card: CaosCard): CardSplit | undefined => {
    if (cardOrderNos(card).length > 1) return undefined;
    const parts = byOrder.get(card.cups[0].orderId) ?? [card];
    if (parts.length <= 1) return undefined;
    return {
      index: parts.indexOf(card) + 1,
      total: parts.length,
      cups: totalCups(parts),
    };
  };
  return new Map(
    cards.map((card) => [
      card.key,
      {
        color:
          (card.cups[0].nominatedDripper !== null
            ? resolveItemColor(settings, card.cups[0].item, "nominated")
            : undefined) ??
          resolveItemColor(settings, card.cups[0].item, "master"),
        split: splitOf(card),
        bean: cardBean(card, beanIndex),
      },
    ]),
  );
};

/** カードを注文ごとにまとめる（並びはそのまま）。キーは orderLabel */
export const groupByOrder = (cards: readonly CaosCard[]) => {
  const groups = new Map<string, CaosCard[]>();
  for (const card of cards) {
    const key = orderLabel(card);
    groups.set(key, [...(groups.get(key) ?? []), card]);
  }
  return groups;
};

/** 注文の行の 1 枚。mergedInto は、ほかの注文と統合したカードを、小さくないほうの注文の行に残した跡（統合したカードの orderLabel） */
export interface OrderRowEntry {
  card: CaosCard;
  mergedInto?: string;
}

/**
 * カードを注文番号の行にまとめる（注文番号の順、行の中は注文の中の並び）。
 * 統合したカードはいちばん小さい注文番号の行に置き、ほかの注文の行には跡（mergedInto）を残す
 */
export const orderRows = (cards: readonly CaosCard[]) => {
  const rows = new Map<number, OrderRowEntry[]>();
  for (const card of cards) {
    const [first, ...others] = cardOrderNos(card);
    rows.set(first, [...(rows.get(first) ?? []), { card }]);
    for (const no of others)
      rows.set(no, [
        ...(rows.get(no) ?? []),
        { card, mergedInto: orderLabel(card) },
      ]);
  }
  const positionIn = (orderNo: number, { card }: OrderRowEntry) =>
    card.cups.find((cup) => cup.orderNo === orderNo)?.position ?? 0;
  return [...rows]
    .sort(([a], [b]) => a - b)
    .map(([orderNo, entries]) => ({
      orderNo,
      entries: entries.sort(
        (a, b) => positionIn(orderNo, a) - positionIn(orderNo, b),
      ),
    }));
};
export type OrderRow = ReturnType<typeof orderRows>[number];
