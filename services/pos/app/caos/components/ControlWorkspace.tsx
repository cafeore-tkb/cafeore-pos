import type { CaosCard, CaosPlace } from "@cafeore/common";
import type React from "react";
import type { TimelineCommand } from "../hooks/useTimelineScroll";
import type { CardLooks } from "../logic/cards";
import type { Lane } from "../logic/lanes";
import type { NextAvailable } from "../logic/queue";
import { ControlViewA } from "./ControlViewA";
import { ControlViewC } from "./ControlViewC";
import { ControlViewD } from "./ControlViewD";
import type { UnassignedFold } from "./UnassignedOrdersPanel";

// 管制盤 A・C・D。ドリッパーのカードは押すと始める・終える、長押しで右の詳細（待機）・緊急の入力（抽出中・終わり）のパネル
export const CONTROL_VIEWS = {
  a: { label: "A", timelineControls: true },
  c: { label: "C", timelineControls: false },
  d: { label: "D", timelineControls: false },
} as const;
export type ControlViewMode = keyof typeof CONTROL_VIEWS;

// 管制盤 A・C・D に渡すもの（どれも同じ盤面・同じ操作で、見せ方だけが違う）
export interface ControlViewProps {
  /** 6 列のドリッパー（終わり・抽出中・待機） */
  lanes: Lane[];
  /** 未割当のカード（注文番号の順） */
  unassignedOrders: CaosCard[];
  /** カードの色・豆と、分けた注文 */
  looks: CardLooks;
  nextAvailable: NextAvailable;
  /** 選んだ注文（orderLabel） */
  selectedOrderId: string | null;
  /** 今（エポックのミリ秒。実データテストでは練習の時計） */
  nowMs: number;
  timelineCommand: TimelineCommand | null;
  /** 注文を選ぶ（null で外す） */
  onSelectOrder: (orderId: string | null) => void;
  onAdvanceBay: (bayId: number) => void;
  /** ドリッパーのカードを押した（抽出中は終える、待機はそれを始める（抽出中があれば終える）、終わりは何もしない）。閲覧だけの画面では呼ばない */
  onPressCard: (card: CaosCard) => void;
  /**
   * ドリッパーのカードの長押し。待機のカードは詳細のパネル（移す・先頭へ・未割当に戻す・外す・緊急の取り消し）、
   * 抽出中・終わりのカードは入れ直し（緊急）のパネル（抽出中のカードは 1〜6 に移す・未割当に戻すも）を開き、その注文を選ぶ。無ければ（閲覧だけ）長押ししない
   */
  onHoldCard?: (card: CaosCard) => void;
  /** 入れ直し（緊急）のカードを取り消す（未割当・待機のカードを開いたときに出す）。無ければ（閲覧だけ・実データテスト中）出さない */
  onCancelEmergency?: (card: CaosCard) => void;
  /** 待機・抽出中のカードを別のドリッパーへ。place は列のどこか（@cafeore/common の CaosPlace。"front"・"queueFront"・カードの前後。無ければ最後。同じドリッパーの中の入れ替えにも使う） */
  onMoveTicket: (
    card: CaosCard,
    targetBayId: number,
    place?: CaosPlace,
  ) => void;
  onReturnToUnassigned: (card: CaosCard) => void;
  onOpenEmptySlot: (bayId: number) => void;
  /** 列の操作（担当者の交代・待機をまとめて移す）を開く（ドリッパーの番号を押したとき）。閲覧だけの画面では渡さない */
  onOpenLane?: (bayId: number) => void;
  /** 未割当のカードをドリッパーへ。place はドラッグで列のカードの前後に落としたとき（@cafeore/common の CaosPlace） */
  onAssignToBay: (card: CaosCard, bayId: number, place?: CaosPlace) => void;
  /** 1 杯のカード（firstKey）を、統合できる 1 杯のカード（intoKey。未割当・待機・抽出中）に入れる（firstKey が抽出中なら intoKey を firstKey に入れる） */
  onMergeOrders: (firstKey: string, intoKey: string) => void;
  /** 統合の解除（統合した未割当・待機のカードから cupId の 1 杯を外して未割当に戻す） */
  onSplitCup: (card: CaosCard, cupId: string) => void;
  /** 閲覧だけの画面（/master-sheet/view）。「次へ」・空きスロットを出さず、カードを押しても動かさない */
  readOnly?: boolean;
  /** 点滅させるカード（key。閲覧だけの画面で、タイムラインに新しく入ったカード。管制盤 A） */
  flashKeys?: ReadonlySet<string>;
  /** 未割当の横帯をたたむか（管制盤 A。渡したときだけ、横帯のヘッダーに「たたむ」「ひらく」を出す） */
  unassignedFold?: UnassignedFold;
  /** タイムラインが NOW を追っているかが変わったとき（管制盤 A。ヘッダーの「現在」の見た目） */
  onFollowNowChange?: (following: boolean) => void;
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
