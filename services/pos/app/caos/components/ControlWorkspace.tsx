import type { CaosCard, CaosPlace } from "@cafeore/common";
import type React from "react";
import type { TimelineCommand } from "../hooks/useTimelineScroll";
import type { CardLooks } from "../logic/cards";
import type { Lane } from "../logic/lanes";
import type { NextAvailable } from "../logic/queue";
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
  /** 6 列のドリッパー（終わり・抽出中・待機） */
  lanes: Lane[];
  /** 未割当のカード（注文番号の順） */
  unassignedOrders: CaosCard[];
  /** カードの色と、分けた注文の中の位置 */
  looks: CardLooks;
  nextAvailable: NextAvailable;
  /** 選んだ注文（orderLabel） */
  selectedOrderId: string | null;
  /** 1〜6 のボタンを開いた待機のカード（管制盤 A） */
  actionTicketKey: string | null;
  /** 今（エポックのミリ秒。実データテストでは練習の時計） */
  nowMs: number;
  timelineCommand: TimelineCommand | null;
  /** 注文を選ぶ（null で外す） */
  onSelectOrder: (orderId: string | null) => void;
  onAdvanceBay: (bayId: number) => void;
  /** 待機のカードの 1〜6 のボタンを開く（管制盤 A） */
  onOpenTicketPad: (card: CaosCard) => void;
  /** 待機のカードの詳細を開き、その注文を選ぶ（管制盤 C・D） */
  onOpenTicketDetail: (card: CaosCard) => void;
  /** 待機のカードを別のドリッパーへ。place が "front" なら待機の先頭へ、{ beforeKey } ならそのカードの前へ（同じドリッパーの中の入れ替えにも使う） */
  onMoveTicket: (
    card: CaosCard,
    targetBayId: number,
    place?: CaosPlace,
  ) => void;
  onReturnToUnassigned: (card: CaosCard) => void;
  onCloseTicketAction: () => void;
  onOpenEmptySlot: (bayId: number) => void;
  /** 未割当のカードをドリッパーへ。place が { beforeKey } ならそのカードの前へ（ドラッグで途中に落としたとき） */
  onAssignToBay: (card: CaosCard, bayId: number, place?: CaosPlace) => void;
  onMergeOrders: (firstKey: string, secondKey: string) => void;
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
