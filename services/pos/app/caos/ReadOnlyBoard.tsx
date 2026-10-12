import { jstClock, useColorSettings } from "@cafeore/common";
import { Eye } from "lucide-react";
import { useMemo } from "react";
import { useCurrentTime } from "~/components/functional/useCurrentTime";
import { ControlViewA } from "./components/ControlViewA";
import { LaneHeaderStatus } from "./components/LaneParts";
import { PosStatusBadge } from "./components/TopHeader";
import { useBeanInventory } from "./hooks/useBeanInventory";
import { useLiveBoard } from "./hooks/useLiveBoard";
import { cardLooks, totalCups } from "./logic/cards";
import { boardLanes } from "./logic/lanes";
import { nextAvailableBays } from "./logic/queue";

// 閲覧だけの管制盤（/master-sheet/view）。操作の画面（App.tsx）と同じ cafeore-pos の盤面（useLiveBoard）を、
// 管制盤 A のタイムラインに映すだけ。カップへの書き込み（PUT /api/caos/cups）も「次へ」も送らない。

const noop = () => {};

export default function ReadOnlyBoard() {
  const nowMs = useCurrentTime(1000).getTime();
  const { cards, status } = useLiveBoard({ enabled: true, nowMs });
  const { colorSettings } = useColorSettings();
  const { beanIndex } = useBeanInventory();
  const lanes = useMemo(() => boardLanes(cards), [cards]);
  const unassigned = useMemo(
    () => cards.filter((card) => card.status === "unassigned"),
    [cards],
  );
  const looks = useMemo(
    () => cardLooks(cards, colorSettings, beanIndex),
    [cards, colorSettings, beanIndex],
  );

  return (
    <div className="flex h-screen w-screen select-none flex-col gap-2 overflow-hidden bg-[#f0f4fa] p-2 font-sans text-[#0f172a]">
      <header className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2">
        <span className="rounded-lg bg-slate-900 px-2.5 py-1.5 font-black text-sm text-white">
          CaOS
        </span>
        <span className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 font-bold text-slate-600 text-xs">
          <Eye className="h-4 w-4" />
          閲覧のみ
        </span>
        <span className="font-black font-mono text-3xl tabular-nums">
          {jstClock(nowMs)}
        </span>
        <span className="ml-auto font-bold text-slate-600 text-sm">
          未割当{" "}
          <span className="font-black font-mono text-red-600">
            {totalCups(unassigned)}
          </span>{" "}
          杯
        </span>
        {/* 上級生のドリッパーが無いときの知らせ（担当者は表示だけ） */}
        <LaneHeaderStatus />
        <PosStatusBadge status={status} />
      </header>
      <div className="min-h-0 flex-1">
        <ControlViewA
          lanes={lanes}
          unassignedOrders={unassigned}
          looks={looks}
          nextAvailable={nextAvailableBays(lanes, nowMs)}
          selectedOrderId={null}
          actionTicketKey={null}
          nowMs={nowMs}
          timelineCommand={null}
          onSelectOrder={noop}
          onAdvanceBay={noop}
          onOpenTicketPad={noop}
          onOpenTicketDetail={noop}
          onMoveTicket={noop}
          onReturnToUnassigned={noop}
          onCloseTicketAction={noop}
          onOpenEmptySlot={noop}
          onAssignToBay={noop}
          onMergeOrders={noop}
          onSplitCup={noop}
          readOnly
        />
      </div>
    </div>
  );
}
