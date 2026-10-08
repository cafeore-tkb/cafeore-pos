import { type CaosCard, caosLane } from "@cafeore/common";
import type { Barista, OrderTicket, UnassignedOrder } from "../types";
import { orderNumber } from "../utils/orderQueue";
import { posBeanCode } from "../utils/posOrders";

// 注文のカップから組み立てたカード（@cafeore/common の buildCaosCards）を、管制盤が使う形（列ごとの待機と未割当）にする。

const ONE_CUP_SEC = 135;
const TWO_CUP_SEC = 195;
const durationOf = (cups: number) => (cups > 1 ? TWO_CUP_SEC : ONE_CUP_SEC);

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

const toSec = (date: Date | null, dayStartMs: number) =>
  date === null ? undefined : Math.floor((date.getTime() - dayStartMs) / 1000);

// カード 1 枚分の表示用の情報。抽出カード（OrderTicket）にも未割当カード（UnassignedOrder）にも使う。
const describe = (card: CaosCard, orderParts: Map<string, CaosCard[]>) => {
  const first = card.cups[0];
  const beanCode = posBeanCode(first.item.name, first.item.item_type.name);
  const sourceOrderIds = Array.from(
    new Set(card.cups.map((cup) => orderLabel(cup.orderNo))),
  ).sort((a, b) => orderNumber(a) - orderNumber(b));
  const merged = sourceOrderIds.length > 1;
  const nominee = first.nominee ?? undefined;
  const preferredBaristaId = card.nominatedDripper;
  const unmatchedNominee =
    nominee && !preferredBaristaId ? `（指名:${nominee}）` : "";
  // 限定（種類の senior_only）。上級生の列だけにするのは列の担当者を持ってから（CaOS7）。今は印だけ
  const limited = card.seniorOnly ? "（限定）" : "";
  const abbrs = Array.from(new Set(card.cups.map((cup) => cup.item.abbr))).join(
    "・",
  );

  // 分割の表示（1/3・計4杯）は、1 注文だけのカードに付ける
  const parts = !merged ? orderParts.get(first.orderId) || [card] : [card];
  const itemIndex = parts.findIndex((part) => part.key === card.key) + 1;
  const totalOrderCups = parts.reduce((sum, part) => sum + part.cups.length, 0);

  return {
    id: sourceOrderIds.join("+"),
    ticketUid: card.key,
    itemIndex: itemIndex || 1,
    totalItemsInOrder: parts.length,
    totalOrderCups,
    orderNotes: merged
      ? `${sourceOrderIds.join(" + ")} 同時ドリップ`
      : undefined,
    sourceOrderIds: merged ? sourceOrderIds : undefined,
    beanCode,
    beanName: `${abbrs}${unmatchedNominee}${limited}`,
    cupCount: card.cups.length,
    preferredBaristaId,
    seniorOnly: card.seniorOnly,
  };
};

export interface LiveBoard {
  baristas: Barista[];
  unassignedOrders: UnassignedOrder[];
  /** ticketUid（カードの key）→ カード（操作の書き込みを作るときに使う） */
  cards: Map<string, CaosCard>;
}

// カードを、管制盤が使う形（列ごとの待機と未割当）に組み立てる。
// 待機のカードの予定時刻は、抽出中のカードの開始時刻から毎回計算する。
// カードの並びは buildCaosCards のまま（未割当は注文番号の順、待機はドリッパーの中の順番）。
export const cardsToBoard = (
  cards: CaosCard[],
  baristas: Barista[],
  nowSec: number,
  dayStartMs: number,
): LiveBoard => {
  // 1 注文だけのカードを、注文ごとに並べる（「1/3」の表示に使う）
  const orderParts = new Map<string, CaosCard[]>();
  for (const card of cards) {
    if (new Set(card.cups.map((cup) => cup.orderId)).size > 1) continue;
    const parts = orderParts.get(card.cups[0].orderId) || [];
    parts.push(card);
    orderParts.set(card.cups[0].orderId, parts);
  }

  const toTicket = (
    card: CaosCard,
    status: OrderTicket["status"],
  ): OrderTicket => {
    const totalDurationSec = durationOf(card.cups.length);
    return {
      ...describe(card, orderParts),
      status,
      totalDurationSec,
      scheduledTimeStr: `${Math.floor(totalDurationSec / 60)}:${(totalDurationSec % 60).toString().padStart(2, "0")}`,
      startTimeSec: toSec(card.startedAt, dayStartMs),
      endTimeSec: toSec(card.finishedAt, dayStartMs),
      completedAtSec: toSec(card.finishedAt, dayStartMs),
    };
  };

  const boardBaristas = baristas.map((barista): Barista => {
    const { brewing, queued, done } = caosLane(cards, barista.id);

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
      const info = describe(card, orderParts);
      const cups = card.cups.length;
      return {
        ...info,
        // 未割当で dripId のあるカードは統合したもの
        badgeTag: `${cups}杯${card.dripId ? " 統合" : ""}`,
        predictedTimeStr: cups > 1 ? "3分15秒" : "2分15秒",
        recommendedBaristas: info.preferredBaristaId
          ? `ドリッパー ${info.preferredBaristaId}`
          : "全ドリッパー",
        recommendedBayIds: info.preferredBaristaId
          ? [info.preferredBaristaId]
          : [1, 2, 3, 4, 5, 6],
        cardColor: cardColorOf(info.beanCode),
        mergeKey: `${card.cups[0].item.id}\u0000${card.cups[0].nominee ?? ""}`,
      };
    });

  return {
    baristas: boardBaristas,
    unassignedOrders,
    cards: new Map(cards.map((card) => [card.key, card])),
  };
};
