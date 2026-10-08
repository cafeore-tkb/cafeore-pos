import type React from "react";
import type { ControlViewProps } from "./ControlWorkspace";
import { DispatchBoard } from "./DispatchBoard";
import { UnassignedOrdersPanel } from "./UnassignedOrdersPanel";

interface ControlViewAProps extends ControlViewProps {
  /** 閲覧だけの画面（/master-sheet/view）。各列の「次へ」と空きスロットを出さない */
  readOnly?: boolean;
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
  onOpenEmptySlot,
  onAssignToBay,
  onMergeOrders,
  readOnly = false,
}) => (
  <div className="flex h-full min-h-0 flex-col gap-2">
    <DispatchBoard
      baristas={baristas}
      selectedOrderId={selectedOrderId}
      onSelectOrder={onSelectOrder}
      onAdvanceBay={onAdvanceBay}
      onOpenTicketDetail={onOpenTicketDetail}
      actionTicketKey={actionTicketKey}
      onMoveTicket={onMoveTicket}
      onReturnToUnassigned={onReturnToUnassigned}
      onCloseTicketAction={onCloseTicketAction}
      onOpenEmptySlot={onOpenEmptySlot}
      simTimeSec={currentTimeSec}
      timelineCommand={timelineCommand}
      readOnly={readOnly}
    />

    <div className="relative z-[70] h-[196px] min-h-0 overflow-visible">
      <UnassignedOrdersPanel
        orders={unassignedOrders}
        nextAvailable={nextAvailable}
        selectedOrderId={selectedOrderId}
        onSelectOrder={onSelectOrder}
        onAssignToBay={onAssignToBay}
        onMergeOrders={onMergeOrders}
      />
    </div>
  </div>
);
