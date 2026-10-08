import { type CaosCard, type CaosPlace, caosBrewSec } from "@cafeore/common";
import { ArrowRight, ExternalLink, Undo2, X } from "lucide-react";
import type React from "react";
import { useRef, useState } from "react";
import type { AuxiliaryTab } from "../hooks/useAuxiliaryWindow";
import { useOutsidePress } from "../hooks/useOutsidePress";
import {
  type CardLook,
  type CardLooks,
  cardName,
  orderLabel,
} from "../logic/cards";
import { clockLabel } from "../logic/format";
import { type Lane, laneOrdinal, moveTargets } from "../logic/lanes";
import { AnalyticsView } from "./AnalyticsView";
import { BeanQueueView } from "./BeanQueueView";
import { LaneBadge } from "./BoardParts";
import { OrderCard } from "./OrderCard";

// 右のパネル（割当・詳細・補助のタブ）。ヘッダーの下に右から出し、管制盤は隠さない（開いたまま操作できる）。
// onOutsidePress を渡すと、パネルの外を押したときに呼ぶ。
export const SidePanel: React.FC<{
  title: React.ReactNode;
  onClose: () => void;
  onOutsidePress?: () => void;
  actions?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, onClose, onOutsidePress, actions, footer, children }) => {
  const panelRef = useRef<HTMLElement>(null);
  useOutsidePress(
    onOutsidePress !== undefined,
    (target) => Boolean(panelRef.current?.contains(target)),
    () => onOutsidePress?.(),
  );
  return (
    <aside
      ref={panelRef}
      className="fade-in-75 slide-in-from-right fixed top-[56px] right-0 bottom-0 z-[150] flex w-[min(440px,44vw)] min-w-[360px] animate-in select-none flex-col border-slate-300 border-l bg-white text-slate-950 shadow-2xl duration-[220ms] ease-[cubic-bezier(0.22,1,0.36,1)]"
    >
      <header className="flex min-h-[52px] shrink-0 items-center gap-1 border-slate-200 border-b bg-slate-50 px-4">
        <div className="mr-auto min-w-0 font-black text-[16px]">{title}</div>
        {actions}
        <button
          type="button"
          onClick={onClose}
          className="flex h-11 w-11 shrink-0 touch-manipulation items-center justify-center rounded-full hover:bg-black/5"
          aria-label="閉じる"
        >
          <X className="h-5 w-5" />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
      {footer}
    </aside>
  );
};

/** パネルの下の「キャンセル」と確定のボタン */
export const PanelFooter: React.FC<{
  onCancel: () => void;
  children: React.ReactNode;
}> = ({ onCancel, children }) => (
  <div className="flex shrink-0 items-center justify-between gap-2 border-slate-200 border-t bg-slate-50 px-4 py-3">
    <button
      type="button"
      onClick={onCancel}
      className="min-h-[44px] touch-manipulation rounded-lg border border-slate-300 bg-white px-4 font-bold text-slate-700 text-xs hover:bg-slate-100"
    >
      キャンセル
    </button>
    {children}
  </div>
);

// 空きスロットから開く割当。未割当のカードとドリッパーを選んで確定する
export const AssignPanel: React.FC<{
  /** 空きスロットを押したドリッパー */
  bayId: number;
  lanes: Lane[];
  unassignedOrders: CaosCard[];
  looks: CardLooks;
  onClose: () => void;
  onAssign: (card: CaosCard, targetBayId: number) => void;
}> = ({ bayId, lanes, unassignedOrders, looks, onClose, onAssign }) => {
  const [selectedOrderUid, setSelectedOrderUid] = useState(
    unassignedOrders[0]?.key ?? "",
  );
  const [selectedBayId, setSelectedBayId] = useState(bayId);
  const selectedOrder = unassignedOrders.find(
    (order) => order.key === selectedOrderUid,
  );
  const canAssign = Boolean(selectedOrder);

  return (
    <SidePanel
      title={`ドリッパー ${laneOrdinal(bayId)} にオーダー割当`}
      onClose={onClose}
      footer={
        <PanelFooter onCancel={onClose}>
          <button
            type="button"
            disabled={!canAssign}
            onClick={() => {
              if (selectedOrder) onAssign(selectedOrder, selectedBayId);
              onClose();
            }}
            className="flex min-h-[44px] touch-manipulation items-center gap-1.5 rounded-lg bg-emerald-700 px-4 font-bold text-white text-xs shadow-xs hover:bg-emerald-800 disabled:opacity-50"
          >
            割当を確定
            <ArrowRight className="h-4 w-4" />
          </button>
        </PanelFooter>
      }
    >
      <h3 className="mb-1.5 font-bold text-slate-700 text-xs">
        割り当てる未割当オーダー:
      </h3>
      {unassignedOrders.length === 0 ? (
        <p className="rounded border border-slate-200 bg-slate-50 p-3 text-slate-500 text-xs">
          未割当オーダーがありません
        </p>
      ) : (
        <div className="grid max-h-[200px] gap-1.5 overflow-y-auto p-1">
          {unassignedOrders.map((order) => (
            <OrderCard
              key={order.key}
              card={order}
              look={looks.get(order.key)}
              size="sm"
              selected={selectedOrderUid === order.key}
              note={`標準予測: ${clockLabel(caosBrewSec(order.cups.length))}`}
              onClick={() => setSelectedOrderUid(order.key)}
              className="cursor-pointer"
            />
          ))}
        </div>
      )}

      <h3 className="mt-4 mb-1.5 font-bold text-slate-700 text-xs">
        割当先のドリッパー（抽出担当者）:
      </h3>
      <div className="grid grid-cols-3 gap-2">
        {lanes.map((lane) => (
          <button
            key={lane.id}
            type="button"
            onClick={() => setSelectedBayId(lane.id)}
            className={`flex min-h-[72px] touch-manipulation flex-col justify-between rounded-lg border p-2 text-left ${
              selectedBayId === lane.id
                ? "border-emerald-600 bg-emerald-50 shadow-xs ring-1 ring-emerald-600"
                : "border-slate-200 hover:bg-slate-50"
            }`}
          >
            <LaneBadge bayId={lane.id} />
            <span className="text-[10px] text-slate-500">
              待機 {lane.queued.length}件
            </span>
          </button>
        ))}
      </div>
    </SidePanel>
  );
};

// 待機のカードの詳細（管制盤 C・D）。別のドリッパーへ・先頭へ（今のドリッパーのボタン）・未割当に戻す。パネルの外を押すと閉じる
export const TicketDetailPanel: React.FC<{
  ticket: CaosCard;
  look?: CardLook;
  currentBayId: number | null;
  onClose: () => void;
  onMoveTicket: (card: CaosCard, bayId: number, place?: CaosPlace) => void;
  onReturnToUnassigned: (card: CaosCard) => void;
}> = ({
  ticket,
  look,
  currentBayId,
  onClose,
  onMoveTicket,
  onReturnToUnassigned,
}) => (
  <SidePanel
    title="未開始オーダーの移動"
    onClose={onClose}
    onOutsidePress={onClose}
  >
    <OrderCard card={ticket} look={look} size="xl" />
    <h3 className="mt-5 mb-2 font-black text-[14px] text-slate-700">
      他のドリッパーへ移動・先頭へ
    </h3>
    <div className="grid grid-cols-3 gap-2">
      {moveTargets(currentBayId).map(({ bayId, toFront }) => (
        <button
          key={bayId}
          type="button"
          onClick={() => {
            onMoveTicket(ticket, bayId, toFront ? "front" : undefined);
            onClose();
          }}
          className="h-16 touch-manipulation rounded-xl border-2 border-slate-300 bg-white font-black font-mono text-[24px] active:bg-slate-900 active:text-white disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-300"
        >
          {toFront ? `${bayId} 先頭へ` : bayId}
        </button>
      ))}
    </div>
    <button
      type="button"
      onClick={() => {
        onReturnToUnassigned(ticket);
        onClose();
      }}
      className="mt-5 flex min-h-[60px] w-full touch-manipulation items-center justify-center gap-2 rounded-xl border-2 border-red-200 bg-red-50 px-4 font-black text-[16px] text-red-700 active:bg-red-100"
    >
      <Undo2 className="h-5 w-5" />
      未割り当に戻す
    </button>
    <p className="mt-5 flex items-center gap-2 rounded-lg bg-slate-100 p-3 font-bold text-[13px] text-slate-500">
      <ArrowRight className="h-4 w-4" />
      抽出開始後はここから変更できません
    </p>
  </SidePanel>
);

// 補助のタブ（ドリッパー・豆キュー・実績）。右のパネルか、新しいブラウザタブ（?panel=）で開く
export const AUXILIARY_TITLES: Record<AuxiliaryTab, string> = {
  bays: "ドリッパー",
  beans: "豆キュー",
  analytics: "実績",
};

export const AuxiliaryContent: React.FC<
  { tab: AuxiliaryTab } & React.ComponentProps<typeof AnalyticsView>
> = ({ tab, lanes, ...analytics }) => {
  if (tab === "beans") return <BeanQueueView />;
  if (tab === "analytics")
    return <AnalyticsView lanes={lanes} {...analytics} />;
  // ドリッパー：6 列（1st〜6th）の今の抽出と待ちの件数
  return (
    <div className="grid grid-cols-2 gap-2">
      {lanes.map((lane) => {
        const current = lane.brewing ?? lane.queued[0];
        const waiting = lane.queued.length - (lane.brewing ? 0 : 1);
        return (
          <article
            key={lane.id}
            className="rounded-xl border border-slate-300 bg-white p-3 shadow-xs"
          >
            <LaneBadge bayId={lane.id} />
            <div className="mt-2 border-slate-100 border-t pt-2 text-[12px]">
              {current ? (
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-bold text-slate-700">
                    {cardName(current)}
                  </span>
                  <span className="shrink-0 font-black font-mono text-[15px] text-slate-950">
                    {orderLabel(current)}
                  </span>
                </div>
              ) : (
                <span className="font-bold text-slate-400">待機中</span>
              )}
              <div className="mt-1 font-bold text-[11px] text-slate-500">
                待ち {Math.max(0, waiting)}件
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
};

export const AuxiliarySheet: React.FC<{
  tab: AuxiliaryTab;
  onOpenInNewTab: () => void;
  onClose: () => void;
  children: React.ReactNode;
}> = ({ tab, onOpenInNewTab, onClose, children }) => (
  <SidePanel
    title={AUXILIARY_TITLES[tab]}
    onClose={onClose}
    actions={
      <button
        type="button"
        onClick={onOpenInNewTab}
        className="flex h-11 w-11 touch-manipulation items-center justify-center rounded-full hover:bg-slate-200"
        aria-label={`${AUXILIARY_TITLES[tab]}を新しいブラウザタブで開く`}
        title="新しいタブで開く"
      >
        <ExternalLink className="h-5 w-5" />
      </button>
    }
  >
    {children}
  </SidePanel>
);

export const StandaloneAuxiliaryPanel: React.FC<{
  tab: AuxiliaryTab;
  children: React.ReactNode;
}> = ({ tab, children }) => (
  <div className="h-screen overflow-hidden bg-slate-100 font-sans text-slate-950">
    <header className="flex h-14 items-center border-slate-300 border-b bg-white px-5">
      <h1 className="font-black text-[18px]">{AUXILIARY_TITLES[tab]}</h1>
    </header>
    <main className="h-[calc(100vh-56px)] overflow-y-auto p-4">
      <div className="mx-auto max-w-[900px]">{children}</div>
    </main>
  </div>
);
