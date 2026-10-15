import { useColorSettings } from "@cafeore/common";
import { useMemo } from "react";
import { useCurrentTime } from "~/components/functional/useCurrentTime";
import { OrderCountLabel } from "./components/BoardParts";
import { ControlViewA } from "./components/ControlViewA";
import { ViewHeader } from "./components/ViewHeader";
import { useBeanInventory } from "./hooks/useBeanInventory";
import { useDeviceSetting } from "./hooks/useDeviceSetting";
import { useViewBoard } from "./hooks/useViewBoard";
import { cardLooks } from "./logic/cards";
import { boardLanes } from "./logic/lanes";
import { nextAvailableBays } from "./logic/queue";

// 閲覧だけの管制盤（/master-sheet/view）。操作の画面（App.tsx）と同じ cafeore-pos の盤面（useLiveBoard）を、
// 管制盤 A のタイムラインに映すだけ（終わったカードは出さず、抽出中・待機だけ）。カップへの書き込み（PUT /api/caos/cups）も「次へ」も送らない。
// タイムラインに新しく入ったカードは、通知音（ヘッダーで切り替え）とそのカードの点滅で知らせる。未割当の横帯はたためる（この端末に覚える）。

const noop = () => {};

export default function ReadOnlyBoard() {
  const nowMs = useCurrentTime(1000).getTime();
  const { cards, status, sound, flashKeys } = useViewBoard(nowMs);
  const [folded, setFolded] = useDeviceSetting(
    "caos-view-unassigned-folded",
    false,
  );
  const { colorSettings } = useColorSettings();
  const { beanIndex } = useBeanInventory();
  const lanes = useMemo(
    () => boardLanes(cards.filter((card) => card.status !== "done")),
    [cards],
  );
  const unassigned = useMemo(
    () => cards.filter((card) => card.status === "unassigned"),
    [cards],
  );
  const looks = useMemo(
    () => cardLooks(cards, colorSettings, beanIndex),
    [cards, colorSettings, beanIndex],
  );

  return (
    <div className="flex h-dvh w-screen select-none flex-col gap-2 overflow-hidden bg-[#f0f4fa] p-2 font-sans text-[#0f172a]">
      <ViewHeader nowMs={nowMs} status={status} sound={sound}>
        <span className="ml-auto font-bold text-slate-600 text-sm">
          未割当{" "}
          <span className="font-black font-mono text-red-600">
            <OrderCountLabel cards={unassigned} />
          </span>
        </span>
      </ViewHeader>
      <div className="min-h-0 flex-1">
        <ControlViewA
          lanes={lanes}
          unassignedOrders={unassigned}
          looks={looks}
          nextAvailable={nextAvailableBays(lanes, nowMs)}
          selectedOrderId={null}
          nowMs={nowMs}
          timelineCommand={null}
          onSelectOrder={noop}
          onAdvanceBay={noop}
          onPressCard={noop}
          onMoveTicket={noop}
          onReturnToUnassigned={noop}
          onOpenEmptySlot={noop}
          onAssignToBay={noop}
          onMergeOrders={noop}
          onSplitCup={noop}
          readOnly
          flashKeys={flashKeys}
          unassignedFold={{ folded, toggle: () => setFolded(!folded) }}
        />
      </div>
    </div>
  );
}
