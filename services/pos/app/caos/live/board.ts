import type { CaosCard } from "@cafeore/common";
import type { Barista, OrderTicket, UnassignedOrder } from "../types";
import { orderNumber } from "../utils/orderQueue";
import { type PosOrder, nominatedBayId, posBeanCode } from "../utils/posOrders";

// cafeore-pos の盤面（WebSocket の drips）を、管制盤が使う形（列ごとの待機と未割当）に組み立てる。
// カードはカップの ID しか持たないので、注文番号・商品・指名は注文（orders）のカップから引く。

const ONE_CUP_SEC = 135;
const TWO_CUP_SEC = 195;
const durationOf = (cups: number) => (cups > 1 ? TWO_CUP_SEC : ONE_CUP_SEC);

/** 注文のカップ 1 杯（カードの表示に使う） */
export interface LiveCup {
  orderId: string;
  orderNo: number;
  name: string;
  abbr: string;
  type: string;
  assignee: string | null;
}

/** カップの ID → カップ。注文から作る */
export type CupCatalog = Map<string, LiveCup>;

export const buildCupCatalog = (orders: PosOrder[] | null): CupCatalog => {
  const catalog: CupCatalog = new Map();
  for (const order of orders ?? []) {
    for (const cup of order.getCups()) {
      if (!cup.cupId) continue;
      catalog.set(cup.cupId, {
        orderId: order.id,
        orderNo: order.orderId,
        name: cup.name,
        abbr: cup.abbr,
        type: cup.item_type.name,
        assignee: cup.assignee,
      });
    }
  }
  return catalog;
};

/** カードを画面の中で指すキー（ticketUid）。未割当のカードは ID が無いので、カップの ID の組で指す */
export const cardKey = (card: CaosCard) =>
  card.id ?? `cups:${card.cups.map((cup) => cup.id).join(",")}`;

const orderLabel = (orderNo: number) =>
  `#${orderNo.toString().padStart(3, "0")}`;

const cardColorOf = (
  beanCode: UnassignedOrder["beanCode"],
): UnassignedOrder["cardColor"] =>
  beanCode === "ICE"
    ? "cyan"
    : beanCode === "SP"
      ? "emerald"
      : beanCode === "KEN"
        ? "peach"
        : "blue";

const toSec = (iso: string | null, dayStartMs: number) =>
  iso === null
    ? undefined
    : Math.floor((new Date(iso).getTime() - dayStartMs) / 1000);

// カード 1 枚分の表示用の情報。抽出カード（OrderTicket）にも未割当カード（UnassignedOrder）にも使う。
const describe = (
  card: CaosCard,
  cups: LiveCup[],
  orderParts: Map<string, CaosCard[]>,
) => {
  const first = cups[0];
  const beanCode = posBeanCode(first.name, first.type);
  const sourceOrderIds = Array.from(
    new Set(cups.map((cup) => orderLabel(cup.orderNo))),
  ).sort((a, b) => orderNumber(a) - orderNumber(b));
  const merged = sourceOrderIds.length > 1;
  const nominee = first.assignee?.trim() || undefined;
  const preferredBaristaId = nominee ? nominatedBayId(nominee) : undefined;
  const unmatchedNominee =
    nominee && !preferredBaristaId ? `（指名:${nominee}）` : "";
  const abbrs = Array.from(new Set(cups.map((cup) => cup.abbr))).join("・");

  // 分割の表示（1/3・計4杯）は、1 注文だけのカードに付ける
  const parts = !merged ? orderParts.get(first.orderId) || [card] : [card];
  const itemIndex = parts.findIndex((part) => part === card) + 1;
  const totalOrderCups = parts.reduce((sum, part) => sum + part.cups.length, 0);

  return {
    id: sourceOrderIds.join("+"),
    ticketUid: cardKey(card),
    itemIndex: itemIndex || 1,
    totalItemsInOrder: parts.length,
    totalOrderCups,
    orderNotes: merged
      ? `${sourceOrderIds.join(" + ")} 同時ドリップ`
      : undefined,
    sourceOrderIds: merged ? sourceOrderIds : undefined,
    beanCode,
    beanName: `${abbrs}${unmatchedNominee}`,
    cupCount: card.cups.length,
    preferredBaristaId,
  };
};

export interface LiveBoard {
  baristas: Barista[];
  unassignedOrders: UnassignedOrder[];
  /** ticketUid → カード（操作を送るときに使う） */
  cards: Map<string, CaosCard>;
}

// 盤面のカードを、管制盤が使う形（列ごとの待機と未割当）に組み立てる。
// 待機のカードの予定時刻は、抽出中のカードの開始時刻から毎回計算する。
// カードの並びはサーバーが決めたまま（未割当は注文番号の順、待機は列の中の順番）。
// 注文がまだ届いていないカップのあるカードは、注文番号が分からないので届くまで出さない。
export const cardsToBoard = (
  allCards: CaosCard[],
  catalog: CupCatalog,
  baristas: Barista[],
  nowSec: number,
  dayStartMs: number,
): LiveBoard => {
  const cupsOf = new Map<CaosCard, LiveCup[]>();
  for (const card of allCards) {
    const cups = card.cups.map((cup) => catalog.get(cup.id));
    if (cups.length > 0 && cups.every((cup) => cup !== undefined))
      cupsOf.set(card, cups as LiveCup[]);
  }
  const cards = allCards.filter((card) => cupsOf.has(card));

  // 1 注文だけのカードを、注文ごとに並べる（「1/3」の表示に使う）
  const orderParts = new Map<string, CaosCard[]>();
  for (const card of cards) {
    const cups = cupsOf.get(card) ?? [];
    if (new Set(cups.map((cup) => cup.orderId)).size > 1) continue;
    const parts = orderParts.get(cups[0].orderId) || [];
    parts.push(card);
    orderParts.set(cups[0].orderId, parts);
  }

  const toTicket = (
    card: CaosCard,
    status: OrderTicket["status"],
  ): OrderTicket => {
    const totalDurationSec = durationOf(card.cups.length);
    return {
      ...describe(card, cupsOf.get(card) ?? [], orderParts),
      status,
      totalDurationSec,
      scheduledTimeStr: `${Math.floor(totalDurationSec / 60)}:${(totalDurationSec % 60).toString().padStart(2, "0")}`,
      startTimeSec: toSec(card.started_at, dayStartMs),
      endTimeSec: toSec(card.finished_at, dayStartMs),
      completedAtSec: toSec(card.finished_at, dayStartMs),
    };
  };

  const boardBaristas = baristas.map((barista): Barista => {
    const mine = cards.filter((card) => card.lane === barista.id);
    const brewing = mine.find((card) => card.status === "brewing");
    const queued = mine.filter((card) => card.status === "queued");
    const done = mine.filter((card) => card.status === "done");

    const queue: OrderTicket[] = [];
    let cursor = nowSec;
    let remainingSec: number | undefined;
    if (brewing) {
      const ticket = toTicket(brewing, "brewing");
      const startSec = ticket.startTimeSec ?? nowSec;
      remainingSec = Math.max(0, ticket.totalDurationSec - (nowSec - startSec));
      queue.push({
        ...ticket,
        startTimeSec: startSec,
        timeRemainingSec: remainingSec,
      });
      cursor = Math.max(nowSec, startSec + ticket.totalDurationSec);
    }
    queued.forEach((card, index) => {
      const ticket = toTicket(card, "scheduled");
      // 抽出中が無い（「次へ」で始める）ときは少し先から、あるときは 15 秒の入れ替えを挟む
      const startTimeSec = !brewing && index === 0 ? nowSec + 10 : cursor + 15;
      queue.push({ ...ticket, startTimeSec, timeRemainingSec: undefined });
      cursor = startTimeSec + ticket.totalDurationSec;
    });

    const minutes = Math.floor((remainingSec ?? 0) / 60);
    const seconds = (remainingSec ?? 0) % 60;
    return {
      ...barista,
      status: brewing
        ? (remainingSec ?? 0) <= 15
          ? "imminent"
          : "brewing"
        : "standby",
      remainingStr: brewing
        ? `0${minutes}:${seconds < 10 ? "0" : ""}${seconds} 残り`
        : "00:00 待機中",
      queue,
      pastTickets: done.map((card) => toTicket(card, "completed")),
    };
  });

  const unassignedOrders = cards
    .filter((card) => card.status === "unassigned")
    .map((card): UnassignedOrder => {
      const info = describe(card, cupsOf.get(card) ?? [], orderParts);
      const merged = Boolean(info.sourceOrderIds);
      const cups = card.cups.length;
      return {
        ...info,
        badgeTag: `${cups}杯${merged ? " 統合" : ""}`,
        predictedTimeStr: cups > 1 ? "3分15秒" : "2分15秒",
        recommendedBaristas: info.preferredBaristaId
          ? `ドリッパー ${info.preferredBaristaId}`
          : "全ドリッパー",
        recommendedBayIds: info.preferredBaristaId
          ? [info.preferredBaristaId]
          : [1, 2, 3, 4, 5, 6],
        cardColor: cardColorOf(info.beanCode),
      };
    });

  return {
    baristas: boardBaristas,
    unassignedOrders,
    cards: new Map(cards.map((card) => [cardKey(card), card])),
  };
};
