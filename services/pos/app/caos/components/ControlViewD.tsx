import { formatMinSec, readableTextColor } from "@cafeore/common";
import {
  ArrowRightCircle,
  ClipboardList,
  Combine,
  Table2,
  X,
} from "lucide-react";
import type React from "react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Barista, BeanCode, OrderTicket, UnassignedOrder } from "../types";
import {
  activeRemainingSec,
  canMergeDripUnits,
  orderNumber,
  ticketKey,
} from "../utils/orderQueue";
import type { ControlViewBProps } from "./ControlViewB";

export interface ControlViewDProps extends ControlViewBProps {
  onMoveTicket: (ticket: OrderTicket, targetBayId: number) => void;
  onReturnToUnassigned: (ticket: OrderTicket) => void;
  onMergeOrders: (firstUid: string, secondUid: string) => void;
}

// 紙のマスターシートと同じく、行は注文番号ごと。割り当てた注文は下へ積むだけで、
// 淹れ終わっても行は動かさず薄く残す。
const MIN_ROWS = 8;
// 開いたときは、まだ淹れ終わっていない最初の注文の1つ上から見せる。
const HISTORY_ROWS_ON_OPEN = 1;
// C/Aの未割当カードと同じく、12px動くまではタップとして扱う。
const DRAG_THRESHOLD_PX = 12;

interface SheetCup {
  key: string;
  id: string;
  beanCode: BeanCode;
  beanName: string;
  cupCount: number;
  preferredBaristaId?: number;
  isRebrew?: boolean;
  /** マスターの画面と同じ背景色（盤面のカードだけ） */
  color?: string;
  /** 商品の ID（盤面のカードだけ）。あれば API の商品の略称（beanName）をそのまま出す */
  itemKey?: string;
}

// 右の未割当カードと、表の未開始カード（列間の移動・未割当へ戻す）を同じ操作で掴む。
type DragSource =
  | { kind: "unassigned"; order: UnassignedOrder }
  | { kind: "ticket"; ticket: OrderTicket; fromBayId: number };

type DropTarget = number | "unassigned";

interface CupDrag {
  source: DragSource;
  rect: DOMRect;
}

type CellState = "past" | "current" | "waiting";

interface SheetEntry {
  ticket: OrderTicket;
  state: CellState;
  // 統合した抽出は元の注文すべての行にまたがる。
  rowIds: string[];
}

interface SheetCell {
  entries: SheetEntry[];
  // 隣り合う行の統合は1つの枠で大きく囲む。隣り合わないときは他の行に目印だけ置く。
  rowSpan: number;
  coveredBy?: string;
  mergedStubs: SheetEntry[];
}

interface SheetLayout {
  rows: Array<{
    orderId: string;
    isLive: boolean;
    isPast: boolean;
    cups: number;
    orderCups?: number;
  }>;
  cells: Map<string, SheetCell>;
  targetRowId: string | null;
}

interface OrderGroup {
  id: string;
  items: UnassignedOrder[];
  assigned: Array<{ ticket: OrderTicket; bayNumber: number }>;
}

// 実データテストのカード（商品の情報が無い）の呼び方。盤面のカードは API の商品の略称を出す
const sheetLabel: Record<BeanCode, string> = {
  CHAMP: "チャンプ",
  ORE: "俺ブレ",
  TNZ: "タンザ",
  KEN: "ケニア",
  BRA: "ブラジル",
  ICE: "氷",
  MILK: "牛",
  SP: "限定",
  OTHER: "その他",
};

const cupColor = (cup: SheetCup) => {
  if (cup.beanCode === "SP") return "bg-red-200";
  if (cup.beanCode === "ICE") return "bg-sky-200";
  if (cup.beanCode === "MILK") return "bg-gray-200";
  return "bg-white";
};

const ticketCup = (ticket: OrderTicket): SheetCup => ({
  key: ticketKey(ticket),
  id: ticket.id,
  beanCode: ticket.beanCode,
  beanName: ticket.beanName,
  cupCount: ticket.cupCount,
  preferredBaristaId: ticket.preferredBaristaId,
  isRebrew: ticket.isRebrew,
  color: ticket.color,
  itemKey: ticket.itemKey,
});

const rowIdsOf = (item: { id: string; sourceOrderIds?: string[] }) =>
  item.sourceOrderIds && item.sourceOrderIds.length > 0
    ? item.sourceOrderIds
    : [item.id];

const shortIds = (ids: string[]) =>
  ids.map((id) => id.replace("#", "")).join("+");

const cellKey = (orderId: string, bayId: number) => `${orderId}@${bayId}`;

const sourceCup = (source: DragSource) =>
  source.kind === "unassigned"
    ? unassignedCup(source.order)
    : ticketCup(source.ticket);

const unassignedCup = (order: UnassignedOrder): SheetCup => ({
  key: order.ticketUid || order.id,
  id: order.id,
  beanCode: order.beanCode,
  beanName: order.beanName,
  cupCount: order.cupCount,
  preferredBaristaId: order.preferredBaristaId,
  isRebrew: order.isRebrew,
  color: order.color,
  itemKey: order.itemKey,
});

const CupChip: React.FC<{
  cup: SheetCup;
  baristaName?: string;
  note?: string;
  faded?: boolean;
  selected?: boolean;
  lifted?: boolean;
  onClick?: () => void;
}> = ({
  cup,
  baristaName,
  note,
  faded = false,
  selected = false,
  lifted = false,
  onClick,
}) => {
  const stacked = cup.cupCount >= 2;
  // 盤面のカードはマスターの画面と同じ背景色。文字色は背景色から決める（POS と共通の readableTextColor）
  const colorStyle = cup.color
    ? { backgroundColor: cup.color, color: readableTextColor(cup.color) }
    : undefined;

  return (
    <div
      className={`relative h-full min-w-0 ${stacked ? "mr-1.5 mb-1.5" : ""} ${faded ? "opacity-45" : ""}`}
    >
      {stacked && (
        <div
          aria-hidden
          className={`absolute inset-0 translate-x-1.5 translate-y-1.5 rounded-lg border border-slate-500 shadow-xs ${cupColor(cup)}`}
          style={colorStyle}
        />
      )}
      <button
        type="button"
        disabled={!onClick}
        onClick={onClick}
        style={colorStyle}
        className={`relative z-[1] flex h-full w-full min-w-0 touch-manipulation flex-col justify-center rounded-lg border px-1.5 py-1 text-left shadow-xs ${cupColor(cup)} ${
          cup.isRebrew ? "border-2 border-red-600" : "border-slate-500"
        } ${selected || lifted ? "ring-4 ring-blue-600" : onClick ? "hover:ring-2 hover:ring-slate-400" : ""} ${
          lifted ? "shadow-2xl" : ""
        }`}
      >
        <span className="flex min-w-0 items-baseline justify-between gap-1">
          <span
            className={`truncate font-black text-[14px] leading-tight ${cup.color ? "" : "text-slate-950"}`}
          >
            {cup.itemKey ? cup.beanName : sheetLabel[cup.beanCode]}
          </span>
          <span
            className={`shrink-0 font-black font-mono text-[11px] ${cup.color ? "opacity-80" : "text-slate-700"}`}
          >
            ×{cup.cupCount}
          </span>
        </span>
        <span
          className={`truncate font-bold font-mono text-[11px] ${cup.color ? "opacity-75" : "text-slate-600"}`}
        >
          No. {cup.id.replaceAll("#", "")}
        </span>
        {(baristaName || note || cup.isRebrew) && (
          <span
            className={`truncate font-bold text-[10px] ${cup.color ? "opacity-80" : "text-slate-700"}`}
          >
            {cup.isRebrew ? "入れ直し " : ""}
            {baristaName ? `指名：${baristaName}` : ""}
            {note ? ` ${note}` : ""}
          </span>
        )}
      </button>
    </div>
  );
};

export const ControlViewD: React.FC<ControlViewDProps> = ({
  baristas,
  unassignedOrders,
  simTimeSec,
  selectedOrderId,
  onSelectOrder,
  onAdvanceBay,
  onOpenTicketDetail,
  onOpenEmptySlot,
  onAssignToBay,
  onRequestRebrew,
  onMoveTicket,
  onReturnToUnassigned,
  onMergeOrders,
}) => {
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const [cupDrag, setCupDrag] = useState<CupDrag | null>(null);
  const [hoveredTarget, setHoveredTarget] = useState<DropTarget | null>(null);
  // Order numbers of a merge waiting for App to hand back the combined card.
  const [mergingIds, setMergingIds] = useState<string[] | null>(null);
  const suppressNextClick = useRef(false);
  const endPress = useRef<(() => void) | null>(null);
  const ghostRef = useRef<HTMLDivElement | null>(null);
  const ghostOffset = useRef({ x: 0, y: 0 });
  const sortedBaristas = useMemo(
    () => [...baristas].sort((left, right) => left.bayNumber - right.bayNumber),
    [baristas],
  );
  const baristaNames = useMemo(
    () => new Map(sortedBaristas.map((barista) => [barista.id, barista.name])),
    [sortedBaristas],
  );
  const selectedOrder = useMemo(
    () =>
      unassignedOrders.find(
        (order) => (order.ticketUid || order.id) === selectedUid,
      ) ?? null,
    [selectedUid, unassignedOrders],
  );

  useEffect(() => {
    if (selectedUid && !selectedOrder) setSelectedUid(null);
  }, [selectedOrder, selectedUid]);

  // App's selection can move on without this view (tapping a placed card, a move that clears it);
  // drop the local card selection then so the header and "ここに配置" never point at another order.
  useEffect(() => {
    if (selectedOrder && selectedOrderId !== selectedOrder.id)
      setSelectedUid(null);
  }, [selectedOrder, selectedOrderId]);

  useEffect(() => () => endPress.current?.(), []);

  const sheet = useMemo<SheetLayout>(() => {
    const entriesByBay = new Map<number, SheetEntry[]>();
    for (const barista of sortedBaristas) {
      entriesByBay.set(barista.id, [
        ...(barista.pastTickets || []).map((ticket) => ({
          ticket,
          state: "past" as const,
          rowIds: rowIdsOf(ticket),
        })),
        ...barista.queue.map((ticket) => ({
          ticket,
          state:
            ticket.status === "brewing"
              ? ("current" as const)
              : ("waiting" as const),
          rowIds: rowIdsOf(ticket),
        })),
      ]);
    }

    // Per order: whether it still has work, cups placed so far, and the order's total.
    const stats = new Map<
      string,
      { hasEntries: boolean; isLive: boolean; cups: number; orderCups?: number }
    >();
    const statOf = (id: string) => {
      const stat = stats.get(id) || {
        hasEntries: false,
        isLive: false,
        cups: 0,
      };
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
          stat.cups += entry.ticket.cupCount / entry.rowIds.length;
          if (entry.rowIds.length === 1)
            stat.orderCups ??= entry.ticket.totalOrderCups;
        }
      }
    }
    // An order with cups still unassigned is not finished, even if its assigned cups are.
    for (const order of unassignedOrders) {
      for (const id of rowIdsOf(order)) {
        const stat = statOf(id);
        stat.isLive = true;
        if (rowIdsOf(order).length === 1)
          stat.orderCups ??= order.totalOrderCups ?? order.cupCount;
      }
    }

    // Like the printed sheet, every order number gets a row, including ones with nothing to drip.
    const idByNumber = new Map<number, string>();
    const otherIds: string[] = [];
    for (const id of stats.keys()) {
      const number = orderNumber(id);
      if (number === Number.MAX_SAFE_INTEGER) otherIds.push(id);
      else idByNumber.set(number, id);
    }
    const numbers = Array.from(idByNumber.keys());
    const orderedIds: string[] = [];
    if (numbers.length > 0) {
      for (
        let number = Math.min(...numbers);
        number <= Math.max(...numbers);
        number++
      ) {
        orderedIds.push(
          idByNumber.get(number) ?? `#${number.toString().padStart(3, "0")}`,
        );
      }
    }
    orderedIds.push(...otherIds.sort());
    const rowIndex = new Map<string, number>(
      orderedIds.map((id, index) => [id, index]),
    );

    const cells = new Map<string, SheetCell>();
    const cellAt = (orderId: string, bayId: number) => {
      const key = cellKey(orderId, bayId);
      const cell = cells.get(key) || {
        entries: [],
        rowSpan: 1,
        mergedStubs: [],
      };
      cells.set(key, cell);
      return cell;
    };
    for (const [bayId, entries] of entriesByBay) {
      const touches = new Map<string, number>();
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
          (id) =>
            (touches.get(id) ?? 0) === (entry.rowIds.includes(id) ? 1 : 0),
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

    const rows = orderedIds.map((orderId) => {
      const stat = stats.get(orderId);
      return {
        orderId,
        isLive: stat?.isLive ?? false,
        isPast: Boolean(stat?.hasEntries && !stat.isLive),
        cups: stat?.cups ?? 0,
        orderCups: stat?.orderCups,
      };
    });
    return {
      rows,
      cells,
      targetRowId: selectedOrder ? rowIdsOf(selectedOrder)[0] : null,
    };
  }, [selectedOrder, sortedBaristas, unassignedOrders]);
  const fillerRowCount = Math.max(0, MIN_ROWS - sheet.rows.length - 1);
  const remainingByBay = new Map<number, number>(
    sortedBaristas.map((barista) => [
      barista.id,
      activeRemainingSec(barista, simTimeSec),
    ]),
  );

  const sheetScrollRef = useRef<HTMLDivElement>(null);
  // Scroll to the live rows only when the sheet opens; afterwards the user owns the scroll.
  useLayoutEffect(() => {
    const container = sheetScrollRef.current;
    if (!container) return;
    const rows: HTMLElement[] = Array.from(
      container.querySelectorAll<HTMLElement>("[data-sheet-row]"),
    );
    const firstLive = rows.findIndex((row) => row.dataset.live === "true");
    const row =
      rows[
        Math.max(
          0,
          (firstLive === -1 ? rows.length : firstLive) - HISTORY_ROWS_ON_OPEN,
        )
      ];
    const head = container.querySelector("thead");
    if (!row || !head) return;
    container.scrollTop +=
      row.getBoundingClientRect().top -
      container.getBoundingClientRect().top -
      head.getBoundingClientRect().height;
  }, []);

  const orderGroups = useMemo<OrderGroup[]>(() => {
    const groups = new Map<string, OrderGroup>();
    unassignedOrders.forEach((order) => {
      const group = groups.get(order.id) || {
        id: order.id,
        items: [],
        assigned: [],
      };
      group.items.push(order);
      groups.set(order.id, group);
    });
    sortedBaristas.forEach((barista) => {
      barista.queue.forEach((ticket) => {
        groups
          .get(ticket.id)
          ?.assigned.push({ ticket, bayNumber: barista.bayNumber });
      });
    });
    return Array.from(groups.values()).sort(
      (left, right) => orderNumber(left.id) - orderNumber(right.id),
    );
  }, [sortedBaristas, unassignedOrders]);

  const totalUnassignedCups = unassignedOrders.reduce(
    (sum, order) => sum + order.cupCount,
    0,
  );

  const canAssignTo = (barista: Barista) =>
    Boolean(
      selectedOrder &&
        (!selectedOrder.preferredBaristaId ||
          selectedOrder.preferredBaristaId === barista.id),
    );

  const clearSelection = () => {
    setSelectedUid(null);
    onSelectOrder("");
  };

  const mergeWithSelected = (order: UnassignedOrder) => {
    if (!selectedOrder || !canMergeDripUnits(selectedOrder, order)) return;
    onMergeOrders(
      selectedOrder.ticketUid || selectedOrder.id,
      order.ticketUid || order.id,
    );
    setMergingIds([...rowIdsOf(selectedOrder), ...rowIdsOf(order)]);
    clearSelection();
  };

  // The combined card is listed under the earlier order, often far from the card just tapped,
  // so select it and bring it into view; it can then be placed right away.
  useEffect(() => {
    if (!mergingIds) return;
    const merged = unassignedOrders.find((order) =>
      mergingIds.every((id) => order.sourceOrderIds?.includes(id)),
    );
    if (!merged) return;
    setMergingIds(null);
    const uid = merged.ticketUid || merged.id;
    setSelectedUid(uid);
    onSelectOrder(merged.id);
    requestAnimationFrame(() => {
      document
        .querySelector(`[data-sheet-cup="${CSS.escape(uid)}"]`)
        ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  }, [mergingIds, unassignedOrders, onSelectOrder]);

  const toggleSelection = (order: UnassignedOrder) => {
    const uid = order.ticketUid || order.id;
    if (selectedUid === uid) {
      clearSelection();
      return;
    }
    setSelectedUid(uid);
    if (selectedOrderId !== order.id) onSelectOrder(order.id);
  };

  const assignSelected = (barista: Barista) => {
    if (!selectedOrder || !canAssignTo(barista)) return;
    onAssignToBay(selectedOrder, barista.id);
    clearSelection();
  };

  // 列のどのセル（見出しを含む）に落としても、その担当者の次の枠へ配置する。
  // 表のカードは右の注文内容へ落とすと未割当に戻る。
  const dropTargetAt = (
    source: DragSource,
    clientX: number,
    clientY: number,
  ): DropTarget | null => {
    const elements = document.elementsFromPoint(clientX, clientY);
    if (
      source.kind === "ticket" &&
      elements.some((element) => element.closest("[data-return-target]"))
    ) {
      return "unassigned";
    }
    const target = elements
      .map((element) => element.closest<HTMLElement>("[data-bay-target]"))
      .find(Boolean);
    const bayId = Number(target?.dataset.bayTarget);
    if (!bayId) return null;
    const preferredBaristaId =
      source.kind === "unassigned"
        ? source.order.preferredBaristaId
        : source.ticket.preferredBaristaId;
    if (preferredBaristaId && preferredBaristaId !== bayId) return null;
    if (source.kind === "ticket" && source.fromBayId === bayId) return null;
    return bayId;
  };

  const drop = (source: DragSource, target: DropTarget) => {
    if (source.kind === "unassigned") {
      if (target === "unassigned") return;
      onAssignToBay(source.order, target);
      clearSelection();
      return;
    }
    // The card may have started brewing or been moved while it was held.
    const key = ticketKey(source.ticket);
    const latest = baristas
      .flatMap((barista) => barista.queue)
      .find(
        (ticket) => ticketKey(ticket) === key && ticket.status === "scheduled",
      );
    if (!latest) return;
    if (target === "unassigned") onReturnToUnassigned(latest);
    else onMoveTicket(latest, target);
  };

  const beginDrag = (source: DragSource) => {
    if (source.kind === "unassigned") {
      setSelectedUid(source.order.ticketUid || source.order.id);
      if (selectedOrderId !== source.order.id) onSelectOrder(source.order.id);
    } else if (selectedUid) {
      // Moving a placed card: hide the "ここに配置" slots of a pending selection.
      clearSelection();
    }
  };

  // The window listeners outlive the render that started the press, so they call the
  // latest handlers; otherwise a drop would run App callbacks over stale queues.
  const latestHandlers = useRef({ beginDrag, drop });
  useLayoutEffect(() => {
    latestHandlers.current = { beginDrag, drop };
  });

  const placeGhost = () => {
    const { x, y } = ghostOffset.current;
    if (ghostRef.current)
      ghostRef.current.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  };

  const startPress = (
    source: DragSource,
    event: React.PointerEvent<HTMLElement>,
    anyDirection: boolean,
  ) => {
    // A touch drag ends without a click, so drop any suppression left by it.
    suppressNextClick.current = false;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    endPress.current?.();

    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    const rect = event.currentTarget.getBoundingClientRect();
    let dragging = false;

    const onMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      // The button was released outside the window, so no pointerup will arrive.
      if (moveEvent.pointerType === "mouse" && moveEvent.buttons === 0) {
        finish(moveEvent, false);
        return;
      }
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      if (!dragging) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
        // Cards with touch-action pan-y leave vertical movement to scrolling.
        if (!anyDirection && Math.abs(dy) > Math.abs(dx)) return;
        dragging = true;
        latestHandlers.current.beginDrag(source);
        setCupDrag({ source, rect });
      }
      // Move the ghost directly; the sheet re-renders only when the drop target changes.
      ghostOffset.current = { x: dx, y: dy };
      placeGhost();
      setHoveredTarget(
        dropTargetAt(source, moveEvent.clientX, moveEvent.clientY),
      );
    };

    const finish = (upEvent: PointerEvent, dropped: boolean) => {
      if (upEvent.pointerId !== pointerId) return;
      cleanup();
      if (!dragging) return;
      setCupDrag(null);
      setHoveredTarget(null);
      suppressNextClick.current = true;
      const target = dropped
        ? dropTargetAt(source, upEvent.clientX, upEvent.clientY)
        : null;
      if (target !== null) latestHandlers.current.drop(source, target);
    };
    const onUp = (upEvent: PointerEvent) => finish(upEvent, true);
    const onCancel = (cancelEvent: PointerEvent) => finish(cancelEvent, false);

    const cleanup = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      endPress.current = null;
    };
    endPress.current = () => {
      cleanup();
      setCupDrag(null);
      setHoveredTarget(null);
    };
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
  };

  const suppressClickAfterDrag = (event: React.MouseEvent) => {
    if (!suppressNextClick.current) return;
    suppressNextClick.current = false;
    event.stopPropagation();
  };

  const dragSource = cupDrag?.source ?? null;
  const dragCup = dragSource ? sourceCup(dragSource) : null;
  const draggedKey = dragCup?.key ?? null;
  const isTicketDrag = dragSource?.kind === "ticket";
  const hoveredBayNumber =
    typeof hoveredTarget === "number"
      ? sortedBaristas.find((barista) => barista.id === hoveredTarget)
          ?.bayNumber
      : undefined;

  return (
    <section
      className="grid h-full min-h-0 grid-cols-[minmax(0,2.2fr)_minmax(280px,1fr)] gap-2"
      aria-label="Dコントロール画面"
    >
      <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border-2 border-slate-900 bg-white shadow-xs">
        <header className="flex h-11 shrink-0 items-center gap-2 border-slate-900 border-b-2 bg-slate-50 px-3">
          <Table2 className="h-4 w-4 text-slate-700" />
          <h2 className="shrink-0 font-black text-[15px] text-slate-950">
            マスターシート
          </h2>
          <p className="min-w-0 truncate font-bold text-[11px] text-slate-500">
            {dragSource?.kind === "ticket"
              ? `${dragSource.ticket.id} ${dragSource.ticket.beanName} ${dragSource.ticket.cupCount}杯 → 移す担当者の列で離す／右の注文内容で離すと未割当に戻す`
              : selectedOrder
                ? cupDrag
                  ? `${selectedOrder.id} ${selectedOrder.beanName} ${selectedOrder.cupCount}杯 → 担当者の列で離すと配置`
                  : `${selectedOrder.id} ${selectedOrder.beanName} ${selectedOrder.cupCount}杯 → 配置する枠を選択`
                : "右の注文カードを選んで表の枠をタップするか、列へドラッグして割り振ります"}
          </p>
          {selectedOrder && (
            <button
              type="button"
              onClick={clearSelection}
              className="ml-auto flex h-8 shrink-0 touch-manipulation items-center gap-1 rounded-md border border-slate-300 bg-white px-2 font-black text-[11px] text-slate-700"
            >
              <X className="h-3.5 w-3.5" />
              解除
            </button>
          )}
        </header>

        <div ref={sheetScrollRef} className="min-h-0 flex-1 overflow-auto">
          <table className="w-full min-w-[720px] table-fixed border-collapse">
            <colgroup>
              <col className="w-[76px]" />
              {sortedBaristas.map((barista) => (
                <col key={barista.id} />
              ))}
              <col className="w-[52px]" />
            </colgroup>
            <thead className="sticky top-0 z-10 bg-slate-100">
              <tr>
                <th className="border-slate-900 border-r-4 border-b-4 px-1 font-black text-[13px]">
                  注文 No.
                </th>
                {sortedBaristas.map((barista) => {
                  const current = barista.queue[0];
                  const seconds = activeRemainingSec(barista, simTimeSec);
                  return (
                    <th
                      key={barista.id}
                      data-bay-target={barista.id}
                      className={`border-slate-900 border-r-2 border-b-4 p-1 align-top ${
                        hoveredTarget === barista.id ? "bg-blue-100" : ""
                      }`}
                    >
                      <div className="flex items-center justify-center gap-1">
                        <span className="font-black font-mono text-[20px] leading-none">
                          {barista.bayNumber}
                        </span>
                        <span className="truncate font-black text-[12px]">
                          {barista.name}
                        </span>
                      </div>
                      <button
                        type="button"
                        disabled={!current}
                        onClick={() => onAdvanceBay(barista.id)}
                        className={`mt-1 flex h-8 w-full touch-manipulation items-center justify-center gap-1 rounded-md font-black text-[11px] ${
                          current
                            ? "bg-emerald-700 text-white"
                            : "bg-slate-200 text-slate-500"
                        }`}
                      >
                        {current ? (
                          <>
                            <span className="font-mono">
                              {seconds === 0 ? "継続" : formatMinSec(seconds)}
                            </span>
                            <span>次へ</span>
                            <ArrowRightCircle className="h-3.5 w-3.5" />
                          </>
                        ) : (
                          "待機"
                        )}
                      </button>
                    </th>
                  );
                })}
                <th className="border-slate-900 border-b-4 border-l-4 px-1 font-black text-[12px]">
                  総杯数
                </th>
              </tr>
            </thead>
            <tbody>
              {sheet.rows.map((row) => {
                const isRowPast = row.isPast;
                const isTargetRow = sheet.targetRowId === row.orderId;
                const isRowLinked = Boolean(
                  selectedOrderId?.split("+").includes(row.orderId),
                );
                const rowCups = Math.round(row.cups * 10) / 10;

                return (
                  <tr
                    key={row.orderId}
                    data-sheet-row={row.orderId}
                    data-live={row.isLive}
                    className={`h-[72px] ${isRowPast ? "bg-slate-50" : isTargetRow ? "bg-blue-50/40" : ""}`}
                  >
                    <th
                      className={`border-slate-900 border-r-4 border-b-2 px-1 text-center ${
                        isRowLinked ? "bg-amber-50" : ""
                      }`}
                    >
                      <span
                        className={`font-black font-mono text-[20px] leading-none ${
                          row.isLive ? "text-slate-950" : "text-slate-400"
                        }`}
                      >
                        {row.orderId.replace("#", "")}
                      </span>
                    </th>
                    {sortedBaristas.map((barista) => {
                      const cell = sheet.cells.get(
                        cellKey(row.orderId, barista.id),
                      );
                      if (cell?.coveredBy) return null;
                      const cellEntries = cell?.entries || [];
                      const isTarget = isTargetRow && canAssignTo(barista);
                      const isDropColumn = hoveredTarget === barista.id;
                      const isMergedBox = (cell?.rowSpan ?? 1) > 1;
                      const seconds = remainingByBay.get(barista.id) ?? 0;
                      const renderEntry = ({
                        ticket,
                        state,
                        rowIds,
                      }: SheetEntry) => (
                        <div
                          key={ticketKey(ticket)}
                          onPointerDown={
                            state === "waiting"
                              ? (event) =>
                                  startPress(
                                    {
                                      kind: "ticket",
                                      ticket,
                                      fromBayId: barista.id,
                                    },
                                    event,
                                    false,
                                  )
                              : undefined
                          }
                          onClickCapture={
                            state === "waiting"
                              ? suppressClickAfterDrag
                              : undefined
                          }
                          className={`h-[64px] shrink-0 rounded-lg ${
                            state === "waiting"
                              ? "cursor-grab touch-pan-y select-none active:cursor-grabbing"
                              : ""
                          } ${state === "current" ? "ring-2 ring-emerald-600 ring-offset-1" : ""} ${
                            draggedKey === ticketKey(ticket) ? "opacity-30" : ""
                          }`}
                        >
                          <CupChip
                            cup={ticketCup(ticket)}
                            baristaName={
                              ticket.preferredBaristaId
                                ? baristaNames.get(ticket.preferredBaristaId)
                                : undefined
                            }
                            note={[
                              rowIds.length > 1 ? "統合" : "",
                              state === "current"
                                ? seconds > 0
                                  ? `抽出中 残${formatMinSec(seconds)}`
                                  : "抽出中"
                                : ticket.isInterrupted
                                  ? "中断"
                                  : "",
                            ]
                              .filter(Boolean)
                              .join(" ")}
                            faded={state === "past"}
                            onClick={
                              state === "past"
                                ? undefined
                                : state === "current"
                                  ? () => onRequestRebrew(ticket, barista.id)
                                  : () => {
                                      if (selectedOrderId !== ticket.id)
                                        onSelectOrder(ticket.id);
                                      onOpenTicketDetail(ticket);
                                    }
                            }
                          />
                        </div>
                      );

                      return (
                        <td
                          key={barista.id}
                          rowSpan={cell?.rowSpan ?? 1}
                          data-bay-target={barista.id}
                          className={`relative border-slate-900 border-r-2 border-b-2 p-1 align-top ${
                            isDropColumn
                              ? "bg-blue-50"
                              : isRowLinked && cellEntries.length > 0
                                ? "bg-amber-50"
                                : ""
                          }`}
                        >
                          {isMergedBox ? (
                            <div className="absolute inset-1 flex flex-col rounded-xl border-4 border-slate-900 bg-white/60 p-1">
                              {cellEntries.map(renderEntry)}
                            </div>
                          ) : (
                            <div className="flex min-h-[64px] flex-col gap-1">
                              {cellEntries.map(renderEntry)}
                              {cell?.mergedStubs.map(({ ticket, rowIds }) => (
                                <div
                                  key={ticketKey(ticket)}
                                  className="flex h-[40px] items-center justify-center rounded-lg border-4 border-slate-900 font-black text-[11px] text-slate-700"
                                >
                                  {shortIds(rowIds)} 統合
                                </div>
                              ))}
                              {isTarget && (
                                <button
                                  type="button"
                                  aria-label={`ドリッパー${barista.bayNumber}に配置`}
                                  onClick={() => assignSelected(barista)}
                                  className={`h-[64px] w-full touch-manipulation rounded border-2 font-black text-[11px] ${
                                    isDropColumn
                                      ? "border-blue-700 bg-blue-200 text-blue-800 ring-2 ring-blue-400"
                                      : "border-blue-600 bg-blue-50 text-blue-700"
                                  }`}
                                >
                                  ここに配置
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                      );
                    })}
                    <td className="border-slate-900 border-b-2 border-l-4 px-1 text-center font-black font-mono">
                      <span
                        className={`text-[20px] ${isRowPast ? "text-slate-400" : ""}`}
                      >
                        {rowCups || (row.orderCups ? 0 : "")}
                      </span>
                      {row.orderCups !== undefined &&
                        row.orderCups > rowCups && (
                          <span className="block text-[10px] text-slate-500">
                            /{row.orderCups}杯
                          </span>
                        )}
                    </td>
                  </tr>
                );
              })}
              <tr className="h-[72px]">
                <th className="border-slate-900 border-r-4 border-b-2 px-1 text-center text-[20px] text-slate-300">
                  —
                </th>
                {sortedBaristas.map((barista) => (
                  <td
                    key={barista.id}
                    data-bay-target={barista.id}
                    className={`border-slate-900 border-r-2 border-b-2 p-1 ${
                      hoveredTarget === barista.id ? "bg-blue-50" : ""
                    }`}
                  >
                    {!selectedOrder && (
                      <button
                        type="button"
                        onClick={() => onOpenEmptySlot(barista.id)}
                        className="h-[64px] w-full touch-manipulation rounded border border-slate-300 border-dashed font-bold text-[10px] text-slate-400"
                      >
                        枠を選択
                      </button>
                    )}
                  </td>
                ))}
                <td className="border-slate-900 border-b-2 border-l-4" />
              </tr>
              {Array.from({ length: fillerRowCount }, (_, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: filler rows have no identity
                <tr key={index} className="h-[72px]">
                  <th className="border-slate-900 border-r-4 border-b-2" />
                  {sortedBaristas.map((barista) => (
                    <td
                      key={barista.id}
                      data-bay-target={barista.id}
                      className={`border-slate-900 border-r-2 border-b-2 ${
                        hoveredTarget === barista.id ? "bg-blue-50" : ""
                      }`}
                    />
                  ))}
                  <td className="border-slate-900 border-b-2 border-l-4" />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <aside
        data-return-target
        className="relative flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border-2 border-slate-900 bg-white shadow-xs"
      >
        {isTicketDrag && (
          <div
            className={`pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-md border-4 border-dashed p-4 text-center font-black text-[15px] ${
              hoveredTarget === "unassigned"
                ? "border-blue-700 bg-blue-100/90 text-blue-800"
                : "border-slate-400 bg-white/80 text-slate-500"
            }`}
          >
            ここで離すと未割当に戻す
          </div>
        )}
        <header className="flex h-11 shrink-0 items-center justify-between gap-2 border-slate-900 border-b-2 bg-slate-50 px-3">
          <div className="flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-slate-700" />
            <h2 className="font-black text-[15px] text-slate-950">注文内容</h2>
          </div>
          <span className="font-black text-[12px] text-slate-700">
            未割り振り {totalUnassignedCups}杯
          </span>
        </header>

        {orderGroups.length === 0 ? (
          <p className="flex-1 py-8 text-center font-bold text-[13px] text-slate-400">
            未割り振りの注文はありません
          </p>
        ) : (
          <div className="grid min-h-0 flex-1 auto-rows-max content-start gap-2 overflow-y-auto p-2">
            {orderGroups.map((group) => {
              const totalCups =
                group.items[0]?.totalOrderCups ??
                [
                  ...group.items,
                  ...group.assigned.map((entry) => entry.ticket),
                ].reduce((sum, entry) => sum + entry.cupCount, 0);
              const notes = group.items[0]?.orderNotes;

              return (
                <article
                  key={group.id}
                  className="overflow-hidden rounded-md border-2 border-slate-900"
                >
                  <div className="flex items-center justify-between gap-2 border-slate-900 border-b-2 bg-slate-100 px-2 py-1">
                    <h3 className="font-black font-mono text-[17px]">
                      注文 No. {group.id.replaceAll("#", "")}
                    </h3>
                    <span className="font-black text-[13px]">
                      {totalCups}杯
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5 p-2">
                    {group.items.map((order) => {
                      const uid = order.ticketUid || order.id;
                      const isMergeCandidate = Boolean(
                        selectedOrder &&
                          canMergeDripUnits(selectedOrder, order),
                      );
                      return (
                        <div
                          key={uid}
                          data-sheet-cup={uid}
                          // A selected card has touch-action none, so it can be dragged in any direction.
                          onPointerDown={(event) =>
                            startPress(
                              { kind: "unassigned", order },
                              event,
                              selectedUid === uid,
                            )
                          }
                          onClickCapture={suppressClickAfterDrag}
                          className={`relative h-[60px] cursor-grab select-none active:cursor-grabbing ${
                            selectedUid === uid ? "touch-none" : "touch-pan-y"
                          } ${draggedKey === uid ? "opacity-30" : ""}`}
                        >
                          <CupChip
                            cup={unassignedCup(order)}
                            baristaName={
                              order.preferredBaristaId
                                ? baristaNames.get(order.preferredBaristaId)
                                : undefined
                            }
                            selected={selectedUid === uid}
                            onClick={
                              isMergeCandidate
                                ? () => mergeWithSelected(order)
                                : () => toggleSelection(order)
                            }
                          />
                          {isMergeCandidate && (
                            <div className="pointer-events-none absolute inset-0 z-[2] flex items-center justify-center gap-1 rounded-lg border-2 border-blue-600 bg-blue-50/90 font-black text-[13px] text-blue-800">
                              <Combine className="h-4 w-4" />
                              統合する
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {group.assigned.map(({ ticket, bayNumber }) => (
                      <div key={ticketCup(ticket).key} className="h-[60px]">
                        <CupChip
                          cup={ticketCup(ticket)}
                          note={`→ ${bayNumber}`}
                          faded
                        />
                      </div>
                    ))}
                  </div>
                  {notes && (
                    <p className="border-slate-200 border-t px-2 py-1 font-bold text-[11px] text-slate-600">
                      {notes}
                    </p>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </aside>

      {cupDrag &&
        dragCup &&
        createPortal(
          <div
            ref={(element) => {
              ghostRef.current = element;
              placeGhost();
            }}
            aria-hidden="true"
            className="pointer-events-none fixed z-[1000] scale-[1.03] opacity-90"
            style={{
              left: cupDrag.rect.left,
              top: cupDrag.rect.top,
              width: cupDrag.rect.width,
              height: cupDrag.rect.height,
            }}
          >
            <CupChip
              cup={dragCup}
              baristaName={
                dragCup.preferredBaristaId
                  ? baristaNames.get(dragCup.preferredBaristaId)
                  : undefined
              }
              lifted
            />
            {hoveredTarget !== null && (
              <div className="-right-1 -top-2 absolute z-[2] whitespace-nowrap rounded-full bg-blue-700 px-2 py-1 font-black font-mono text-[12px] text-white shadow-md">
                {hoveredTarget === "unassigned"
                  ? "未割当へ"
                  : `→ ${hoveredBayNumber}`}
              </div>
            )}
          </div>,
          document.body,
        )}
    </section>
  );
};
