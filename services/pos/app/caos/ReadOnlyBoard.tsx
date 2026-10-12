import { useColorSettings } from "@cafeore/common";
import { useMemo } from "react";
import { useCurrentTime } from "~/components/functional/useCurrentTime";
import { ControlViewA } from "./components/ControlViewA";
import { ViewHeader } from "./components/ViewHeader";
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
      <ViewHeader nowMs={nowMs} status={status}>
        <span className="ml-auto font-bold text-slate-600 text-sm">
          未割当{" "}
          <span className="font-black font-mono text-red-600">
            {totalCups(unassigned)}
          </span>{" "}
          杯
        </span>
      </ViewHeader>
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
          onOpenTicket={noop}
          onMoveTicket={noop}
          onReturnToUnassigned={noop}
          onCloseTicket={noop}
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
