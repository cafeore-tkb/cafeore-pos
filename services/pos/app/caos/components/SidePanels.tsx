import { caosBrewSec, caosDurationLabel } from "@cafeore/common";
import { ArrowRight, ExternalLink, Undo2, X } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { Sheet, SheetContent, SheetTitle } from "~/components/ui/sheet";
import type { Barista, DripCard, HistoricalOrder, OrderTicket } from "../types";
import { laneOrdinal, moveTargets } from "../utils/lanes";
import { orderLabel } from "../utils/orderQueue";
import { AnalyticsView } from "./AnalyticsView";
import { BeanQueueView } from "./BeanQueueView";
import { LaneBadge } from "./BoardParts";
import { OrderCard } from "./OrderCard";
import type { NavTab } from "./TopHeader";

// 右のパネル（割当・詳細・補助のタブ）。POS の Sheet を、管制盤を隠さない形（ヘッダーの下・背景を暗くしない）で使う。
// 管制盤はパネルを開いたまま操作できる。closeOnOutside なら、パネルの外を押すと閉じる。
// Sheet は body に出るので、CaOS のスタイル（caos.css）が効くよう caos-root を付ける。
const SidePanel: React.FC<{
  title: string;
  onClose: () => void;
  closeOnOutside?: boolean;
  actions?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
}> = ({
  title,
  onClose,
  closeOnOutside = false,
  actions,
  footer,
  children,
}) => (
  <Sheet
    open
    modal={false}
    onOpenChange={(open) => {
      if (!open) onClose();
    }}
  >
    <SheetContent
      aria-describedby={undefined}
      onOpenAutoFocus={(event) => event.preventDefault()}
      onInteractOutside={(event) => {
        if (!closeOnOutside) event.preventDefault();
      }}
      className="caos-root top-[56px] flex h-auto w-[min(440px,44vw)] min-w-[360px] select-none flex-col gap-0 border-slate-300 bg-white p-0 text-slate-950 shadow-2xl sm:max-w-none [&>button:last-child]:hidden"
    >
      <header className="flex h-[52px] shrink-0 items-center gap-1 border-slate-200 border-b bg-slate-50 px-4">
        <SheetTitle className="mr-auto font-black text-[16px] text-slate-950">
          {title}
        </SheetTitle>
        {actions}
        <button
          type="button"
          onClick={onClose}
          className="flex h-11 w-11 touch-manipulation items-center justify-center rounded-full hover:bg-slate-200"
          aria-label="閉じる"
        >
          <X className="h-5 w-5" />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
      {footer}
    </SheetContent>
  </Sheet>
);

// 空きスロットから開く割当。未割当のカードとドリッパーを選んで確定する
export const AssignPanel: React.FC<{
  /** 空きスロットを押したドリッパー */
  bayId: number;
  baristas: Barista[];
  unassignedOrders: DripCard[];
  onClose: () => void;
  onAssign: (orderId: string, targetBayId: number) => void;
}> = ({ bayId, baristas, unassignedOrders, onClose, onAssign }) => {
  const [selectedOrderUid, setSelectedOrderUid] = useState(
    unassignedOrders[0]?.ticketUid ?? "",
  );
  const [selectedBayId, setSelectedBayId] = useState(bayId);
  const selectedOrder = unassignedOrders.find(
    (order) => order.ticketUid === selectedOrderUid,
  );
  const canAssign = Boolean(
    selectedOrder &&
      (!selectedOrder.preferredBaristaId ||
        selectedOrder.preferredBaristaId === selectedBayId),
  );

  return (
    <SidePanel
      title={`ドリッパー ${laneOrdinal(bayId)} にオーダー割当`}
      onClose={onClose}
      footer={
        <div className="flex items-center justify-between border-slate-200 border-t bg-slate-50 px-5 py-3">
          <button
            onClick={onClose}
            className="min-h-[44px] touch-manipulation rounded-lg border border-slate-300 px-4 font-bold text-slate-700 text-xs hover:bg-slate-100"
          >
            キャンセル
          </button>
          <button
            disabled={!canAssign}
            onClick={() => {
              onAssign(selectedOrderUid, selectedBayId);
              onClose();
            }}
            className="flex min-h-[44px] touch-manipulation items-center gap-1.5 rounded-lg bg-emerald-700 px-4 font-bold text-white text-xs shadow-xs hover:bg-emerald-800 disabled:opacity-50"
          >
            割当を確定
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
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
              key={order.ticketUid}
              card={order}
              size="sm"
              selected={selectedOrderUid === order.ticketUid}
              note={`標準予測: ${caosDurationLabel(caosBrewSec(order.cupCount))}`}
              onClick={() => {
                setSelectedOrderUid(order.ticketUid);
                if (order.preferredBaristaId)
                  setSelectedBayId(order.preferredBaristaId);
              }}
              className="cursor-pointer"
            />
          ))}
        </div>
      )}

      <h3 className="mt-4 mb-1.5 font-bold text-slate-700 text-xs">
        割当先のドリッパー（抽出担当者）:
      </h3>
      <div className="grid grid-cols-3 gap-2">
        {baristas.map((barista) => (
          <button
            key={barista.id}
            disabled={Boolean(
              selectedOrder?.preferredBaristaId &&
                selectedOrder.preferredBaristaId !== barista.id,
            )}
            onClick={() => setSelectedBayId(barista.id)}
            className={`flex min-h-[72px] touch-manipulation flex-col justify-between rounded-lg border p-2 text-left ${
              selectedBayId === barista.id
                ? "border-emerald-600 bg-emerald-50 shadow-xs ring-1 ring-emerald-600"
                : "border-slate-200 hover:bg-slate-50 disabled:bg-slate-100 disabled:opacity-25"
            }`}
          >
            <LaneBadge bayId={barista.id} />
            <span className="text-[10px] text-slate-500">
              待機 {barista.queue.length}件
            </span>
          </button>
        ))}
      </div>
    </SidePanel>
  );
};

// 待機のカードの詳細（管制盤 C・D）。別のドリッパーへ・先頭へ・未割当に戻す
export const TicketDetailPanel: React.FC<{
  ticket: OrderTicket;
  currentBayId: number | null;
  onClose: () => void;
  onMoveTicket: (ticket: OrderTicket, bayId: number, toFront?: boolean) => void;
  onReturnToUnassigned: (ticket: OrderTicket) => void;
}> = ({
  ticket,
  currentBayId,
  onClose,
  onMoveTicket,
  onReturnToUnassigned,
}) => (
  <SidePanel title="未開始オーダーの移動" onClose={onClose} closeOnOutside>
    <OrderCard card={ticket} size="xl" />
    <h3 className="mt-5 mb-2 font-black text-[14px] text-slate-700">
      他のドリッパーへ移動・先頭へ
    </h3>
    <div className="grid grid-cols-3 gap-2">
      {moveTargets(ticket.preferredBaristaId, currentBayId).map(
        ({ bayId, toFront, disabled }) => (
          <button
            key={bayId}
            type="button"
            disabled={disabled}
            onClick={() => {
              onMoveTicket(ticket, bayId, toFront);
              onClose();
            }}
            className="h-16 touch-manipulation rounded-xl border-2 border-slate-300 bg-white font-black font-mono text-[24px] active:bg-slate-900 active:text-white disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-300"
          >
            {toFront ? `${bayId} 先頭へ` : bayId}
          </button>
        ),
      )}
    </div>
    {ticket.preferredBaristaId && (
      <p className="mt-2 font-bold text-[13px] text-violet-700">
        指名オーダー：ドリッパー {laneOrdinal(ticket.preferredBaristaId)} のみ
      </p>
    )}
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
export type AuxiliaryTab = Exclude<NavTab, "control">;

const AUXILIARY_TITLES: Record<AuxiliaryTab, string> = {
  bays: "ドリッパー",
  beans: "豆キュー",
  analytics: "実績",
};

export const AuxiliaryContent: React.FC<{
  tab: AuxiliaryTab;
  baristas: Barista[];
  // 豆のパネルに出す POS の在庫（豆だけ）と、盤面にある杯数（在庫対象の ID ごと）
  beans: React.ComponentProps<typeof BeanQueueView>;
  salesOrders: HistoricalOrder[];
  periodStartMs?: number;
  periodEndMs?: number;
}> = ({ tab, baristas, beans, ...analytics }) => {
  if (tab === "beans") return <BeanQueueView {...beans} />;
  if (tab === "analytics")
    return <AnalyticsView baristas={baristas} {...analytics} />;
  // ドリッパー：6 列（1st〜6th）の今の抽出と待ちの件数
  return (
    <div className="grid grid-cols-2 gap-2">
      {baristas.map((barista) => {
        const current = barista.queue[0];
        return (
          <article
            key={barista.id}
            className="rounded-xl border border-slate-300 bg-white p-3 shadow-xs"
          >
            <LaneBadge bayId={barista.id} />
            <div className="mt-2 border-slate-100 border-t pt-2 text-[12px]">
              {current ? (
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-bold text-slate-700">
                    {current.beanName}
                  </span>
                  <span className="shrink-0 font-black font-mono text-[15px] text-slate-950">
                    {orderLabel(current)}
                  </span>
                </div>
              ) : (
                <span className="font-bold text-slate-400">待機中</span>
              )}
              <div className="mt-1 font-bold text-[11px] text-slate-500">
                待ち {Math.max(0, barista.queue.length - 1)}件
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
