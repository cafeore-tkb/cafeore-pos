import {
  type ColorSetting,
  IMMINENT_SEC,
  type OrderEntity,
  STANDBY_LABEL,
  assignmentDisplay,
  brewDurationLabel,
  brewDurationSec,
  formatMinSec,
  formatRemainingLabel,
  planLane,
} from "@cafeore/common";
import type {
  Barista,
  BeanCode,
  CardBean,
  OrderTicket,
  UnassignedOrder,
} from "../types";
import type { BeanIndex } from "../utils/beans";
import { masterCardColor } from "../utils/masterColor";
import { orderNumber } from "../utils/orderQueue";
import { type Drip, type PosOrder, posBeanCode } from "../utils/posOrders";

// cafeore-pos の盤面（抽出カード）を、管制盤が使う形（ドリッパーごとの列と未割当）に組み立てる。
// カードは注文と商品の参照しか持たないので、注文番号や商品名は {"type":"orders"} で届く注文から引く。

interface CatalogItem {
  id: string;
  name: string;
  abbr: string;
  type: string;
  typeId?: string;
}

// 注文 ID → 注文番号と、その注文の商品（商品 ID → 名前・略称・種類）と、
// カップ（マスターの画面と同じ getCups()。指名の表示に使う）
export type Catalog = Map<
  string,
  {
    orderNo: number;
    items: Map<string, CatalogItem>;
    cups: ReturnType<OrderEntity["getCups"]>;
  }
>;

export const buildCatalog = (orders: PosOrder[] | null): Catalog => {
  const catalog: Catalog = new Map();
  for (const order of orders ?? []) {
    const items = new Map<string, CatalogItem>();
    const add = (item: {
      id?: string;
      name: string;
      abbr: string;
      item_type?: { id?: string; name: string };
    }) => {
      if (!item.id) return;
      items.set(item.id, {
        id: item.id,
        name: item.name,
        abbr: item.abbr,
        type: item.item_type?.name ?? "",
        typeId: item.item_type?.id,
      });
    };
    for (const menu of order.menus) {
      for (const { item } of menu.items) add(item);
    }
    // カードの商品は注文した時点のカップから作るので、カップの商品も引けるようにしておく
    for (const cup of order.cups) add(cup.item);
    catalog.set(order.id, {
      orderNo: order.orderId,
      items,
      cups: order.getCups(),
    });
  }
  return catalog;
};

const orderLabel = (orderNo: number) =>
  `#${orderNo.toString().padStart(3, "0")}`;

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
  catalog: Catalog,
  orderParts: Map<string, Drip[]>,
  colorSettings: ColorSetting[],
  beanIndex: BeanIndex,
) => {
  const first = drip.lines[0];
  const itemOf = (orderId: string, itemId: string) =>
    catalog.get(orderId)?.items.get(itemId);
  const firstItem = first ? itemOf(first.order_id, first.item_id) : undefined;
  // 区分（氷・牛・限定）は商品の種類から
  const beanCode = posBeanCode(firstItem?.type ?? "");
  // 豆は在庫の「商品 → 豆」から引く（カードの商品が使う在庫対象をまとめる）
  const beans = new Map<string, CardBean>();
  for (const line of drip.lines) {
    for (const bean of beanIndex.get(line.item_id) ?? []) {
      beans.set(bean.id, bean);
    }
  }
  const sourceOrderIds = Array.from(
    new Set(
      drip.lines.map((line) =>
        orderLabel(catalog.get(line.order_id)?.orderNo ?? 0),
      ),
    ),
  ).sort((a, b) => orderNumber(a) - orderNumber(b));
  const merged = sourceOrderIds.length > 1;
  // 指名の番号（明細の dripper）のカードは、その番号の列にだけ割り当てられる。統合したカードも同じ番号どうし
  const preferredBaristaId = first?.dripper ?? undefined;
  // 指名の表示はマスターの画面と同じ（カードの商品・指名の番号が同じカップの assignmentDisplay）。
  // 番号は「2nd」、番号の無い自由記述だけの古い明細は自由記述（列には固定しない）
  const nominees = new Set<string>();
  for (const line of drip.lines) {
    for (const cup of catalog.get(line.order_id)?.cups ?? []) {
      if (cup.id !== line.item_id || cup.dripper !== line.dripper) continue;
      const text = assignmentDisplay(cup);
      if (text) nominees.add(text);
    }
  }
  const nominee = Array.from(nominees).join("・") || undefined;
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
    beanName: abbrs,
    nominee,
    // 色はマスターの画面と同じ（統合カードは先頭の商品の色）
    color: firstItem ? masterCardColor(colorSettings, firstItem) : undefined,
    itemKey: first?.item_id,
    beans: Array.from(beans.values()),
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
// 抽出中・待機カードの予定時刻は、抽出中のカードの開始時刻から毎回計算する（planLane。@cafeore/common の caosTiming）。
// 注文がまだ届いていない（カタログに無い）カードは、注文番号が分からないので届くまで出さない。
export const dripsToBoard = (
  allDrips: Drip[],
  catalog: Catalog,
  baristas: Barista[],
  nowSec: number,
  dayStartMs: number,
  // マスターの画面の色の設定（カードの色をマスターと同じにする）
  colorSettings: ColorSetting[] = [],
  // 商品 → 豆（POS の在庫の設定）
  beanIndex: BeanIndex = new Map(),
): LiveBoard => {
  const drips = allDrips.filter((drip) =>
    drip.lines.every((line) => catalog.has(line.order_id)),
  );
  const orderParts = new Map<string, Drip[]>();
  for (const drip of drips
    .filter((drip) => drip.order_ids.length === 1 && !drip.rebrew_of)
    .sort(compareQueue)) {
    const parts = orderParts.get(drip.order_ids[0]) || [];
    parts.push(drip);
    orderParts.set(drip.order_ids[0], parts);
  }

  const toTicket = (drip: Drip, status: OrderTicket["status"]): OrderTicket => {
    const totalDurationSec = brewDurationSec(drip.cups);
    return {
      ...describe(drip, catalog, orderParts, colorSettings, beanIndex),
      tag: drip.rebrew_of ? "入れ直し" : undefined,
      status,
      totalDurationSec,
      scheduledTimeStr: formatMinSec(totalDurationSec),
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

    const brewingTicket = brewing ? toTicket(brewing, "brewing") : undefined;
    const queuedTickets = queued.map((drip) => toTicket(drip, "scheduled"));
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
      pastTickets: done.map((drip) => toTicket(drip, "completed")),
    };
  });

  const unassignedOrders = drips
    .filter((drip) => drip.status === "unassigned")
    .sort(compareQueue)
    .map((drip): UnassignedOrder => {
      const card = describe(
        drip,
        catalog,
        orderParts,
        colorSettings,
        beanIndex,
      );
      const merged = Boolean(card.sourceOrderIds);
      return {
        ...card,
        badgeTag: `${drip.cups}杯${drip.rebrew_of ? " 入れ直し" : merged ? " 統合" : ""}`,
        predictedTimeStr: brewDurationLabel(drip.cups),
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
