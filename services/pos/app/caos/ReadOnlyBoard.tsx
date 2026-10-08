import { caosTimeOfDayLabel, jstDayStart } from "@cafeore/common";
import { Database, Eye } from "lucide-react";
import { useCurrentTime } from "~/components/functional/useCurrentTime";
import { ControlViewA } from "./components/ControlViewA";
import { POS_STATUS_LABEL } from "./hooks/usePosOrders";
import { useLiveCaosBoard } from "./live/useLiveCaosBoard";
import { makeLaneBaristas } from "./utils/lanes";
import { nextAvailableBays, totalCups } from "./utils/orderQueue";

// 閲覧だけの管制盤（/master-sheet/view）。盤面は操作の画面（App.tsx）と同じ useLiveCaosBoard で組み立て、
// 管制盤 A のタイムラインに流すだけ。カップへの書き込み（PUT /api/caos/cups）も「次へ」も送らない。

const noop = () => {};
// 列（1st〜6th）。閲覧だけの画面は列を変えない
const LANES = makeLaneBaristas();

export default function ReadOnlyBoard() {
  const now = useCurrentTime(1000);
  // 秒は日本時間の 0 時から数える（操作の画面と同じ）
  const dayStartMs = jstDayStart(now.getTime());
  const nowSec = Math.floor((now.getTime() - dayStartMs) / 1000);
  const { board, status } = useLiveCaosBoard({
    enabled: true,
    baristas: LANES,
    now,
    nowSec,
    dayStartMs,
  });

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
          {caosTimeOfDayLabel(nowSec)}
        </span>
        <span className="ml-auto font-bold text-slate-600 text-sm">
          未割当{" "}
          <span className="font-black font-mono text-red-600">
            {totalCups(board.unassignedOrders)}
          </span>{" "}
          杯
        </span>
        <span
          title={`cafeore-pos の盤面: ${POS_STATUS_LABEL[status]}`}
          className={`flex items-center gap-1 rounded-lg border px-2 py-1 font-black text-xs ${status === "open" ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-amber-300 bg-amber-50 text-amber-800"}`}
        >
          <Database className="h-4 w-4" />
          {POS_STATUS_LABEL[status]}
        </span>
      </header>
      <div className="min-h-0 flex-1">
        <ControlViewA
          baristas={board.baristas}
          unassignedOrders={board.unassignedOrders}
          nextAvailable={nextAvailableBays(board.baristas)}
          selectedOrderId={null}
          actionTicketKey={null}
          currentTimeSec={nowSec}
          timelineCommand={null}
          onSelectOrder={noop}
          onAdvanceBay={noop}
          onOpenTicketDetail={noop}
          onMoveTicket={noop}
          onReturnToUnassigned={noop}
          onCloseTicketAction={noop}
          onOpenEmptySlot={noop}
          onAssignToBay={noop}
          onMergeOrders={noop}
          readOnly
        />
      </div>
    </div>
  );
}
