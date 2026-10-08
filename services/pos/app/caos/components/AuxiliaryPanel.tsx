import { ExternalLink, X } from "lucide-react";
import type React from "react";
import type { Barista, HistoricalOrder } from "../types";
import { AnalyticsView } from "./AnalyticsView";
import { BaysOverviewView } from "./BaysOverviewView";
import { BeanQueueView } from "./BeanQueueView";
import type { NavTab } from "./TopHeader";

export type AuxiliaryTab = Exclude<NavTab, "control">;

const getAuxiliaryTitle = (tab: AuxiliaryTab) =>
  tab === "bays" ? "ドリッパー" : tab === "beans" ? "豆キュー" : "実績";

interface AuxiliaryContentProps {
  tab: AuxiliaryTab;
  baristas: Barista[];
  // 豆のパネルに出す POS の在庫（豆だけ）と、盤面にある杯数（在庫対象の ID ごと）
  beans: React.ComponentProps<typeof BeanQueueView>;
  salesOrders: HistoricalOrder[];
  periodStartMs?: number;
  periodEndMs?: number;
}

export const AuxiliaryContent: React.FC<AuxiliaryContentProps> = ({
  tab,
  baristas,
  beans,
  salesOrders,
  periodStartMs,
  periodEndMs,
}) => (
  <>
    {tab === "bays" && <BaysOverviewView baristas={baristas} />}
    {tab === "beans" && <BeanQueueView {...beans} />}
    {tab === "analytics" && (
      <AnalyticsView
        baristas={baristas}
        salesOrders={salesOrders}
        periodStartMs={periodStartMs}
        periodEndMs={periodEndMs}
      />
    )}
  </>
);

interface AuxiliarySheetProps {
  tab: AuxiliaryTab;
  onOpenInNewTab: () => void;
  onClose: () => void;
  children: React.ReactNode;
}

export const AuxiliarySheet: React.FC<AuxiliarySheetProps> = ({
  tab,
  onOpenInNewTab,
  onClose,
  children,
}) => {
  const title = getAuxiliaryTitle(tab);

  return (
    <aside className="context-sheet absolute top-[56px] right-0 bottom-0 z-40 flex w-[min(440px,44vw)] min-w-[360px] flex-col border-slate-300 border-l bg-white shadow-2xl">
      <div className="flex h-[52px] shrink-0 items-center justify-between border-slate-200 border-b bg-slate-50 px-4">
        <h2 className="font-black text-[16px] text-slate-950">{title}</h2>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onOpenInNewTab}
            className="flex h-11 w-11 touch-manipulation items-center justify-center rounded-full hover:bg-slate-200"
            aria-label={`${title}を新しいブラウザタブで開く`}
            title="新しいタブで開く"
          >
            <ExternalLink className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-slate-200"
            aria-label="補助パネルを閉じる"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">{children}</div>
    </aside>
  );
};

interface StandaloneAuxiliaryPanelProps {
  tab: AuxiliaryTab;
  children: React.ReactNode;
}

export const StandaloneAuxiliaryPanel: React.FC<
  StandaloneAuxiliaryPanelProps
> = ({ tab, children }) => (
  <div className="h-screen overflow-hidden bg-slate-100 font-sans text-slate-950">
    <header className="flex h-14 items-center border-slate-300 border-b bg-white px-5">
      <h1 className="font-black text-[18px]">{getAuxiliaryTitle(tab)}</h1>
    </header>
    <main className="h-[calc(100vh-56px)] overflow-y-auto p-4">
      <div className="mx-auto max-w-[900px]">{children}</div>
    </main>
  </div>
);
