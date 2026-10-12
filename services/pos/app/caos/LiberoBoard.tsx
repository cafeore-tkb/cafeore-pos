import { useColorSettings } from "@cafeore/common";
import { useMemo } from "react";
import { useSearchParams } from "react-router";
import { useCurrentTime } from "~/components/functional/useCurrentTime";
import { LiberoRow } from "./components/LiberoRow";
import { SEGMENTS, ViewHeader, segmentClass } from "./components/ViewHeader";
import { useHandedWater } from "./hooks/useHandedWater";
import { useLiveBoard } from "./hooks/useLiveBoard";
import { useTimelineArrivals } from "./hooks/useTimelineArrivals";
import { useViewSound } from "./hooks/useViewSound";
import { cardColor } from "./logic/cards";
import { boardLanes, laneActive } from "./logic/lanes";
import { type LiberoLane, byElapsed, liberoLanes } from "./logic/libero";

// リベロビュー（/master-sheet/libero）。リベロ（ドリッパーにお湯を持って回る係）が見る、閲覧だけの画面。
// 閲覧の画面（ReadOnlyBoard）と同じ cafeore-pos の盤面（useLiveBoard）を読むだけで、書き込みは送らない。未割当は出さない。
// 1st〜6th の抽出中のカードの、入れ始めてからの時間と経過の長い順の順位を大きく出し、次にお湯を持っていく人が一目で分かるようにする。
// 並びは 1st〜6th のまま（ドリッパーの並びと同じ）か、経過の長い順（?order=elapsed）。
// タイムラインに新しく入ったカード（割り当てた・抽出を始めた）は、通知音（ヘッダーで切り替え）とそのドリッパーの行の点滅で知らせる。
// お湯を渡したら抽出中の行を押して灰色にする（この端末だけの印。抽出が替わったら外れる。もう一度押すと戻す）。

// 並び（URL の ?order= の値。無い・知らない値ならドリッパー順）
const ORDERS = [
  { id: null, label: "ドリッパー順", arrange: (rows: LiberoLane[]) => rows },
  { id: "elapsed", label: "経過の長い順", arrange: byElapsed },
] as const;

export default function LiberoBoard() {
  const nowMs = useCurrentTime(1000).getTime();
  const { cards, orders, status } = useLiveBoard({ enabled: true, nowMs });
  const sound = useViewSound();
  const flashKeys = useTimelineArrivals(cards, orders !== null, nowMs);
  const water = useHandedWater();
  const { colorSettings } = useColorSettings();
  const [params, setParams] = useSearchParams();
  const order =
    ORDERS.find(({ id }) => id === params.get("order")) ?? ORDERS[0];
  const lanes = useMemo(() => boardLanes(cards), [cards]);
  const rows = liberoLanes(lanes, nowMs);

  return (
    <div className="flex h-screen w-screen select-none flex-col gap-2 overflow-hidden bg-[#f0f4fa] p-2 font-sans text-[#0f172a]">
      <ViewHeader nowMs={nowMs} status={status} sound={sound}>
        <fieldset aria-label="並び" className={`ml-auto ${SEGMENTS}`}>
          {ORDERS.map(({ id, label }) => (
            <button
              key={label}
              type="button"
              aria-pressed={order.id === id}
              onClick={() =>
                setParams(id ? { order: id } : {}, { replace: true })
              }
              className={segmentClass(order.id === id)}
            >
              {label}
            </button>
          ))}
        </fieldset>
      </ViewHeader>
      <div className="grid min-h-0 flex-1 grid-rows-6 gap-2">
        {order.arrange(rows).map((row) => (
          <LiberoRow
            key={row.lane.id}
            row={row}
            color={row.brew && cardColor(row.brew.card, colorSettings)}
            flashing={laneActive(row.lane).some((card) =>
              flashKeys.has(card.key),
            )}
            handed={water.handed(row.lane)}
            onToggleHanded={() => water.toggle(row.lane)}
          />
        ))}
      </div>
    </div>
  );
}
