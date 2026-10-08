import { ClipboardList, Table2, X } from "lucide-react";
import type React from "react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { bayTargetAt, useCardDrag } from "../hooks/useCardDrag";
import {
  canMergeDripUnits,
  orderLabel,
  orderNoLabel,
  totalCups,
} from "../logic/cards";
import { clockLabel } from "../logic/format";
import { canPlaceOn, laneOrdinal } from "../logic/lanes";
import { laneStatus } from "../logic/queue";
import {
  type SheetEntry,
  buildOrderGroups,
  buildSheet,
  cellKey,
  linkedOrderNos,
} from "../logic/sheet";
import type { DripCard, OrderTicket } from "../types";
import {
  EmptySlotButton,
  LaneBadge,
  NextButton,
  PanelHeader,
} from "./BoardParts";
import type { ControlViewProps } from "./ControlWorkspace";
import { MergeOverlay, OrderCard } from "./OrderCard";

// 管制盤 D：紙のマスターシートと同じく、列はドリッパー、行は注文番号（logic/sheet.ts）。
// 右の注文カードを選んで表の「ここに配置」をタップするか、列へドラッグして割り振る。

// 表の行は少なくともこれだけ（空の行で表の高さをそろえる）
const MIN_ROWS = 8;
// 開いたときは、まだ淹れ終わっていない最初の注文の1つ上から見せる。
const HISTORY_ROWS_ON_OPEN = 1;

// 右の未割当カードと、表の未開始カード（列間の移動・未割当へ戻す）を同じ操作で掴む。
type DragSource =
  | { kind: "unassigned"; order: DripCard }
  | { kind: "ticket"; ticket: OrderTicket; fromBayId: number };

type DropTarget = number | "unassigned";

const sourceCard = (source: DragSource): DripCard =>
  source.kind === "unassigned" ? source.order : source.ticket;

// 表の線（紙のマスターシートと同じく太い線）
const LINE = "border-slate-900";

export const ControlViewD: React.FC<ControlViewProps> = ({
  baristas,
  unassignedOrders,
  currentTimeSec,
  selectedOrderId,
  onSelectOrder,
  onAdvanceBay,
  onOpenTicketDetail,
  onRequestRebrew,
  onOpenEmptySlot,
  onAssignToBay,
  onMoveTicket,
  onReturnToUnassigned,
  onMergeOrders,
}) => {
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  // Order numbers of a merge waiting for App to hand back the combined card.
  const [mergingNos, setMergingNos] = useState<number[] | null>(null);
  const selectedOrder =
    unassignedOrders.find((order) => order.ticketUid === selectedUid) ?? null;

  useEffect(() => {
    if (selectedUid && !selectedOrder) setSelectedUid(null);
  }, [selectedOrder, selectedUid]);

  // App's selection can move on without this view (tapping a placed card, a move that clears it);
  // drop the local card selection then so the header and "ここに配置" never point at another order.
  useEffect(() => {
    if (selectedOrder && selectedOrderId !== orderLabel(selectedOrder))
      setSelectedUid(null);
  }, [selectedOrder, selectedOrderId]);

  const sheet = useMemo(
    () => buildSheet(baristas, unassignedOrders),
    [baristas, unassignedOrders],
  );
  const orderGroups = useMemo(
    () => buildOrderGroups(baristas, unassignedOrders),
    [baristas, unassignedOrders],
  );
  const linkedRows = useMemo(
    () => linkedOrderNos(selectedOrderId, baristas, unassignedOrders),
    [selectedOrderId, baristas, unassignedOrders],
  );
  const targetRowId = selectedOrder?.orderNos[0] ?? null;
  const fillerRowCount = Math.max(0, MIN_ROWS - sheet.rows.length - 1);

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

  const clearSelection = () => {
    setSelectedUid(null);
    onSelectOrder("");
  };

  const mergeWithSelected = (order: DripCard) => {
    if (!selectedOrder || !canMergeDripUnits(selectedOrder, order)) return;
    onMergeOrders(selectedOrder.ticketUid, order.ticketUid);
    setMergingNos([...selectedOrder.orderNos, ...order.orderNos]);
    clearSelection();
  };

  // The combined card is listed under the earlier order, often far from the card just tapped,
  // so select it and bring it into view; it can then be placed right away.
  useEffect(() => {
    if (!mergingNos) return;
    const merged = unassignedOrders.find(
      (order) =>
        order.orderNos.length > 1 &&
        mergingNos.every((no) => order.orderNos.includes(no)),
    );
    if (!merged) return;
    setMergingNos(null);
    const uid = merged.ticketUid;
    setSelectedUid(uid);
    onSelectOrder(orderLabel(merged));
    requestAnimationFrame(() => {
      document
        .querySelector(`[data-sheet-cup="${CSS.escape(uid)}"]`)
        ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  }, [mergingNos, unassignedOrders, onSelectOrder]);

  const toggleSelection = (order: DripCard) => {
    const uid = order.ticketUid;
    if (selectedUid === uid) {
      clearSelection();
      return;
    }
    setSelectedUid(uid);
    if (selectedOrderId !== orderLabel(order)) onSelectOrder(orderLabel(order));
  };

  const assignSelected = (bayId: number) => {
    if (!selectedOrder || !canPlaceOn(selectedOrder, bayId)) return;
    onAssignToBay(selectedOrder, bayId);
    clearSelection();
  };

  // 列のどのセル（見出しを含む）に落としても、その担当者の次の枠へ配置する。
  // 表のカードは右の注文内容へ落とすと未割当に戻る。
  const drag = useCardDrag<DragSource, DropTarget>({
    targetAt: (source, clientX, clientY) => {
      if (
        source.kind === "ticket" &&
        document
          .elementsFromPoint(clientX, clientY)
          .some((element) => element.closest("[data-return-target]"))
      ) {
        return "unassigned";
      }
      return bayTargetAt(
        clientX,
        clientY,
        sourceCard(source),
        source.kind === "ticket" ? source.fromBayId : undefined,
      );
    },
    onBegin: (source) => {
      if (source.kind === "unassigned") {
        setSelectedUid(source.order.ticketUid);
        if (selectedOrderId !== orderLabel(source.order))
          onSelectOrder(orderLabel(source.order));
      } else if (selectedUid) {
        // Moving a placed card: hide the "ここに配置" slots of a pending selection.
        clearSelection();
      }
    },
    onDrop: (source, target) => {
      if (source.kind === "unassigned") {
        if (target === "unassigned") return;
        onAssignToBay(source.order, target);
        clearSelection();
        return;
      }
      if (target === "unassigned") onReturnToUnassigned(source.ticket);
      else onMoveTicket(source.ticket, target);
    },
  });

  const dragSource = drag.source;
  const dragCup = dragSource ? sourceCard(dragSource) : null;
  const hoveredTarget = drag.target;

  const headerHint = () => {
    if (dragSource?.kind === "ticket")
      return `${orderLabel(dragSource.ticket)} ${dragSource.ticket.beanName} ${dragSource.ticket.cupCount}杯 → 移す担当者の列で離す／右の注文内容で離すと未割当に戻す`;
    if (!selectedOrder)
      return "右の注文カードを選んで表の枠をタップするか、列へドラッグして割り振ります";
    const card = `${orderLabel(selectedOrder)} ${selectedOrder.beanName} ${selectedOrder.cupCount}杯`;
    return dragSource
      ? `${card} → 担当者の列で離すと配置`
      : `${card} → 配置する枠を選択`;
  };

  const renderEntry = (
    { ticket, state, rowIds }: SheetEntry,
    bayId: number,
    remainingSec: number,
  ) => {
    const brewingNote =
      remainingSec > 0 ? `抽出中 残${clockLabel(remainingSec)}` : "抽出中";
    return (
      <OrderCard
        key={ticket.ticketUid}
        card={ticket}
        size="sm"
        done={state === "past"}
        interrupted={ticket.isInterrupted}
        brewing={state === "current"}
        note={[
          rowIds.length > 1 ? "統合" : "",
          state === "current" ? brewingNote : "",
        ]
          .filter(Boolean)
          .join(" ")}
        onPointerDown={
          state === "waiting"
            ? (event) =>
                drag.press(
                  { kind: "ticket", ticket, fromBayId: bayId },
                  event,
                  false,
                )
            : undefined
        }
        onClickCapture={drag.suppressClick}
        onClick={() => {
          if (state === "current") onRequestRebrew(ticket);
          if (state !== "waiting") return;
          if (selectedOrderId !== orderLabel(ticket))
            onSelectOrder(orderLabel(ticket));
          onOpenTicketDetail(ticket);
        }}
        className={`h-[64px] shrink-0 ${state === "past" ? "" : "cursor-pointer hover:ring-2 hover:ring-slate-400"} ${
          state === "waiting"
            ? "cursor-grab touch-pan-y active:cursor-grabbing"
            : ""
        } ${state === "current" ? "ring-2 ring-emerald-600 ring-offset-1" : ""}`}
        dragging={dragCup?.ticketUid === ticket.ticketUid}
      />
    );
  };

  return (
    <section
      className="grid h-full min-h-0 grid-cols-[minmax(0,2.2fr)_minmax(280px,1fr)] gap-2"
      aria-label="Dコントロール画面"
    >
      <section
        className={`flex min-h-0 flex-col overflow-hidden rounded-lg border-2 bg-white shadow-xs ${LINE}`}
      >
        <PanelHeader
          icon={Table2}
          title="マスターシート"
          className={`border-b-2 ${LINE}`}
        >
          <p className="min-w-0 truncate font-bold text-[11px] text-slate-500">
            {headerHint()}
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
        </PanelHeader>

        <div ref={sheetScrollRef} className="min-h-0 flex-1 overflow-auto">
          <table className="w-full min-w-[720px] table-fixed border-collapse">
            <colgroup>
              <col className="w-[76px]" />
              {baristas.map((barista) => (
                <col key={barista.id} />
              ))}
              <col className="w-[52px]" />
            </colgroup>
            <thead className="sticky top-0 z-10 bg-slate-100">
              <tr>
                <th
                  className={`border-r-4 border-b-4 px-1 font-black text-[13px] ${LINE}`}
                >
                  注文 No.
                </th>
                {baristas.map((barista) => {
                  const lane = laneStatus(barista, currentTimeSec);
                  return (
                    <th
                      key={barista.id}
                      data-bay-target={barista.id}
                      className={`border-r-2 border-b-4 p-1 align-top ${LINE} ${
                        hoveredTarget === barista.id ? "bg-blue-100" : ""
                      }`}
                    >
                      <div className="flex justify-center">
                        <LaneBadge bayId={barista.id} />
                      </div>
                      <NextButton
                        bayId={barista.id}
                        active={Boolean(lane.current)}
                        soon={lane.soon}
                        remainingSec={lane.remainingSec}
                        onAdvance={onAdvanceBay}
                        className="mt-1 h-8 w-full text-[11px]"
                      />
                    </th>
                  );
                })}
                <th
                  className={`border-b-4 border-l-4 px-1 font-black text-[12px] ${LINE}`}
                >
                  総杯数
                </th>
              </tr>
            </thead>
            <tbody>
              {sheet.rows.map((row) => {
                const isTargetRow = targetRowId === row.orderNo;
                const isRowLinked = linkedRows.has(row.orderNo);
                return (
                  <tr
                    key={row.orderNo}
                    data-sheet-row={row.orderNo}
                    data-live={row.isLive}
                    className={`h-[72px] ${row.isPast ? "bg-slate-50" : isTargetRow ? "bg-blue-50/40" : ""}`}
                  >
                    <th
                      className={`border-r-4 border-b-2 px-1 text-center ${LINE} ${
                        isRowLinked ? "bg-amber-50" : ""
                      }`}
                    >
                      <span
                        className={`font-black font-mono text-[20px] leading-none ${
                          row.isLive ? "text-slate-950" : "text-slate-400"
                        }`}
                      >
                        {orderNoLabel(row.orderNo)}
                      </span>
                    </th>
                    {baristas.map((barista) => {
                      const cell = sheet.cells.get(
                        cellKey(row.orderNo, barista.id),
                      );
                      if (cell?.coveredBy) return null;
                      const cellEntries = cell?.entries ?? [];
                      const isDropColumn = hoveredTarget === barista.id;
                      const remainingSec = laneStatus(
                        barista,
                        currentTimeSec,
                      ).remainingSec;
                      const entries = cellEntries.map((entry) =>
                        renderEntry(entry, barista.id, remainingSec),
                      );
                      return (
                        <td
                          key={barista.id}
                          rowSpan={cell?.rowSpan ?? 1}
                          data-bay-target={barista.id}
                          className={`relative border-r-2 border-b-2 p-1 align-top ${LINE} ${
                            isDropColumn
                              ? "bg-blue-50"
                              : isRowLinked && cellEntries.length > 0
                                ? "bg-amber-50"
                                : ""
                          }`}
                        >
                          {(cell?.rowSpan ?? 1) > 1 ? (
                            <div
                              className={`absolute inset-1 flex flex-col rounded-xl border-4 bg-white/60 p-1 ${LINE}`}
                            >
                              {entries}
                            </div>
                          ) : (
                            <div className="flex min-h-[64px] flex-col gap-1">
                              {entries}
                              {cell?.mergedStubs.map(({ ticket, rowIds }) => (
                                <div
                                  key={ticket.ticketUid}
                                  className={`flex h-[40px] items-center justify-center rounded-lg border-4 font-black text-[11px] text-slate-700 ${LINE}`}
                                >
                                  {rowIds.join("+")} 統合
                                </div>
                              ))}
                              {isTargetRow &&
                                selectedOrder &&
                                canPlaceOn(selectedOrder, barista.id) && (
                                  <button
                                    type="button"
                                    aria-label={`ドリッパー${laneOrdinal(barista.id)}に配置`}
                                    onClick={() => assignSelected(barista.id)}
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
                    <td
                      className={`border-b-2 border-l-4 px-1 text-center font-black font-mono ${LINE}`}
                    >
                      <span
                        className={`text-[20px] ${row.isPast ? "text-slate-400" : ""}`}
                      >
                        {row.cups || (row.orderCups ? 0 : "")}
                      </span>
                      {row.orderCups !== undefined &&
                        row.orderCups > row.cups && (
                          <span className="block text-[10px] text-slate-500">
                            /{row.orderCups}杯
                          </span>
                        )}
                    </td>
                  </tr>
                );
              })}
              {/* 最後の行は空きスロット、その下は空の行（表の高さをそろえる） */}
              {Array.from({ length: fillerRowCount + 1 }, (_, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: filler rows have no identity
                <tr key={index} className="h-[72px]">
                  <th
                    className={`border-r-4 border-b-2 px-1 text-center text-[20px] text-slate-300 ${LINE}`}
                  >
                    {index === 0 && "—"}
                  </th>
                  {baristas.map((barista) => (
                    <td
                      key={barista.id}
                      data-bay-target={barista.id}
                      className={`border-r-2 border-b-2 p-1 ${LINE} ${
                        hoveredTarget === barista.id ? "bg-blue-50" : ""
                      }`}
                    >
                      {index === 0 && !selectedOrder && (
                        <EmptySlotButton
                          onClick={() => onOpenEmptySlot(barista.id)}
                          className="h-[64px] w-full"
                        />
                      )}
                    </td>
                  ))}
                  <td className={`border-b-2 border-l-4 ${LINE}`} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <aside
        data-return-target
        className={`relative flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border-2 bg-white shadow-xs ${LINE}`}
      >
        {dragSource?.kind === "ticket" && (
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
        <PanelHeader
          icon={ClipboardList}
          title="注文内容"
          className={`border-b-2 ${LINE}`}
        >
          <span className="ml-auto font-black text-[12px] text-slate-700">
            未割り振り {totalCups(unassignedOrders)}杯
          </span>
        </PanelHeader>

        {orderGroups.length === 0 ? (
          <p className="flex-1 py-8 text-center font-bold text-[13px] text-slate-400">
            未割り振りの注文はありません
          </p>
        ) : (
          <div className="grid min-h-0 flex-1 auto-rows-max content-start gap-2 overflow-y-auto p-2">
            {orderGroups.map((group) => (
              <article
                key={group.key}
                className={`overflow-hidden rounded-md border-2 ${LINE}`}
              >
                <div
                  className={`flex items-center justify-between gap-2 border-b-2 bg-slate-100 px-2 py-1 ${LINE}`}
                >
                  <h3 className="font-black font-mono text-[17px]">
                    注文 {group.key}
                  </h3>
                  <span className="font-black text-[13px]">
                    {group.items[0].totalOrderCups}杯
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-1.5 p-2">
                  {group.items.map((order) => {
                    const uid = order.ticketUid;
                    const isMergeCandidate = Boolean(
                      selectedOrder && canMergeDripUnits(selectedOrder, order),
                    );
                    return (
                      <OrderCard
                        key={uid}
                        card={order}
                        size="sm"
                        selected={selectedUid === uid}
                        data-sheet-cup={uid}
                        // A selected card has touch-action none, so it can be dragged in any direction.
                        onPointerDown={(event) =>
                          drag.press(
                            { kind: "unassigned", order },
                            event,
                            selectedUid === uid,
                          )
                        }
                        onClickCapture={drag.suppressClick}
                        onClick={() =>
                          isMergeCandidate
                            ? mergeWithSelected(order)
                            : toggleSelection(order)
                        }
                        className={`h-[64px] cursor-grab hover:ring-2 hover:ring-slate-400 active:cursor-grabbing ${
                          selectedUid === uid ? "touch-none" : "touch-pan-y"
                        }`}
                        dragging={dragCup?.ticketUid === uid}
                      >
                        {isMergeCandidate && <MergeOverlay />}
                      </OrderCard>
                    );
                  })}
                  {group.assigned.map(({ ticket, bayId }) => (
                    <OrderCard
                      key={ticket.ticketUid}
                      card={ticket}
                      size="sm"
                      note={`→ ${laneOrdinal(bayId)}`}
                      className="h-[64px] opacity-50"
                    />
                  ))}
                </div>
              </article>
            ))}
          </div>
        )}
      </aside>

      {dragCup &&
        drag.ghost(
          <OrderCard card={dragCup} size="sm" />,
          hoveredTarget === null
            ? null
            : hoveredTarget === "unassigned"
              ? "未割当へ"
              : `→ ${hoveredTarget}`,
        )}
    </section>
  );
};
