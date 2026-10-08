import {
  type ColorSetting,
  type OrderEntity,
  type WithId,
  resolveItemColor,
} from "@cafeore/common";
import type { Board, DripCard } from "../types";
import { type UnsplitCard, splitIntoDripUnits } from "./cards";
import { isBayId } from "./lanes";

// cafeore-pos の注文。POS の画面と同じく、共有の WebSocket から届いた OrderEntity を使う。
export type PosOrder = WithId<OrderEntity>;

// レジで受けたが、まだ提供準備ができていない注文だけをドリップ対象にする。
const isPendingPosOrder = (order: PosOrder) =>
  order.readyAt === null && order.servedAt === null;

// cafeore-pos の指名は自由記述なので、番号（1〜6）のときだけ枠を固定する。
const nominatedBayId = (assignee: string) => {
  const bayId = Number(assignee.normalize("NFKC"));
  return Number.isInteger(bayId) && isBayId(bayId) ? bayId : undefined;
};

// 注文をカードにする。同じ商品・同じ指名の杯をまとめ、最大 2 杯ずつに分ける。
// 名前は商品の略称（abbr）、区分は商品の種類の表示名（display_name）をそのまま出す。
const posOrderToDripUnits = (order: PosOrder): DripCard[] => {
  const grouped = new Map<string, UnsplitCard>();
  for (const line of order.menus) {
    const assignee = line.assignee?.trim() || undefined;
    const preferredBaristaId = assignee ? nominatedBayId(assignee) : undefined;
    // 番号でない指名は、カードの名前に添えて出す
    const unmatchedAssignee =
      assignee && !preferredBaristaId ? `（指名:${assignee}）` : "";
    for (const { item, quantity } of line.items) {
      // アイスミルクとグッズは抽出しないので、ドリップ管制に載せない。
      if (
        item.item_type.name === "others" ||
        item.item_type.name === "milk" ||
        item.name.includes("アイスミルク")
      )
        continue;
      const mergeKey = `${item.id}-${assignee ?? ""}`;
      const current = grouped.get(mergeKey);
      if (current) {
        current.cupCount += quantity;
        continue;
      }
      grouped.set(mergeKey, {
        ticketUid: `pos-${order.id}-${grouped.size}`,
        posOrderId: order.id,
        orderNos: [order.orderId],
        beanName: `${item.abbr}${unmatchedAssignee}`,
        cupCount: quantity,
        item: { id: item.id, item_type: { id: item.item_type.id } },
        typeName: item.item_type.display_name,
        preferredBaristaId,
        mergeKey,
      });
    }
  }
  return splitIntoDripUnits([...grouped.values()]);
};

// 届いた注文の一覧を盤面に取り込む。当日の未提供・未準備で新しく届いた注文をカードにして未割当へ足し、
// POS 側で準備完了・提供済み・削除になった注文は、まだ割り当てていない分だけ未割当から外す。
// ingested は取り込み済みの注文（UUID）。全件が届くたびに、新しい注文だけを足すために使う。
export const ingestPosOrders = (
  orders: PosOrder[],
  ingested: ReadonlySet<string>,
  dayStartMs: number,
) => {
  const pending = orders.filter(
    (order) =>
      isPendingPosOrder(order) && order.createdAt.getTime() >= dayStartMs,
  );
  const pendingIds = new Set(pending.map((order) => order.id));
  const incomingOrders = pending
    .filter((order) => !ingested.has(order.id))
    .sort((a, b) => a.orderId - b.orderId);
  return {
    incoming: incomingOrders.flatMap(posOrderToDripUnits),
    ingested: new Set([
      ...ingested,
      ...incomingOrders.map((order) => order.id),
    ]),
    /** 取り込んだが、もう未準備・未提供でない注文（準備完了・提供済み・削除） */
    withdrawn: new Set([...ingested].filter((id) => !pendingIds.has(id))),
  };
};

// カードの背景色。商品の色の設定（画面 master。商品 → 種類の順）から引く。設定が無ければ付けない（白）。
// 色の設定はあとから読み込まれたり変わったりするので、カードには持たず、出すたびに付ける。
export const paintBoard = (board: Board, settings: ColorSetting[]): Board => {
  const paint = <T extends DripCard>(card: T): T =>
    card.item
      ? { ...card, color: resolveItemColor(settings, card.item, "master") }
      : card;
  return {
    unassigned: board.unassigned.map(paint),
    baristas: board.baristas.map((barista) => ({
      ...barista,
      queue: barista.queue.map(paint),
      pastTickets: barista.pastTickets.map(paint),
    })),
  };
};
