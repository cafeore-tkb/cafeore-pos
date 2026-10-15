import {
  type CaosCard,
  caosDripperAllowed,
  dripperLabel,
} from "@cafeore/common";
import { ClipboardList, Table2, X } from "lucide-react";
import type React from "react";
import { useMemo } from "react";
import { bayTargetAt, useCardDrag } from "../hooks/useCardDrag";
import {
  useScrollToFirstLive,
  useSheetSelection,
} from "../hooks/useSheetSelection";
import {
  cardName,
  orderLabel,
  orderNoLabel,
  sharesOrder,
  totalCups,
} from "../logic/cards";
import { cardPlaces, pendingNominatedCups } from "../logic/lanes";
import { laneStatus } from "../logic/queue";
import {
  type SheetEntry,
  buildOrderGroups,
  buildSheet,
  cellKey,
  linkedOrderNos,
  orderCupsOf,
} from "../logic/sheet";
import {
  DripperIndicator,
  EmptySlotButton,
  NextButton,
  PanelHeader,
  PlaceTag,
} from "./BoardParts";
import type { ControlViewProps } from "./ControlWorkspace";
import { LaneChangeButton, LaneName } from "./LaneParts";
import { CancelEmergencyButton, MergeOverlay, OrderCard } from "./OrderCard";
import { CommentLine } from "./OrderComments";
import { ScrollArea } from "./ScrollArea";

// 管制盤 D：紙のマスターシートと同じく、列はドリッパー、行は注文番号（logic/sheet.ts）。
// 右の注文カードを選んで表の「ここに配置」をタップするか、列へドラッグして割り振る。表の待機・抽出中のカードも、列へドラッグして移す
// （抽出中のカードは始めた時刻を消して待機の最後へ。抽出中も待機も無い列なら今から始め直す）か、右の注文へドラッグして未割当に戻す。抽出中のカードのタップは緊急のパネル（1〜6 に移す・未割当に戻すも）。
// 右の注文カードを選んでいるあいだは、統合できる表の抽出中のカードに「統合する」が出て、押すとそのカードに統合する。
// 列の見出しはドリッパーの番号（列の状態）と担当者、「次へ」は表の下に固定（押す手で表を隠さない）。
// 表のカードには、どのドリッパーの何番目か（「3rd 2番目」）の札を付ける。
// カードはなぞると掴むので、表と右の注文の縦のスクロールはスクロールバー（ScrollArea）か、カードの無い所をなぞる。

// 表のカードを探して見せるとき、上に固定した見出し（担当者・交代。カードの上の札も）と下の「次へ」に隠れないよう空ける幅（utils/scrollToCard）
const SHEET_SCROLL_MARGIN = "scroll-mt-[144px] scroll-mb-[68px]";
// 表の行は少なくともこれだけ（空の行で表の高さをそろえる）
const MIN_ROWS = 8;
// 開いたときは、まだ淹れ終わっていない最初の注文の1つ上から見せる。
const HISTORY_ROWS_ON_OPEN = 1;

// 右の未割当カードと、表の待機・抽出中のカード（列間の移動・未割当へ戻す）を同じ操作で掴む。
type DragSource =
  | { kind: "unassigned"; order: CaosCard }
  | { kind: "ticket"; ticket: CaosCard; fromBayId: number };

type DropTarget = number | "unassigned";

const sourceCard = (source: DragSource): CaosCard =>
  source.kind === "unassigned" ? source.order : source.ticket;

// 表の線（紙のマスターシートと同じく太い線）
const LINE = "border-slate-900";

// 行の背景（淹れ終わった行は灰色、選んだカードを置く行は薄い青）
const rowTone = (isPast: boolean, isTarget: boolean) => {
  if (isPast) return "bg-slate-50";
  if (isTarget) return "bg-blue-50/40";
  return "";
};

// 枠の背景（ドラッグで指の下の列は青、選んだ注文のカードがある枠は黄）
const cellTone = (isDropColumn: boolean, isLinked: boolean) => {
  if (isDropColumn) return "bg-blue-50";
  if (isLinked) return "bg-amber-50";
  return "";
};

// 運んでいるカードの札（置き先）
const dropLabel = (target: DropTarget | null) => {
  if (target === null) return null;
  if (target === "unassigned") return "未割当へ";
  return `→ ${target}`;
};

export const ControlViewD: React.FC<ControlViewProps> = ({
  lanes: bays,
  unassignedOrders,
  looks,
  nowMs,
  selectedOrderId,
  onSelectOrder,
  onAdvanceBay,
  onOpenTicket,
  onOpenRebrew,
  onCancelEmergency,
  onOpenEmptySlot,
  onOpenLane,
  onAssignToBay,
  onMoveTicket,
  onReturnToUnassigned,
  onMergeOrders,
}) => {
  const picked = useSheetSelection({
    unassigned: unassignedOrders,
    lanes: bays,
    selectedOrderId,
    onSelectOrder,
    onAssign: onAssignToBay,
    onMerge: onMergeOrders,
  });
  const selectedOrder = picked.selected;
  const sheetScrollRef = useScrollToFirstLive(HISTORY_ROWS_ON_OPEN);

  const sheet = useMemo(
    () => buildSheet(bays, unassignedOrders, looks),
    [bays, unassignedOrders, looks],
  );
  const orderGroups = useMemo(
    () => buildOrderGroups(bays, unassignedOrders),
    [bays, unassignedOrders],
  );
  const linkedRows = useMemo(
    () => linkedOrderNos(selectedOrderId, bays, unassignedOrders),
    [selectedOrderId, bays, unassignedOrders],
  );
  const targetRowId = selectedOrder?.orderNo ?? null;
  // 列ごとの今（抽出中のカード・残り・状態）と、表のカードの場所の札
  const columns = bays.map((bay) => ({ bay, lane: laneStatus(bay, nowMs) }));
  const places = cardPlaces(bays);
  const fillerRowCount = Math.max(0, MIN_ROWS - sheet.rows.length - 1);

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
      return bayTargetAt(clientX, clientY, {
        from: source.kind === "ticket" ? source.fromBayId : undefined,
        card: sourceCard(source),
      });
    },
    onBegin: (source) => {
      if (source.kind === "unassigned") picked.select(source.order);
      // Moving a placed card: hide the "ここに配置" slots of a pending selection.
      else if (selectedOrder) picked.clear();
    },
    onDrop: (source, target) => {
      if (source.kind === "unassigned") {
        if (target === "unassigned") return;
        onAssignToBay(source.order, target);
        picked.clear();
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
      return `${orderLabel(dragSource.ticket)} ${cardName(dragSource.ticket)} ${dragSource.ticket.cups.length}杯 → 移す担当者の列で離す／右の注文内容で離すと未割当に戻す`;
    if (!selectedOrder)
      return "右の注文カードを選んで表の枠をタップするか、列へドラッグして割り振ります";
    const card = `${orderLabel(selectedOrder)} ${cardName(selectedOrder)} ${selectedOrder.cups.length}杯`;
    return dragSource
      ? `${card} → 担当者の列で離すと配置`
      : `${card} → 配置する枠を選択`;
  };

  // 抽出中・待機・済は札（「3rd 抽出中」）で、残りはドリッパーの番号で出す
  const renderEntry = (
    { card: ticket, state, rowIds }: SheetEntry,
    bayId: number,
  ) => (
    <OrderCard
      key={ticket.key}
      card={ticket}
      look={looks.get(ticket.key)}
      size="sm"
      note={rowIds.length > 1 ? "統合" : undefined}
      data-search-key={ticket.key}
      onPointerDown={
        state !== "past"
          ? (event) =>
              drag.press({ kind: "ticket", ticket, fromBayId: bayId }, event)
          : undefined
      }
      onClickCapture={drag.suppressClick}
      // 抽出中・済のカードは入れ直し（選んだ注文カードと統合できる抽出中のカードは統合）
      onClick={() => {
        if (picked.canMergeWith(ticket)) picked.mergeWith(ticket);
        else if (state === "waiting") onOpenTicket(ticket);
        else onOpenRebrew?.(ticket);
      }}
      className={`h-[60px] shrink-0 ${SHEET_SCROLL_MARGIN} ${state !== "past" ? "cursor-grab touch-none hover:ring-2 hover:ring-slate-400 active:cursor-grabbing" : ""} ${state === "current" ? "ring-2 ring-emerald-600 ring-offset-1" : ""}`}
      dragging={dragCup?.key === ticket.key}
    >
      <PlaceTag label={places.get(ticket.key)} />
      {picked.canMergeWith(ticket) && <MergeOverlay />}
    </OrderCard>
  );

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
            <>
              {/* 選んだ注文カードのコメント（A の選んだ注文の帯と同じく 1 行で） */}
              <CommentLine
                comments={looks.get(selectedOrder.key)?.comments ?? []}
                className="font-bold text-[12px]"
              />
              <button
                type="button"
                onClick={picked.clear}
                className="ml-auto flex h-8 shrink-0 touch-manipulation items-center gap-1 rounded-md border border-slate-300 bg-white px-2 font-black text-[11px] text-slate-700"
              >
                <X className="h-3.5 w-3.5" />
                解除
              </button>
            </>
          )}
        </PanelHeader>

        <ScrollArea
          axis="y"
          scrollRef={sheetScrollRef}
          className="flex-1"
          scrollerClassName="overflow-x-auto"
        >
          <table className="w-full min-w-[720px] table-fixed border-collapse">
            <colgroup>
              <col className="w-[76px]" />
              {bays.map((bay) => (
                <col key={bay.id} />
              ))}
              <col className="w-[52px]" />
            </colgroup>
            <thead className="sticky top-0 z-30 bg-slate-100">
              <tr>
                <th
                  className={`border-r-4 border-b-4 px-1 font-black text-[13px] ${LINE}`}
                >
                  注文 No.
                </th>
                {columns.map(({ bay, lane }) => (
                  <th
                    key={bay.id}
                    data-bay-target={bay.id}
                    className={`border-r-2 border-b-4 p-1 align-top ${LINE} ${
                      hoveredTarget === bay.id ? "bg-blue-100" : ""
                    }`}
                  >
                    <DripperIndicator
                      bayId={bay.id}
                      status={lane}
                      nominatedCups={pendingNominatedCups(
                        unassignedOrders,
                        bay.id,
                      )}
                      onOpenLane={onOpenLane}
                      className="h-[60px] w-full"
                    />
                    {/* 担当者の下に「交代」（列の幅が狭いので縦に並べる） */}
                    <div className="mt-1 flex min-w-0 flex-col items-center gap-0.5">
                      <LaneName
                        dripper={bay.id}
                        className="max-w-full font-black text-[13px]"
                      />
                      <LaneChangeButton dripper={bay.id} />
                    </div>
                  </th>
                ))}
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
                    className={`h-[72px] ${rowTone(row.isPast, isTargetRow)}`}
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
                    {bays.map((bay) => {
                      const cell = sheet.cells.get(
                        cellKey(row.orderNo, bay.id),
                      );
                      if (cell?.coveredBy) return null;
                      const cellEntries = cell?.entries ?? [];
                      const isDropColumn = hoveredTarget === bay.id;
                      // 選んだカードを置ける枠（指名の番号のあるカードは、その番号の列だけ）
                      const isTargetCell =
                        isTargetRow &&
                        selectedOrder !== null &&
                        caosDripperAllowed(selectedOrder, bay.id);
                      const entries = cellEntries.map((entry) =>
                        renderEntry(entry, bay.id),
                      );
                      return (
                        <td
                          key={bay.id}
                          rowSpan={cell?.rowSpan ?? 1}
                          data-bay-target={bay.id}
                          className={`relative border-r-2 border-b-2 px-1 pt-2.5 pb-1 align-top ${LINE} ${cellTone(
                            isDropColumn,
                            isRowLinked && cellEntries.length > 0,
                          )}`}
                        >
                          {(cell?.rowSpan ?? 1) > 1 ? (
                            <div
                              className={`absolute inset-1 flex flex-col gap-2.5 rounded-xl border-4 bg-white/60 p-1 pt-2.5 ${LINE}`}
                            >
                              {entries}
                            </div>
                          ) : (
                            <div className="flex min-h-[60px] flex-col gap-2.5">
                              {entries}
                              {cell?.mergedStubs.map(
                                ({ card: ticket, rowIds }) => (
                                  <div
                                    key={ticket.key}
                                    className={`flex h-[40px] items-center justify-center rounded-lg border-4 font-black text-[11px] text-slate-700 ${LINE}`}
                                  >
                                    {rowIds.join("+")} 統合
                                  </div>
                                ),
                              )}
                              {isTargetCell && (
                                <button
                                  type="button"
                                  aria-label={`ドリッパー${dripperLabel(bay.id)}に配置`}
                                  onClick={() => picked.assignTo(bay.id)}
                                  className={`h-[60px] w-full touch-manipulation rounded border-2 font-black text-[11px] ${
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
                  {bays.map((bay) => (
                    <td
                      key={bay.id}
                      data-bay-target={bay.id}
                      className={`border-r-2 border-b-2 p-1 ${LINE} ${
                        hoveredTarget === bay.id ? "bg-blue-50" : ""
                      }`}
                    >
                      {index === 0 && !selectedOrder && (
                        <EmptySlotButton
                          onClick={() => onOpenEmptySlot(bay.id)}
                          className="h-[64px] w-full"
                        />
                      )}
                    </td>
                  ))}
                  <td className={`border-b-2 border-l-4 ${LINE}`} />
                </tr>
              ))}
            </tbody>
            {/* 次へ（表の下に固定） */}
            <tfoot className="sticky bottom-0 z-30 bg-slate-100">
              <tr>
                <th
                  className={`border-t-4 border-r-4 px-1 font-black text-[12px] ${LINE}`}
                >
                  次へ
                </th>
                {columns.map(({ bay, lane }) => (
                  <td
                    key={bay.id}
                    className={`border-t-4 border-r-2 p-1 ${LINE}`}
                  >
                    <NextButton
                      bayId={bay.id}
                      active={Boolean(lane.current)}
                      locked={lane.nextLocked}
                      onAdvance={onAdvanceBay}
                      className="h-12 w-full text-[15px]"
                    />
                  </td>
                ))}
                <td className={`border-t-4 border-l-4 ${LINE}`} />
              </tr>
            </tfoot>
          </table>
        </ScrollArea>
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
          <ScrollArea
            axis="y"
            className="flex-1"
            scrollerClassName="grid auto-rows-max content-start gap-2 p-2"
          >
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
                    {orderCupsOf(group.items[0], looks)}杯
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-1.5 p-2">
                  {group.items.map((order) => {
                    const uid = order.key;
                    const isSelected = selectedOrder?.key === uid;
                    const isMergeCandidate = picked.canMergeWith(order);
                    return (
                      <OrderCard
                        key={uid}
                        card={order}
                        look={looks.get(uid)}
                        size="sm"
                        // 選んだカードと、カードを選んでいないときは選んだ注文（番号で探した・表のカードを開いた）のカード
                        selected={
                          isSelected ||
                          (!selectedOrder &&
                            sharesOrder(order, selectedOrderId))
                        }
                        mergeInto={isSelected ? picked.partner : undefined}
                        data-search-key={uid}
                        onPointerDown={(event) =>
                          drag.press({ kind: "unassigned", order }, event)
                        }
                        onClickCapture={drag.suppressClick}
                        onClick={() => {
                          if (isMergeCandidate) picked.mergeWith(order);
                          else picked.toggle(order);
                        }}
                        className="h-[64px] cursor-grab touch-none hover:ring-2 hover:ring-slate-400 active:cursor-grabbing"
                        dragging={dragCup?.key === uid}
                      >
                        {isMergeCandidate && <MergeOverlay />}
                        {isSelected && order.emergency && onCancelEmergency && (
                          <CancelEmergencyButton
                            onConfirm={() => {
                              onCancelEmergency(order);
                              picked.clear();
                            }}
                          />
                        )}
                      </OrderCard>
                    );
                  })}
                  {group.assigned.map(({ card: ticket, bayId }) => (
                    <OrderCard
                      key={ticket.key}
                      card={ticket}
                      look={looks.get(ticket.key)}
                      size="sm"
                      note={`→ ${dripperLabel(bayId)}`}
                      data-search-key={ticket.key}
                      className="h-[64px] opacity-50"
                    />
                  ))}
                </div>
              </article>
            ))}
          </ScrollArea>
        )}
      </aside>

      {dragCup &&
        drag.ghost(
          <OrderCard card={dragCup} look={looks.get(dragCup.key)} size="sm" />,
          dropLabel(hoveredTarget),
        )}
    </section>
  );
};
