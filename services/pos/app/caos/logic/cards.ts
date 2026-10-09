import type { StockResource } from "@cafeore/common";

// カード（1 回のドリップ。最大 2 杯）。未割当のカードも、ドリッパーのカードも同じ形。
// cafeore-pos の注文から組み立てる（logic/posOrders.ts）。実データテストのカードは logic/historical.ts。
export interface DripCard {
  /** 画面の中でカードを指すキー */
  ticketUid: string;
  /** 注文番号。統合したカードは元の注文すべて（小さい順）。表示は orderLabel で整える */
  orderNos: number[];
  /** 同じ注文の中のカードの並び（1 始まり）・カードの数・注文の杯数。統合したカードは 1・1・2 */
  itemIndex: number;
  totalItemsInOrder: number;
  totalOrderCups: number;
  /** カードの名前。cafeore-pos の注文のカードは商品の略称（abbr）をそのまま */
  beanName: string;
  cupCount: number;
  /** 色の設定を引く商品（cafeore-pos の注文のカードにだけ付く） */
  item?: { id?: string; item_type: { id?: string } };
  /** 背景色（#RRGGBB）。item から色の設定（画面 master）を引いて付ける（logic/posOrders.ts の paintBoard） */
  color?: string;
  /** 区分。商品の種類の表示名（display_name）をそのまま（cafeore-pos の注文のカードにだけ付く） */
  typeName?: string;
  /** 豆（POS の在庫対象のうち kind が bean）。item から在庫の設定の「商品 → 豆」を引いて付ける（logic/beans.ts の attachBeans）。設定が無い商品は空 */
  beans?: StockResource[];
  /** 指名のドリッパー（1〜6） */
  preferredBaristaId?: number;
  /** 統合できる相手を決めるキー。同じキーの 1 杯どうしだけ統合できる（注文のカードは商品と指名） */
  mergeKey: string;
  /** 緊急の入れ直し */
  isRebrew?: boolean;
  /** cafeore-pos の注文の ID（UUID）。POS 側で準備完了・提供済み・削除になったら未割当から外す */
  posOrderId?: string;
  /** 統合したカードの元のカード（元の注文の一部だけ取り下げられたら、残りの注文のカードに戻す） */
  mergedFrom?: DripCard[];
}

// ドリッパーのカード（抽出中・待機・終わり）
export interface OrderTicket extends DripCard {
  status: "brewing" | "scheduled" | "completed";
  /** 抽出中のカードの残り（秒） */
  timeRemainingSec?: number;
  totalDurationSec: number;
  /** 抽出の開始・終了（盤面の秒。その日の 0:00 からの秒）。終わったカードの終了は終えた時刻 */
  startTimeSec?: number;
  endTimeSec?: number;
  /** 入れ直しのために途中で止めた */
  isInterrupted?: boolean;
}

// カードの決まり（1 回のドリップ。最大 2 杯）

/** 1 枚のカードで淹れる最大の杯数 */
export const MAX_CUPS = 2;

/** 1 枚のカードの抽出時間（秒）。全ドリッパー同じ（1 杯 135 秒・2 杯 195 秒） */
export const brewSec = (cups: number) => (cups > 1 ? 195 : 135);

/** 注文番号を 3 桁に（「007」） */
export const orderNoLabel = (no: number) => no.toString().padStart(3, "0");

/** 注文番号の表示（「#152」、統合したカードは「#152+#160」）。選んだ注文を指すキーにも使う */
export const orderLabel = (card: { orderNos: readonly number[] }) =>
  card.orderNos.map((no) => `#${orderNoLabel(no)}`).join("+");

/** カードを注文ごとにまとめる（並びはそのまま）。キーは orderLabel */
export const groupByOrder = <T extends DripCard>(cards: readonly T[]) => {
  const groups = new Map<string, T[]>();
  for (const card of cards) {
    const key = orderLabel(card);
    groups.set(key, [...(groups.get(key) ?? []), card]);
  }
  return groups;
};

/** 格子の置き場所。注文ごとに行を改め、1 行に perRow 枚まで（gridColumn・gridRow は 1 始まり） */
export const placeByOrder = <T extends DripCard>(
  cards: readonly T[],
  perRow: number,
) => {
  let nextRow = 1;
  return [...groupByOrder(cards).values()].flatMap((group) => {
    const placed = group.map((card, index) => ({
      card,
      gridColumn: (index % perRow) + 1,
      gridRow: nextRow + Math.floor(index / perRow),
    }));
    nextRow += Math.ceil(group.length / perRow);
    return placed;
  });
};

/** 注文番号・注文の中の順に並べる */
export const compareCards = (a: DripCard, b: DripCard) =>
  a.orderNos[0] - b.orderNos[0] ||
  a.itemIndex - b.itemIndex ||
  a.ticketUid.localeCompare(b.ticketUid);

/** 未割当の並び。入れ直しを先に、あとは注文番号・注文の中の順 */
export const compareUnassigned = (a: DripCard, b: DripCard) =>
  Number(Boolean(b.isRebrew)) - Number(Boolean(a.isRebrew)) ||
  compareCards(a, b);

/** カードの杯数の合計 */
export const totalCups = (cards: readonly { cupCount: number }[]) =>
  cards.reduce((sum, card) => sum + card.cupCount, 0);

// 1 杯どうしで、統合の相手を決めるキー（mergeKey。商品と指名）が同じものだけを、2 杯の同時抽出へ統合できる（入れ直しは除く）
export const canMergeDripUnits = (first: DripCard, second: DripCard) =>
  first.ticketUid !== second.ticketUid &&
  !first.isRebrew &&
  !second.isRebrew &&
  first.cupCount === 1 &&
  second.cupCount === 1 &&
  first.mergeKey === second.mergeKey;

/** 1 杯どうしを統合した 2 杯のカード。元のカードは mergedFrom に持つ（注文の ID は元のカードで見る） */
export const mergeCards = (first: DripCard, second: DripCard): DripCard => ({
  ...first,
  posOrderId: undefined,
  mergedFrom: [first, second],
  ticketUid: `merged-${[first.ticketUid, second.ticketUid].sort().join("-")}`,
  orderNos: Array.from(new Set([...first.orderNos, ...second.orderNos])).sort(
    (a, b) => a - b,
  ),
  itemIndex: 1,
  totalItemsInOrder: 1,
  totalOrderCups: MAX_CUPS,
  cupCount: MAX_CUPS,
});

/** ドリッパーのカードを未割当のカードに戻す（時刻や状態を落とす） */
export const toCard = ({
  status: _status,
  timeRemainingSec: _remaining,
  totalDurationSec: _duration,
  startTimeSec: _start,
  endTimeSec: _end,
  isInterrupted: _interrupted,
  ...card
}: OrderTicket): DripCard => card;

/** 未割当のカードをドリッパーの待機のカードにする */
export const toTicket = (card: DripCard): OrderTicket => ({
  ...card,
  status: "scheduled",
  totalDurationSec: brewSec(card.cupCount),
});

/** 分ける前のカード（注文の中の並び・カードの数・注文の杯数がまだ無い） */
export type UnsplitCard = Omit<
  DripCard,
  "itemIndex" | "totalItemsInOrder" | "totalOrderCups"
>;

// 注文のカードを最大杯数（MAX_CUPS）ずつに分け、注文の中の並び・カードの数・注文の杯数を付ける
export const splitIntoDripUnits = (cards: UnsplitCard[]): DripCard[] => {
  const totalOrderCups = totalCups(cards);
  const units = cards.flatMap((card) =>
    Array.from({ length: Math.ceil(card.cupCount / MAX_CUPS) }, (_, index) => ({
      ...card,
      ticketUid: `${card.ticketUid}-part${index + 1}`,
      cupCount: Math.min(MAX_CUPS, card.cupCount - index * MAX_CUPS),
    })),
  );
  return units.map((unit, index) => ({
    ...unit,
    itemIndex: index + 1,
    totalItemsInOrder: units.length,
    totalOrderCups,
  }));
};
