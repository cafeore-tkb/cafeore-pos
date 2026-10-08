import type React from "react";
import type { Barista, OrderTicket, UnassignedOrder } from "../types";
import { ControlViewA } from "./ControlViewA";
import { ControlViewB } from "./ControlViewB";
import { ControlViewC } from "./ControlViewC";
import { ControlViewD } from "./ControlViewD";

export type ControlViewMode = "current" | "new" | "c" | "d";

interface ControlWorkspaceProps {
  mode: ControlViewMode;
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
  onMoveTicket: (
    ticket: OrderTicket,
    targetBayId: number,
    toFront?: boolean,
  ) => void;
  onReturnToUnassigned: (ticket: OrderTicket) => void;
  onCloseTicketAction: () => void;
  onOpenEmptySlot: (bayId: number) => void;
  onAssignToBay: (order: UnassignedOrder, bayId: number) => void;
  onMergeOrders: (firstUid: string, secondUid: string) => void;
}

export const ControlWorkspace: React.FC<ControlWorkspaceProps> = ({
  mode,
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
}) => {
  if (mode === "new") {
    return (
      <ControlViewB
        baristas={baristas}
        unassignedOrders={unassignedOrders}
        simTimeSec={currentTimeSec}
        selectedOrderId={selectedOrderId}
        onSelectOrder={onSelectOrder}
        onSelectQueueOrder={(order) => onSelectOrder(order.id)}
        onAdvanceBay={onAdvanceBay}
        onOpenTicketDetail={onOpenTicketDetail}
        onOpenEmptySlot={onOpenEmptySlot}
        onAssignToBay={onAssignToBay}
      />
    );
  }

  if (mode === "d") {
    return (
      <ControlViewD
        baristas={baristas}
        unassignedOrders={unassignedOrders}
        simTimeSec={currentTimeSec}
        selectedOrderId={selectedOrderId}
        onSelectOrder={onSelectOrder}
        onSelectQueueOrder={(order) => onSelectOrder(order.id)}
        onAdvanceBay={onAdvanceBay}
        onOpenTicketDetail={onOpenTicketDetail}
        onOpenEmptySlot={onOpenEmptySlot}
        onAssignToBay={onAssignToBay}
        onMoveTicket={onMoveTicket}
        onReturnToUnassigned={onReturnToUnassigned}
        onMergeOrders={onMergeOrders}
      />
    );
  }

  if (mode === "c") {
    return (
      <ControlViewC
        baristas={baristas}
        unassignedOrders={unassignedOrders}
        simTimeSec={currentTimeSec}
        selectedOrderId={selectedOrderId}
        onSelectOrder={onSelectOrder}
        onSelectQueueOrder={(order) => onSelectOrder(order.id)}
        onAdvanceBay={onAdvanceBay}
        onOpenTicketDetail={onOpenTicketDetail}
        onOpenEmptySlot={onOpenEmptySlot}
        onAssignToBay={onAssignToBay}
      />
    );
  }

  return (
    <ControlViewA
      baristas={baristas}
      unassignedOrders={unassignedOrders}
      nextAvailable={nextAvailable}
      selectedOrderId={selectedOrderId}
      actionTicketKey={actionTicketKey}
      currentTimeSec={currentTimeSec}
      timelineCommand={timelineCommand}
      onSelectOrder={onSelectOrder}
      onAdvanceBay={onAdvanceBay}
      onOpenTicketDetail={onOpenTicketDetail}
      onMoveTicket={onMoveTicket}
      onReturnToUnassigned={onReturnToUnassigned}
      onCloseTicketAction={onCloseTicketAction}
      onOpenEmptySlot={onOpenEmptySlot}
      onAssignToBay={onAssignToBay}
      onMergeOrders={onMergeOrders}
    />
  );
};
