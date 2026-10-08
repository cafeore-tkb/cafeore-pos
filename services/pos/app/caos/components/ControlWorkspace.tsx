import type React from "react";
import type { TimelineCommand } from "../hooks/useTimelineScroll";
import type { NextAvailable } from "../logic/queue";
import type { Barista, DripCard, OrderTicket } from "../types";
import { ControlViewA } from "./ControlViewA";
import { ControlViewC } from "./ControlViewC";
import { ControlViewD } from "./ControlViewD";

// 管制盤 A・C・D。待機のカードは、A はカードの上の 1〜6 のボタン、C・D は右の詳細のパネルで動かす
export const CONTROL_VIEWS = {
  a: { label: "A", timelineControls: true, detailPanel: false },
  c: { label: "C", timelineControls: false, detailPanel: true },
  d: { label: "D", timelineControls: false, detailPanel: true },
} as const;
export type ControlViewMode = keyof typeof CONTROL_VIEWS;

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
  /** 注文を選ぶ（null で外す） */
  onSelectOrder: (orderId: string | null) => void;
  onAdvanceBay: (bayId: number) => void;
  /** 待機のカードの 1〜6 のボタンを開く（管制盤 A） */
  onOpenTicketPad: (ticket: OrderTicket) => void;
  /** 待機のカードの詳細を開き、その注文を選ぶ（管制盤 C・D） */
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

const VIEWS: Record<ControlViewMode, React.FC<ControlViewProps>> = {
  a: ControlViewA,
  c: ControlViewC,
  d: ControlViewD,
};

export const ControlWorkspace: React.FC<
  ControlViewProps & { mode: ControlViewMode }
> = ({ mode, ...props }) => {
  const View = VIEWS[mode];
  return <View {...props} />;
};
