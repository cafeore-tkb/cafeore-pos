import type React from "react";
import type { Barista, OrderTicket, UnassignedOrder } from "../types";
import { DispatchBoard } from "./DispatchBoard";
import { UnassignedOrdersPanel } from "./UnassignedOrdersPanel";

interface ControlViewAProps {
  baristas: Barista[];
  unassignedOrders: UnassignedOrder[];
  nextAvailable: Array<{
    bayNumber: number;
    seconds: number;
    isStandby: boolean;
  }>;
  selectedOrderId: string | null;
  actionTicketKey: string | null;
  currentTimeSec: number;
  timelineCommand: { direction: "back" | "now" | "forward"; id: number } | null;
  onSelectOrder: (orderId: string) => void;
  onAdvanceBay: (bayId: number) => void;
  onOpenTicketDetail: (ticket: OrderTicket) => void;
  onMoveTicket: (ticket: OrderTicket, targetBayId: number) => void;
  onReturnToUnassigned: (ticket: OrderTicket) => void;
  onCloseTicketAction: () => void;
  onRequestRebrew: (ticket: OrderTicket, bayId: number) => void;
  onOpenEmptySlot: (bayId: number) => void;
  onAssignToBay: (order: UnassignedOrder, bayId: number) => void;
  onMergeOrders: (firstUid: string, secondUid: string) => void;
  /** 閲覧だけの画面（/master-sheet/view）。各列の「次へ」と空きスロットを出さない */
  readOnly?: boolean;
  /** 列の「交代」 */
  onChangeLane?: (bayId: number) => void;
}

export const ControlViewA: React.FC<ControlViewAProps> = ({
  baristas,
  unassignedOrders,
  nextAvailable,
  selectedOrderId,
  actionTicketKey,
  currentTimeSec,
  timelineCommand,
  onSelectOrder,
  onAdvanceBay,
  onOpenTicketDetail,
  onMoveTicket,
  onReturnToUnassigned,
  onCloseTicketAction,
  onRequestRebrew,
  onOpenEmptySlot,
  onAssignToBay,
  onMergeOrders,
  readOnly = false,
  onChangeLane,
}) => (
  <div className="flex h-full min-h-0 flex-col gap-2">
    <DispatchBoard
      baristas={baristas}
      highlightFilter={null}
      selectedOrderId={selectedOrderId}
      onSelectOrder={onSelectOrder}
      onAdvanceBay={onAdvanceBay}
      onOpenTicketDetail={onOpenTicketDetail}
      actionTicketKey={actionTicketKey}
      onMoveTicket={onMoveTicket}
      onReturnToUnassigned={onReturnToUnassigned}
      onCloseTicketAction={onCloseTicketAction}
      onRequestRebrew={onRequestRebrew}
      onOpenEmptySlot={onOpenEmptySlot}
      simTimeSec={currentTimeSec}
      timelineCommand={timelineCommand}
      readOnly={readOnly}
      onChangeLane={onChangeLane}
    />

    <div className="relative z-[70] h-[196px] min-h-0 overflow-visible">
      <UnassignedOrdersPanel
        orders={unassignedOrders}
        nextAvailable={nextAvailable}
        selectedOrderId={selectedOrderId}
        onSelectOrder={onSelectOrder}
        onSelectQueueOrder={(order) => onSelectOrder(order.id)}
        onClearSelection={() => onSelectOrder("")}
        onAssignToBay={onAssignToBay}
        onMergeOrders={onMergeOrders}
      />
    </div>
  </div>
);
