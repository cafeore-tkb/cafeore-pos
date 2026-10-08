import {
  type CaosCard,
  type ColorSetting,
  DRIPPER_NUMBERS,
  IMMINENT_SEC,
  STANDBY_LABEL,
  brewDurationLabel,
  brewDurationSec,
  caosLane,
  formatMinSec,
  formatRemainingLabel,
  planLane,
} from "@cafeore/common";
import type { Barista, CardBean, OrderTicket, UnassignedOrder } from "../types";
import type { BeanIndex } from "../utils/beans";
import { masterCardColor } from "../utils/masterColor";
import { orderNumber } from "../utils/orderQueue";

// 注文のカップから組み立てたカード（@cafeore/common の buildCaosCards）を、管制盤が使う形（列ごとの待機と未割当）にする。
// カードは注文のカップ（商品・種類・指名）をそのまま持つので、表示の情報はカードのカップから取る。
// 操作の画面（App.tsx）と閲覧だけの画面（ReadOnlyBoard.tsx）で同じものを使う。

const orderLabel = (orderNo: number) =>
  `#${orderNo.toString().padStart(3, "0")}`;

// 盤面の秒（その日の始まりからの秒）。抽出の開始・終了の時刻はサーバーが付けた時刻
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
  const itemType = first.item.item_type;
  // 豆は在庫の「商品 → 豆」から引く（カードの商品が使う在庫対象をまとめる）
  const beans = new Map<string, CardBean>();
  for (const cup of card.cups) {
    if (!cup.item.id) continue;
    for (const bean of beanIndex.get(cup.item.id) ?? []) {
      beans.set(bean.id, bean);
    }
  }
  const sourceOrderIds = Array.from(
    new Set(card.cups.map((cup) => orderLabel(cup.orderNo))),
  ).sort((a, b) => orderNumber(a) - orderNumber(b));
  const merged = sourceOrderIds.length > 1;
  // 指名の番号（明細の dripper）のカードは、その番号のドリッパーにだけ置ける。統合したカードも同じ番号どうし。
  // 指名の表示はマスターの画面と同じ assignmentDisplay（buildCaosCards がカップの nominee に入れる）。
  // 番号は「2nd」、番号の無い自由記述だけの古い明細は自由記述（ドリッパーには固定しない）
  const preferredBaristaId = card.nominatedDripper;
  const nominee =
    Array.from(
      new Set(card.cups.flatMap((cup) => (cup.nominee ? [cup.nominee] : []))),
    ).join("・") || undefined;
  // 限定（種類の senior_only）の印。呼び方はその種類の表示名（display_name）をそのまま。
  // 置けるのは担当者が上級生のドリッパーだけ（App と サーバーが確かめる。@cafeore/common の seniorOnlyBlock）。
  // 指名の番号のある限定のカードは、指名のドリッパーの担当者が上級生のときだけ置ける
  const limited = card.seniorOnly ? `（${itemType.display_name}）` : "";
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
    // 名前は商品の略称（abbr）をそのまま
    beanName: `${abbrs}${limited}`,
    // 区分は商品の種類の表示名をそのまま
    typeName: itemType.display_name,
    // 色はマスターの画面の色の設定（統合カードは先頭のカップの商品の色）。設定が無ければ付けない
    color: masterCardColor(colorSettings, {
      id: first.item.id,
      typeId: itemType.id,
    }),
    itemKey: first.item.id ?? first.item.name,
    beans: Array.from(beans.values()),
    cupCount: card.cups.length,
    preferredBaristaId,
    nominee,
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
// 抽出中・待機のカードの予定時刻は、抽出中のカードの開始時刻（サーバーが付けた時刻）から毎回計算する
// （planLane。@cafeore/common の caosTiming）。
// カードの並びは buildCaosCards のまま（未割当は注文番号の順、待機はドリッパーの中の順番）。
export const cardsToBoard = (
  cards: CaosCard[],
  baristas: Barista[],
  nowSec: number,
  dayStartMs: number,
  // マスターの画面の色の設定（カードの色をマスターと同じにする）
  colorSettings: ColorSetting[] = [],
  // 商品 → 豆（POS の在庫の設定）
  beanIndex: BeanIndex = new Map(),
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
    const totalDurationSec = brewDurationSec(card.cups.length);
    return {
      ...describe(card, orderParts, colorSettings, beanIndex),
      status,
      totalDurationSec,
      scheduledTimeStr: formatMinSec(totalDurationSec),
      startTimeSec: toSec(card.startedAt, dayStartMs),
      endTimeSec: toSec(card.finishedAt, dayStartMs),
      completedAtSec: toSec(card.finishedAt, dayStartMs),
    };
  };

  const boardBaristas = baristas.map((barista): Barista => {
    const { brewing, queued, done } = caosLane(cards, barista.id);

    const brewingTicket = brewing ? toTicket(brewing, "brewing") : undefined;
    const queuedTickets = queued.map((card) => toTicket(card, "scheduled"));
    const plan = planLane(
      nowSec,
      brewingTicket && {
        startSec: brewingTicket.startTimeSec,
        durationSec: brewingTicket.totalDurationSec,
      },
      queuedTickets.map((ticket) => ticket.totalDurationSec),
    );
    const queue: OrderTicket[] = [];
    if (brewingTicket && plan.brewing) {
      queue.push({
        ...brewingTicket,
        startTimeSec: plan.brewing.startSec,
        timeRemainingSec: plan.brewing.remainingSec,
      });
    }
    queuedTickets.forEach((ticket, index) => {
      queue.push({
        ...ticket,
        startTimeSec: plan.queued[index].startSec,
        timeRemainingSec: undefined,
      });
    });

    const remainingSec = plan.brewing?.remainingSec ?? 0;
    return {
      ...barista,
      status: plan.brewing
        ? remainingSec <= IMMINENT_SEC
          ? "imminent"
          : "brewing"
        : "standby",
      remainingStr: plan.brewing
        ? formatRemainingLabel(remainingSec)
        : STANDBY_LABEL,
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
        predictedTimeStr: brewDurationLabel(cups),
        recommendedBaristas: info.preferredBaristaId
          ? `ドリッパー ${info.preferredBaristaId}`
          : "全ドリッパー",
        recommendedBayIds: info.preferredBaristaId
          ? [info.preferredBaristaId]
          : [...DRIPPER_NUMBERS],
        mergeKey: `${card.cups[0].item.id}\u0000${card.nominatedDripper ?? ""}`,
      };
    });

  return {
    baristas: boardBaristas,
    unassignedOrders,
    cards: new Map(cards.map((card) => [card.key, card])),
  };
};
