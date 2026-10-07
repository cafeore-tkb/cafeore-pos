import type { Barista, BeanCode, OrderTicket, UnassignedOrder } from "../types";
import { orderNumber } from "../utils/orderQueue";
import {
  type Drip,
  type PosOrder,
  nominatedBayId,
  posBeanCode,
} from "../utils/posOrders";

// cafeore-pos の盤面（抽出カード）を、管制盤が使う形（ドリッパーごとの列と未割当）に組み立てる。
// カードは注文と商品の参照しか持たないので、注文番号や商品名は {"type":"orders"} で届く注文から引く。

const ONE_CUP_SEC = 135;
const TWO_CUP_SEC = 195;
const durationOf = (cups: number) => (cups > 1 ? TWO_CUP_SEC : ONE_CUP_SEC);

interface CatalogItem {
  name: string;
  abbr: string;
  type: string;
}

// 注文 ID → 注文番号と、その注文の商品（商品 ID → 名前・略称・種類）
export type Catalog = Map<
  string,
  { orderNo: number; items: Map<string, CatalogItem> }
>;

export const buildCatalog = (orders: PosOrder[] | null): Catalog => {
  const catalog: Catalog = new Map();
  for (const order of orders ?? []) {
    const items = new Map<string, CatalogItem>();
    for (const line of order.menus) {
      for (const { item } of line.menu.items) {
        items.set(item.id, {
          name: item.name,
          abbr: item.abbr,
          type: item.item_type?.name ?? "",
        });
      }
    }
    catalog.set(order.id, { orderNo: order.order_id, items });
  }
  return catalog;
};

const orderLabel = (orderNo: number | undefined) =>
  orderNo === undefined ? "#???" : `#${orderNo.toString().padStart(3, "0")}`;

const cardColorOf = (beanCode: BeanCode): UnassignedOrder["cardColor"] =>
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

const compareQueue = (a: Drip, b: Drip) =>
  a.queue_pos - b.queue_pos ||
  a.created_at.localeCompare(b.created_at) ||
  a.id.localeCompare(b.id);

// カード 1 枚分の表示用の情報。抽出カード（OrderTicket）にも未割当カード（UnassignedOrder）にも使う。
const describe = (
  drip: Drip,
  baristas: Barista[],
  catalog: Catalog,
  orderParts: Map<string, Drip[]>,
) => {
  const first = drip.lines[0];
  const itemOf = (orderId: string, itemId: string) =>
    catalog.get(orderId)?.items.get(itemId);
  const firstItem = first ? itemOf(first.order_id, first.item_id) : undefined;
  const beanCode = posBeanCode(firstItem?.name ?? "", firstItem?.type ?? "");
  const sourceOrderIds = Array.from(
    new Set(
      drip.lines.map((line) => orderLabel(catalog.get(line.order_id)?.orderNo)),
    ),
  ).sort((a, b) => orderNumber(a) - orderNumber(b));
  const merged = sourceOrderIds.length > 1;
  const nominee = first?.nominee ?? undefined;
  const preferredBaristaId = nominee
    ? nominatedBayId(nominee, baristas)
    : undefined;
  const unmatchedNominee =
    nominee && !preferredBaristaId ? `（指名:${nominee}）` : "";
  const abbrs = Array.from(
    new Set(
      drip.lines.map(
        (line) => itemOf(line.order_id, line.item_id)?.abbr ?? "（不明）",
      ),
    ),
  ).join("・");

  // 分割の表示（1/3・計4杯）は、1 注文だけのカードに付ける。
  const parts =
    !merged && !drip.rebrew_of && first
      ? orderParts.get(first.order_id) || [drip]
      : [drip];
  const itemIndex = parts.findIndex((part) => part.id === drip.id) + 1;
  const totalOrderCups = parts.reduce((sum, part) => sum + part.cups, 0);

  return {
    id: sourceOrderIds.join("+"),
    ticketUid: drip.id,
    itemIndex: itemIndex || 1,
    totalItemsInOrder: parts.length,
    totalOrderCups,
    orderNotes: merged
      ? `${sourceOrderIds.join(" + ")} 同時ドリップ`
      : undefined,
    sourceOrderIds: merged ? sourceOrderIds : undefined,
    beanCode,
    beanName: `${abbrs}${unmatchedNominee}`,
    cupCount: drip.cups,
    preferredBaristaId,
    isRebrew: Boolean(drip.rebrew_of) || undefined,
    rebrewOfTicketUid: drip.rebrew_of ?? undefined,
  };
};

export interface LiveBoard {
  baristas: Barista[];
  unassignedOrders: UnassignedOrder[];
}

// 盤面のカードを、管制盤が使う形（ドリッパーごとの列と未割当）に組み立てる。
// 待機カードの予定時刻は、抽出中のカードの開始時刻から毎回計算する。
export const dripsToBoard = (
  drips: Drip[],
  catalog: Catalog,
  baristas: Barista[],
  nowSec: number,
  dayStartMs: number,
): LiveBoard => {
  const orderParts = new Map<string, Drip[]>();
  for (const drip of drips
    .filter((drip) => drip.order_ids.length === 1 && !drip.rebrew_of)
    .sort(compareQueue)) {
    const parts = orderParts.get(drip.order_ids[0]) || [];
    parts.push(drip);
    orderParts.set(drip.order_ids[0], parts);
  }

  const toTicket = (drip: Drip, status: OrderTicket["status"]): OrderTicket => {
    const totalDurationSec = durationOf(drip.cups);
    return {
      ...describe(drip, baristas, catalog, orderParts),
      tag: drip.rebrew_of ? "入れ直し" : undefined,
      status,
      totalDurationSec,
      scheduledTimeStr: `${Math.floor(totalDurationSec / 60)}:${(totalDurationSec % 60).toString().padStart(2, "0")}`,
      startTimeSec: toSec(drip.started_at, dayStartMs),
      endTimeSec: toSec(drip.finished_at, dayStartMs),
      completedAtSec: toSec(drip.finished_at, dayStartMs),
      isInterrupted: drip.interrupted || undefined,
      queuePos: drip.queue_pos,
    };
  };

  const boardBaristas = baristas.map((barista): Barista => {
    const mine = drips.filter((drip) => drip.dripper === barista.id);
    const brewing = mine.find((drip) => drip.status === "brewing");
    const queued = mine
      .filter((drip) => drip.status === "queued")
      .sort(compareQueue);
    const done = mine
      .filter((drip) => drip.status === "done")
      .sort((a, b) => (a.finished_at || "").localeCompare(b.finished_at || ""));

    const queue: OrderTicket[] = [];
    let cursor = nowSec;
    let remainingSec: number | undefined;
    if (brewing) {
      const ticket = toTicket(brewing, "brewing");
      const startSec = ticket.startTimeSec ?? nowSec;
      remainingSec = Math.max(
        0,
        Math.round(ticket.totalDurationSec * barista.coefficient) -
          (nowSec - startSec),
      );
      queue.push({
        ...ticket,
        startTimeSec: startSec,
        timeRemainingSec: remainingSec,
      });
      cursor = Math.max(nowSec, startSec + ticket.totalDurationSec);
    }
    queued.forEach((drip, index) => {
      const ticket = toTicket(drip, "scheduled");
      // 抽出中が無い（始まる直前）ときは少し先から、あるときは 15 秒の入れ替えを挟む
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
      activeTicketId: brewing?.id,
      queue,
      pastTickets: done.map((drip) => toTicket(drip, "completed")),
    };
  });

  const unassignedOrders = drips
    .filter((drip) => drip.status === "unassigned")
    .sort(compareQueue)
    .map((drip): UnassignedOrder => {
      const card = describe(drip, baristas, catalog, orderParts);
      const merged = Boolean(card.sourceOrderIds);
      return {
        ...card,
        badgeTag: `${drip.cups}杯${drip.rebrew_of ? " 入れ直し" : merged ? " 統合" : ""}`,
        predictedTimeStr: drip.cups > 1 ? "3分15秒" : "2分15秒",
        recommendedBaristas: card.preferredBaristaId
          ? `ドリッパー ${card.preferredBaristaId}`
          : "全ドリッパー",
        recommendedBayIds: card.preferredBaristaId
          ? [card.preferredBaristaId]
          : [1, 2, 3, 4, 5, 6],
        cardColor: cardColorOf(card.beanCode),
      };
    });

  return { baristas: boardBaristas, unassignedOrders };
};

// 入れ直しを列（抽出中を含む）の index 番目に差し込むときの queue_pos。前後の待機カードの間の値にする。
// 抽出中のカードの queue_pos は待機カードより大きいことがあるので、待機カードだけで数える。
export const queuePosAt = (
  queue: OrderTicket[],
  index: number,
): number | null => {
  const brewingCount = queue.filter(
    (ticket) => ticket.status === "brewing",
  ).length;
  const positions = queue
    .filter((ticket) => ticket.status === "scheduled")
    .map((ticket) => ticket.queuePos)
    .filter((pos): pos is number => pos !== undefined);
  if (positions.length === 0) return null;
  const clamped = Math.max(0, Math.min(index - brewingCount, positions.length));
  if (clamped === 0) return positions[0] - 1;
  if (clamped === positions.length) return positions[positions.length - 1] + 1;
  return (positions[clamped - 1] + positions[clamped]) / 2;
};
