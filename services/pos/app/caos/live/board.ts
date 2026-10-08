import {
  CAOS_DRIPPER_IDS,
  type CaosCard,
  type ColorSetting,
  caosBrewSec,
  caosClockLabel,
  caosDurationLabel,
  caosLane,
  caosMergeKey,
  planCaosLane,
  resolveItemColor,
} from "@cafeore/common";
import type { Barista, CardBean, OrderTicket, UnassignedOrder } from "../types";
import type { BeanIndex } from "../utils/beans";
import { orderNumber } from "../utils/orderQueue";

// 注文のカップから組み立てたカード（@cafeore/common の buildCaosCards）を、管制盤が使う形（列ごとの待機と未割当）にする。
// 豆・区分・色はカードのカップ（商品・種類）から、POS の API の値をそのまま取る。

const orderLabel = (orderNo: number) =>
  `#${orderNo.toString().padStart(3, "0")}`;

const toSec = (date: Date | null, dayStartMs: number) =>
  date === null ? undefined : Math.floor((date.getTime() - dayStartMs) / 1000);

// カード 1 枚分の表示用の情報。抽出カード（OrderTicket）にも未割当カード（UnassignedOrder）にも使う。
const describe = (
  card: CaosCard,
  orderParts: Map<string, CaosCard[]>,
  colorSettings: ColorSetting[],
  beanIndex: BeanIndex,
) => {
  const first = card.cups[0];
  // 豆は在庫の「商品 → 豆」から引く（カードの商品が使う在庫対象をまとめる）
  const beans = new Map<string, CardBean>();
  for (const cup of card.cups) {
    for (const bean of (cup.item.id && beanIndex.get(cup.item.id)) || []) {
      beans.set(bean.id, bean);
    }
  }
  const sourceOrderIds = Array.from(
    new Set(card.cups.map((cup) => orderLabel(cup.orderNo))),
  ).sort((a, b) => orderNumber(a) - orderNumber(b));
  const merged = sourceOrderIds.length > 1;
  // 指名は自由記述のまま出す（ドリッパーの指名は CaOS6 で明細の dripper から入れる）
  const nominee = first.nominee ? `（指名:${first.nominee}）` : "";
  // 限定（種類の senior_only）。上級生の列だけにするのは列の担当者を持ってから（CaOS7）。今は印だけで、文字はその種類の表示名
  const seniorType = card.cups.find((cup) => cup.item.item_type.senior_only)
    ?.item.item_type;
  const limited = seniorType ? `（${seniorType.display_name}）` : "";
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
    beanName: `${abbrs}${nominee}${limited}`,
    // 色は色の設定（画面 master。商品 > 種類）だけ。無ければ白。統合カードは先頭のカップの商品の色
    color: resolveItemColor(colorSettings, first.item, "master") ?? "#ffffff",
    itemKey: first.item.id ?? first.item.name,
    beans: Array.from(beans.values()),
    typeName: first.item.item_type.display_name,
    cupCount: card.cups.length,
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
// 抽出中・待機のカードの予定時刻（開始・終了）は、抽出中のカードの開始時刻（サーバーが付けた時刻）から毎回 planCaosLane で決める。
// タイムライン（BayLaneRow）はこの時刻をそのまま使う。
// カードの並びは buildCaosCards のまま（未割当は注文番号の順、待機はドリッパーの中の順番）。
export const cardsToBoard = (
  cards: CaosCard[],
  baristas: Barista[],
  nowSec: number,
  dayStartMs: number,
  // 色の設定（POS の API）
  colorSettings: ColorSetting[],
  // 商品 → 豆（POS の在庫の設定）
  beanIndex: BeanIndex,
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
    const totalDurationSec = caosBrewSec(card.cups.length);
    return {
      ...describe(card, orderParts, colorSettings, beanIndex),
      status,
      totalDurationSec,
      scheduledTimeStr: caosDurationLabel(totalDurationSec),
      startTimeSec: toSec(card.startedAt, dayStartMs),
      endTimeSec: toSec(card.finishedAt, dayStartMs),
      completedAtSec: toSec(card.finishedAt, dayStartMs),
    };
  };

  const boardBaristas = baristas.map((barista): Barista => {
    const { brewing, queued, done } = caosLane(cards, barista.id);

    const brewingTicket = brewing && toTicket(brewing, "brewing");
    const queuedTickets = queued.map((card) => toTicket(card, "scheduled"));
    const plan = planCaosLane(
      nowSec,
      brewingTicket && {
        startSec: brewingTicket.startTimeSec,
        durationSec: brewingTicket.totalDurationSec,
      },
      queuedTickets.map((ticket) => ticket.totalDurationSec),
    );
    const queue: OrderTicket[] = [];
    const remainingSec = plan.brewing?.remainingSec ?? 0;
    if (brewingTicket && plan.brewing) {
      queue.push({
        ...brewingTicket,
        startTimeSec: plan.brewing.startSec,
        endTimeSec: plan.brewing.endSec,
        timeRemainingSec: remainingSec,
      });
    }
    queuedTickets.forEach((ticket, index) => {
      queue.push({
        ...ticket,
        startTimeSec: plan.queued[index].startSec,
        endTimeSec: plan.queued[index].endSec,
        timeRemainingSec: undefined,
      });
    });

    return {
      ...barista,
      status: brewing
        ? remainingSec <= 15
          ? "imminent"
          : "brewing"
        : "standby",
      remainingStr: brewing
        ? `${caosClockLabel(remainingSec)} 残り`
        : "00:00 待機中",
      queue,
      pastTickets: done.map((card) => toTicket(card, "completed")),
    };
  });

  const unassignedOrders = cards
    .filter((card) => card.status === "unassigned")
    .map((card): UnassignedOrder => {
      const info = describe(card, orderParts, colorSettings, beanIndex);
      const cups = card.cups.length;
      return {
        ...info,
        // 未割当で dripId のあるカードは統合したもの
        badgeTag: `${cups}杯${card.dripId ? " 統合" : ""}`,
        predictedTimeStr: caosDurationLabel(caosBrewSec(cups)),
        recommendedBaristas: "全ドリッパー",
        recommendedBayIds: [...CAOS_DRIPPER_IDS],
        mergeKey: caosMergeKey(card),
      };
    });

  return {
    baristas: boardBaristas,
    unassignedOrders,
    cards: new Map(cards.map((card) => [card.key, card])),
  };
};
