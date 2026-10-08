import type React from "react";
import type { Barista, DripCard, OrderTicket } from "../types";
import type { NextAvailable } from "../utils/orderQueue";
import { ControlViewA } from "./ControlViewA";
import { ControlViewC } from "./ControlViewC";
import { ControlViewD } from "./ControlViewD";

export type ControlViewMode = "current" | "c" | "d";

// 管制盤 A・C・D に渡すもの（どれも同じ盤面・同じ操作で、見せ方だけが違う）
export interface ControlViewProps {
  baristas: Barista[];
  unassignedOrders: DripCard[];
  nextAvailable: NextAvailable;
  /** 選んだ注文（orderLabel） */
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
  onAssignToBay: (order: DripCard, bayId: number) => void;
  onMergeOrders: (firstUid: string, secondUid: string) => void;
}

export const ControlWorkspace: React.FC<
  ControlViewProps & { mode: ControlViewMode }
> = ({ mode, ...props }) => {
  if (mode === "d") return <ControlViewD {...props} />;
  if (mode === "c") return <ControlViewC {...props} />;
  return <ControlViewA {...props} />;
};
