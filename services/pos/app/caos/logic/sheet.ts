import type { CaosCard } from "@cafeore/common";
import {
  type CardLooks,
  cardOrderNos,
  groupByOrder,
  orderLabel,
} from "./cards";
import { type Lane, laneActive, laneCards } from "./lanes";

// 管制盤 D（マスターシート）の表。紙のマスターシートと同じく、行は注文番号ごと。
// 割り当てた注文は下へ積むだけで、淹れ終わっても行は動かさず薄く残す。

type CellState = "past" | "current" | "waiting";

export interface SheetEntry {
  card: CaosCard;
  state: CellState;
  // 統合した抽出は元の注文すべての行にまたがる（行は注文番号）。
  rowIds: number[];
}

interface SheetCell {
  entries: SheetEntry[];
  // 隣り合う行の統合は1つの枠で大きく囲む。隣り合わないときは他の行に目印だけ置く。
  rowSpan: number;
  coveredBy?: number;
  mergedStubs: SheetEntry[];
}

interface SheetRow {
  orderNo: number;
  /** まだ淹れ終わっていないカード（未割当を含む）がある */
  isLive: boolean;
  /** カードがあり、全部淹れ終わった */
  isPast: boolean;
  /** 表に置いた杯数（統合したカードは注文ごとに 1 杯） */
  cups: number;
  /** 注文の杯数 */
  orderCups?: number;
}

export const cellKey = (orderNo: number, bayId: number) =>
  `${orderNo}@${bayId}`;

const entryOf = (card: CaosCard, state: CellState): SheetEntry => ({
  card,
  state,
  rowIds: cardOrderNos(card),
});

/** 注文の杯数（分けた注文はカード全部の杯数、1 枚だけの注文はそのカードの杯数） */
export const orderCupsOf = (card: CaosCard, looks: CardLooks) =>
  looks.get(card.key)?.split?.cups ?? card.cups.length;

export const buildSheet = (
  lanes: Lane[],
  unassigned: CaosCard[],
  looks: CardLooks,
) => {
  const entriesByBay = new Map<number, SheetEntry[]>(
    lanes.map((lane) => [
      lane.id,
      [
        ...lane.done.map((card) => entryOf(card, "past")),
        ...(lane.brewing ? [entryOf(lane.brewing, "current")] : []),
        ...lane.queued.map((card) => entryOf(card, "waiting")),
      ],
    ]),
  );

  // Per order: whether it still has work, cups placed so far, and the order's total.
  const stats = new Map<
    number,
    { hasEntries: boolean; isLive: boolean; cups: number; orderCups?: number }
  >();
  const statOf = (id: number) => {
    const stat = stats.get(id) ?? { hasEntries: false, isLive: false, cups: 0 };
    stats.set(id, stat);
    return stat;
  };
  for (const entries of entriesByBay.values()) {
    for (const entry of entries) {
      for (const id of entry.rowIds) {
        const stat = statOf(id);
        stat.hasEntries = true;
        stat.isLive ||= entry.state !== "past";
        // A merged drip holds one cup from each source order.
        stat.cups += entry.card.cups.length / entry.rowIds.length;
        if (entry.rowIds.length === 1)
          stat.orderCups ??= orderCupsOf(entry.card, looks);
      }
    }
  }
  // An order with cups still unassigned is not finished, even if its assigned cups are.
  for (const card of unassigned) {
    const orderNos = cardOrderNos(card);
    for (const id of orderNos) {
      const stat = statOf(id);
      stat.isLive = true;
      if (orderNos.length === 1) stat.orderCups ??= orderCupsOf(card, looks);
    }
  }

  // Like the printed sheet, every order number gets a row, including ones with nothing to drip.
  const numbers = Array.from(stats.keys());
  const firstNo = Math.min(...numbers);
  const orderedIds = Array.from(
    { length: numbers.length > 0 ? Math.max(...numbers) - firstNo + 1 : 0 },
    (_, index) => firstNo + index,
  );
  const rowIndex = new Map(orderedIds.map((id, index) => [id, index]));

  const cells = new Map<string, SheetCell>();
  const cellAt = (orderNo: number, bayId: number) => {
    const key = cellKey(orderNo, bayId);
    const cell = cells.get(key) ?? { entries: [], rowSpan: 1, mergedStubs: [] };
    cells.set(key, cell);
    return cell;
  };
  for (const [bayId, entries] of entriesByBay) {
    const touches = new Map<number, number>();
    for (const entry of entries)
      for (const id of entry.rowIds)
        touches.set(id, (touches.get(id) ?? 0) + 1);
    for (const entry of entries) {
      const indexes = entry.rowIds
        .map((id) => rowIndex.get(id) ?? 0)
        .sort((left, right) => left - right);
      const first = orderedIds[indexes[0]];
      const firstCell = cellAt(first, bayId);
      firstCell.entries.push(entry);
      if (entry.rowIds.length === 1) continue;
      // The box encloses every row from the first source order to the last, so it is drawn
      // only when nothing else in this column sits inside that range.
      const range = orderedIds.slice(
        indexes[0],
        indexes[indexes.length - 1] + 1,
      );
      const canSpan = range.every(
        (id) => (touches.get(id) ?? 0) === (entry.rowIds.includes(id) ? 1 : 0),
      );
      if (canSpan) {
        firstCell.rowSpan = range.length;
        for (const id of range.slice(1)) cellAt(id, bayId).coveredBy = first;
      } else {
        for (const id of entry.rowIds)
          if (id !== first) cellAt(id, bayId).mergedStubs.push(entry);
      }
    }
  }

  const rows = orderedIds.map((orderNo): SheetRow => {
    const stat = stats.get(orderNo);
    return {
      orderNo,
      isLive: stat?.isLive ?? false,
      isPast: Boolean(stat?.hasEntries && !stat.isLive),
      cups: Math.round((stat?.cups ?? 0) * 10) / 10,
      orderCups: stat?.orderCups,
    };
  });
  return { rows, cells };
};

// 右の注文内容。未割当のカードを注文ごとにまとめ、同じ注文のドリッパーのカード（抽出中・待機）を薄く添える
export const buildOrderGroups = (lanes: Lane[], unassigned: CaosCard[]) =>
  Array.from(groupByOrder(unassigned), ([key, items]) => ({
    key,
    items,
    assigned: lanes.flatMap((lane) =>
      laneActive(lane)
        .filter((card) => orderLabel(card) === key)
        .map((card) => ({ card, bayId: lane.id })),
    ),
  })).sort((left, right) => left.items[0].orderNo - right.items[0].orderNo);

// 選んだ注文の行（統合したカードは元の注文すべての行）
export const linkedOrderNos = (
  selectedOrderId: string | null,
  lanes: Lane[],
  unassigned: CaosCard[],
) =>
  new Set(
    [...unassigned, ...lanes.flatMap(laneCards)]
      .filter((card) => orderLabel(card) === selectedOrderId)
      .flatMap(cardOrderNos),
  );
