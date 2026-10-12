import { useColorSettings } from "@cafeore/common";
import { useMemo } from "react";
import { useSearchParams } from "react-router";
import { useCurrentTime } from "~/components/functional/useCurrentTime";
import { LiberoRow } from "./components/LiberoRow";
import { ViewHeader } from "./components/ViewHeader";
import { useLiveBoard } from "./hooks/useLiveBoard";
import { cardColor } from "./logic/cards";
import { boardLanes } from "./logic/lanes";
import { byElapsed, liberoLanes } from "./logic/libero";

// リベロビュー（/master-sheet/libero）。リベロ（ドリッパーにお湯を持って回る係）が見る、閲覧だけの画面。
// 閲覧の画面（ReadOnlyBoard）と同じ cafeore-pos の盤面（useLiveBoard）を読むだけで、書き込みは送らない。未割当は出さない。
// 1st〜6th の抽出中のカードの、入れ始めてからの時間と経過の長い順の順位を大きく出し、次にお湯を持っていく人が一目で分かるようにする。
// 並びは 1st〜6th のまま（ドリッパーの並びと同じ）か、経過の長い順（?order=elapsed）。

const ORDERS = [
  { id: null, label: "ドリッパー順" },
  { id: "elapsed", label: "経過の長い順" },
] as const;

export default function LiberoBoard() {
  const nowMs = useCurrentTime(1000).getTime();
  const { cards, status } = useLiveBoard({ enabled: true, nowMs });
  const { colorSettings } = useColorSettings();
  const [params, setParams] = useSearchParams();
  const order = params.get("order");
  const lanes = useMemo(() => boardLanes(cards), [cards]);
  const rows = liberoLanes(lanes, nowMs);

  return (
    <div className="flex h-screen w-screen select-none flex-col gap-2 overflow-hidden bg-[#f0f4fa] p-2 font-sans text-[#0f172a]">
      <ViewHeader nowMs={nowMs} status={status}>
        <fieldset
          aria-label="並び"
          className="ml-auto flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 font-bold text-slate-600 text-xs"
        >
          {ORDERS.map(({ id, label }) => (
            <button
              key={label}
              type="button"
              aria-pressed={order === id}
              onClick={() =>
                setParams(id ? { order: id } : {}, { replace: true })
              }
              className={`rounded-md px-2.5 py-1.5 ${order === id ? "bg-slate-900 text-white" : "bg-white hover:bg-slate-100"}`}
            >
              {label}
            </button>
          ))}
        </fieldset>
      </ViewHeader>
      <div className="grid min-h-0 flex-1 grid-rows-6 gap-2">
        {(order === "elapsed" ? byElapsed(rows) : rows).map((row) => (
          <LiberoRow
            key={row.lane.id}
            row={row}
            color={row.brew && cardColor(row.brew.card, colorSettings)}
          />
        ))}
      </div>
    </div>
  );
}
