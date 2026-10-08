import type React from "react";
import type { TimelineCommand } from "../hooks/useTimelineScroll";
import type { NextAvailable } from "../logic/queue";
import type { Barista, DripCard, OrderTicket } from "../types";
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
  /** 1〜6 のボタンを開いた待機のカード（管制盤 A） */
  actionTicketKey: string | null;
  currentTimeSec: number;
  timelineCommand: TimelineCommand | null;
  onSelectOrder: (orderId: string) => void;
  onAdvanceBay: (bayId: number) => void;
  onOpenTicketDetail: (ticket: OrderTicket) => void;
  onMoveTicket: (ticket: OrderTicket, targetBayId: number) => void;
  onReturnToUnassigned: (ticket: OrderTicket) => void;
  onCloseTicketAction: () => void;
  /** 抽出中・終わったカードから緊急の入れ直しを始める */
  onRequestRebrew: (ticket: OrderTicket) => void;
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
