import {
  type CaosCard,
  caosDripperAllowed,
  dripperLabel,
} from "@cafeore/common";
import { Table2, X } from "lucide-react";
import type React from "react";
import { useMemo } from "react";
import {
  type DropTarget,
  dropSideOn,
  dropTargetAt,
  dropTargetLabel,
  useCardDrag,
} from "../hooks/useCardDrag";
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
import { cardPlaces, laneActive, pendingNominatedCups } from "../logic/lanes";
import { laneStatus } from "../logic/queue";
import {
  type SheetEntry,
  buildOrderGroups,
  buildSheet,
  cellKey,
  linkedOrderNos,
} from "../logic/sheet";
import {
  DripperIndicator,
  EmptySlotButton,
  LongWaitTag,
  OrderCountLabel,
  PanelHeader,
  PlaceTag,
} from "./BoardParts";
import { CardOverlay } from "./CardActions";
import type { ControlViewProps } from "./ControlWorkspace";
import { LaneChangeButton, LaneName } from "./LaneParts";
import { CancelEmergencyButton, OrderCard } from "./OrderCard";
import { OrderCommentBadge } from "./OrderComments";
import { ScrollArea } from "./ScrollArea";
import { UnassignedHeading, UnfinishedList } from "./UnfinishedOrders";

// 管制盤 D：紙のマスターシートと同じく、列はドリッパー、行は注文番号（logic/sheet.ts）。
// 右の注文カードを選んで表の「ここに配置」をタップするか、列へドラッグして割り振る。表の待機・抽出中のカードも、列へドラッグして移す
// （抽出中のカードは始めた時刻を消して待機の最後へ。抽出中も待機も無い列なら今から始め直す）か、右の注文へドラッグして未割当に戻す。
// 表のカードを押すと、その段階の操作のアイコンをカードの上に出す（cardMenu。CardOverlay）。長押しで待機は詳細、抽出中は緊急のパネル（onHoldCard）。終わったカードは表に出さない（logic/sheet.ts）。
// 表の待機・抽出中のカードの上に落とすと、左の端はそのカードの前・右の端は後ろ・真ん中は統合（統合できる相手のときだけ。管制盤 A・C と同じ
// useCardDrag の dropTargetAt。表の行は注文番号なので、列の中の順番は札「3rd 2番目」で見る）。
// 右の注文カードを選んでいるあいだは、統合できる表の待機・抽出中のカードに「統合する」が出て、押すとそのカードに統合する。
// 統合したカードは、重ねた枠でなく入っている注文ごとの段に分けて出す（OrderCard の byOrder。表では元の注文の行にまたがって縦に長い）。
// 列の見出しはドリッパーの番号（列の状態）と担当者。
// 表のカードには、どのドリッパーの何番目か（「3rd 2番目」）の札を付ける。
// カードはなぞると掴むので、表と右の注文の縦のスクロールはスクロールバー（ScrollArea）か、カードの無い所をなぞる。

// 表の行は少なくともこれだけ（空の行で表の高さをそろえる）
const MIN_ROWS = 8;
// 開いたときは、まだ淹れ終わっていない最初の注文の1つ上から見せる。
const HISTORY_ROWS_ON_OPEN = 1;

// 右の未割当カードと、表の待機・抽出中のカード（列間の移動・未割当へ戻す）を同じ操作で掴む。
type DragSource =
  | { kind: "unassigned"; order: CaosCard }
  | { kind: "ticket"; ticket: CaosCard; fromBayId: number };

// 列・列のカードの前後・統合（DropTarget）か、右の注文内容（未割当に戻す）
type SheetDrop = DropTarget | "unassigned";

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
const dropLabel = (target: SheetDrop | null) =>
  target === "unassigned" ? "未割当へ" : dropTargetLabel(target);

export const ControlViewD: React.FC<ControlViewProps> = ({
  lanes: bays,
  unassignedOrders,
  looks,
  nowMs,
  selectedOrderId,
  onSelectOrder,
  cardMenu,
  onHoldCard,
  onCancelEmergency,
  onOpenEmptySlot,
  onOpenLane,
  onAssignToBay,
  onMoveTicket,
  onReturnToUnassigned,
  onMergeOrders,
  unfinished,
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
    () => buildOrderGroups(unassignedOrders),
    [unassignedOrders],
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

  // 列のどのセル（見出しを含む）に落としても、その担当者の次の枠へ配置する。表のカードの上なら、その前・後ろ・統合。
  // 表のカードは右の注文内容へ落とすと未割当に戻る。
  const placed = useMemo(() => bays.flatMap(laneActive), [bays]);
  const drag = useCardDrag<DragSource, SheetDrop>({
    targetAt: (source, clientX, clientY) => {
      if (
        source.kind === "ticket" &&
        document
          .elementsFromPoint(clientX, clientY)
          .some((element) => element.closest("[data-return-target]"))
      ) {
        return "unassigned";
      }
      return dropTargetAt(clientX, clientY, {
        from: source.kind === "ticket" ? source.fromBayId : undefined,
        card: sourceCard(source),
        cards: placed,
      });
    },
    onBegin: (source) => {
      if (source.kind === "unassigned") picked.select(source.order);
      // Moving a placed card: hide the "ここに配置" slots of a pending selection.
      else if (selectedOrder) picked.clear();
    },
    onDrop: (source, target) => {
      const card = sourceCard(source);
      if (source.kind === "unassigned") picked.clear();
      if (target === "unassigned") {
        if (source.kind === "ticket") onReturnToUnassigned(source.ticket);
      } else if (target.mergeKey) onMergeOrders(card.key, target.mergeKey);
      else if (source.kind === "unassigned")
        onAssignToBay(card, target.bayId, target.place);
      else onMoveTicket(card, target.bayId, target.place);
    },
    // 長押しは表のカードだけ（右の注文カードは押し続けてから動かしてもドラッグ）
    onHold: (source) => {
      if (source.kind !== "ticket" || !onHoldCard) return false;
      onHoldCard(source.ticket);
      return true;
    },
  });

  const dragSource = drag.source;
  const dragCup = dragSource ? sourceCard(dragSource) : null;
  const hoveredTarget = drag.target;
  // 指の下の列（その列の枠を青くする。統合なら統合したカードが残る列）
  const hoveredBay =
    hoveredTarget === null || hoveredTarget === "unassigned"
      ? null
      : hoveredTarget.bayId;
  // 指の下の表のカード（入れる所の線・統合の枠）
  const sheetTarget = hoveredTarget === "unassigned" ? null : hoveredTarget;

  const headerHint = () => {
    if (dragSource?.kind === "ticket")
      return `${orderLabel(dragSource.ticket)} ${cardName(dragSource.ticket)} ${dragSource.ticket.cups.length}杯 → 移す担当者の列・カードの前後で離す（真ん中で統合）／右の注文内容で離すと未割当に戻す`;
    if (!selectedOrder)
      return "右の注文カードを選んで表の枠をタップするか、列へドラッグして割り振ります";
    const card = `${orderLabel(selectedOrder)} ${cardName(selectedOrder)} ${selectedOrder.cups.length}杯`;
    return dragSource
      ? `${card} → 担当者の列・カードの前後で離すと配置（真ん中で統合）`
      : `${card} → 配置する枠を選択`;
  };

  // 抽出中・待機は札（「3rd 抽出中」）で、残りはドリッパーの番号で出す（終わったカードは表に出さない。logic/sheet.ts）
  const renderEntry = (
    { card: ticket, state, rowIds }: SheetEntry,
    bayId: number,
  ) => {
    const mergeTap = picked.canMergeWith(ticket);
    return (
      <OrderCard
        key={ticket.key}
        card={ticket}
        look={looks.get(ticket.key)}
        size="sm"
        byOrder
        data-search-key={ticket.key}
        onPointerDown={(event) =>
          drag.press({ kind: "ticket", ticket, fromBayId: bayId }, event)
        }
        // 待機・抽出中のカードは、ドラッグで落とすと前・後ろ・統合の目印になる（useCardDrag の dropTargetAt）
        data-queued-ticket={ticket.key}
        data-ticket-label={orderLabel(ticket)}
        mergeTap={mergeTap}
        dropSide={dropSideOn(sheetTarget, ticket.key)}
        onClickCapture={drag.suppressClick}
        // 押すと操作のアイコンを開く（選んだ注文カードと統合できる待機・抽出中のカードは統合）
        onClick={() => {
          if (mergeTap) picked.mergeWith(ticket);
          else cardMenu?.toggle(ticket);
        }}
        // 統合したカードは注文ごとの段の分だけ高く（元の注文の行にまたがる枠では枠いっぱい）。
        // 探して見せるとき、上にはみ出した場所の札も見せる（見出しの高さは useScrollToFirstLive が枠に付ける）
        className={`${rowIds.length > 1 ? "min-h-[60px] flex-1" : "h-[60px] shrink-0"} cursor-grab touch-none scroll-mt-3 hover:ring-2 hover:ring-slate-400 active:cursor-grabbing ${state === "current" ? "ring-2 ring-emerald-600 ring-offset-1" : ""}`}
        dragging={dragCup?.key === ticket.key}
      >
        <PlaceTag label={places.get(ticket.key)} />
        <CardOverlay
          card={ticket}
          lane={bays[bayId - 1]}
          look={looks.get(ticket.key)}
          nowMs={nowMs}
          menu={cardMenu}
        />
      </OrderCard>
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
              onClick={picked.clear}
              className="ml-auto flex h-8 shrink-0 touch-manipulation items-center gap-1 rounded-md border border-slate-300 bg-white px-2 font-black text-[11px] text-slate-700"
            >
              <X className="h-3.5 w-3.5" />
              解除
            </button>
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
                      hoveredBay === bay.id ? "bg-blue-100" : ""
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
                      className="h-[56px] w-full"
                    />
                    {/* 担当者、その下に「交代」（列の幅が狭いので縦に並べる） */}
                    <div className="mt-1 flex min-w-0 flex-col items-center gap-0.5">
                      <LaneName
                        dripper={bay.id}
                        wrap
                        className="min-w-0 font-black text-[16px] leading-tight"
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
                      const isDropColumn = hoveredBay === bay.id;
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
                        hoveredBay === bay.id ? "bg-blue-50" : ""
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
        <PanelHeader className={`border-b-2 ${LINE}`}>
          <UnassignedHeading
            view={unfinished}
            label="注文内容"
            className={unfinished ? "text-[13px]" : undefined}
          />
          <span className="ml-auto font-black text-[12px] text-slate-700">
            未割り振り <OrderCountLabel cards={unassignedOrders} />
          </span>
        </PanelHeader>

        {unfinished?.tab === "unfinished" ? (
          <UnfinishedList view={unfinished} axis="y" />
        ) : orderGroups.length === 0 ? (
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
                  <h3 className="flex items-center gap-1 font-black font-mono text-[17px]">
                    注文 {group.key}
                    <OrderCommentBadge cards={group.items} looks={looks} />
                  </h3>
                  <span className="font-black text-[13px]">
                    {totalCups(group.items)}杯
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
                        byOrder
                        // 選んだカードと、カードを選んでいないときは選んだ注文（番号で探した・表のカードを開いた）のカード
                        selected={
                          isSelected ||
                          (!selectedOrder &&
                            sharesOrder(order, selectedOrderId))
                        }
                        mergeInto={isSelected ? picked.partner : undefined}
                        mergeTap={isMergeCandidate}
                        data-search-key={uid}
                        onPointerDown={(event) =>
                          drag.press({ kind: "unassigned", order }, event)
                        }
                        onClickCapture={drag.suppressClick}
                        onClick={() => {
                          if (isMergeCandidate) picked.mergeWith(order);
                          else picked.toggle(order);
                        }}
                        className="min-h-[64px] cursor-grab touch-none hover:ring-2 hover:ring-slate-400 active:cursor-grabbing"
                        dragging={dragCup?.key === uid}
                      >
                        <LongWaitTag card={order} nowMs={nowMs} />
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
                </div>
              </article>
            ))}
          </ScrollArea>
        )}
      </aside>

      {dragCup &&
        drag.ghost(
          <OrderCard
            card={dragCup}
            look={looks.get(dragCup.key)}
            size="sm"
            byOrder
          />,
          dropLabel(hoveredTarget),
        )}
    </section>
  );
};
