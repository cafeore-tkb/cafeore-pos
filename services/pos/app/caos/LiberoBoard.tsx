import { useMemo } from "react";
import { useCurrentTime } from "~/components/functional/useCurrentTime";
import { LiberoColumn } from "./components/LiberoColumn";
import { ViewHeader } from "./components/ViewHeader";
import { useViewBoard } from "./hooks/useViewBoard";
import { boardLanes } from "./logic/lanes";
import { liberoLanes } from "./logic/libero";
import { nextIntensities } from "./logic/libero-colors";
import { brewStarts } from "./logic/timeline";

// リベロ用の閲覧画面。実際のドリッパーの並びに合わせ、右端から1〜6で固定する。
export default function LiberoBoard() {
  const nowMs = useCurrentTime(1000).getTime();
  const { cards, sound, flashKeys } = useViewBoard(nowMs, brewStarts);
  const lanes = useMemo(() => boardLanes(cards), [cards]);
  const rows = liberoLanes(lanes, nowMs);
  const priorities = nextIntensities(rows);

  return (
    <div className="flex h-[calc(100dvh-var(--pos-status-height,0px))] w-screen select-none flex-col gap-2 overflow-hidden bg-[#f0f4fa] p-2 font-sans text-[#0f172a]">
      <ViewHeader nowMs={nowMs} sound={sound} />
      <div
        className="grid min-h-0 flex-1 grid-cols-6 gap-1.5"
        aria-label="左から6、5、4、3、2、1のドリッパー"
      >
        {[...rows].reverse().map((row) => {
          const next = row.lane.queued[0];
          return (
            <LiberoColumn
              key={row.lane.id}
              row={row}
              nextIntensity={next ? priorities.get(next.key) : undefined}
              flashing={
                row.brew !== undefined && flashKeys.has(row.brew.card.key)
              }
            />
          );
        })}
      </div>
    </div>
  );
}
