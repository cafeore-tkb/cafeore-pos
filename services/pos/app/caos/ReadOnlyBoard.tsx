import {
  buildCaosCards,
  caosDay,
  formatClockOfDay,
  startOfJstDay,
  useColorSettings,
} from "@cafeore/common";
import { Database, Eye } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ControlViewA } from "./components/ControlViewA";
import { useBeanInventory } from "./hooks/useBeanInventory";
import { type PosConnectionStatus, usePosOrders } from "./hooks/usePosOrders";
import { LaneHeaderStatus } from "./lanes/LaneHeaderStatus";
import { cardsToBoard } from "./live/board";
import { makeLaneBaristas } from "./utils/lanes";
import { queueWaitSeconds } from "./utils/orderQueue";

// 閲覧だけの管制盤（/master-sheet/view）。注文を POS の共有の WebSocket で受け取り、今日（日本時間）のカードを
// 組み立てて管制盤 A のタイムラインに流すだけで、カップへの書き込み（PUT /api/caos/cups）も「次へ」も送らない。
// カードを触っても何も起きない。
// 盤面の組み立て（注文の一覧からのカード・日本時間の当日の起点・予定時刻・カードの色・豆）は操作の画面（App.tsx）と同じものを使う。

const STATUS_LABEL: Record<PosConnectionStatus, string> = {
  off: "未接続",
  connecting: "接続中",
  open: "接続済み",
  reconnecting: "再接続中",
};

const noop = () => {};

export default function ReadOnlyBoard() {
  const [now, setNow] = useState(() => new Date());
  // 盤面の秒の起点。サーバーの営業日と同じく日本時間の 0:00（端末の時刻帯によらない）
  const [dayStartMs] = useState(() => startOfJstDay(Date.now()));
  // 列（1st〜6th）。操作の画面と同じ並び
  const [baristas] = useState(makeLaneBaristas);

  useEffect(() => {
    const clock = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(clock);
  }, []);

  const { orders, status } = usePosOrders(true);
  const today = caosDay(now);
  const cards = useMemo(
    () => buildCaosCards(orders ?? [], today),
    [orders, today],
  );
  // カードの色をマスターの画面と同じにするための色の設定
  const { colorSettings } = useColorSettings();
  // カードの豆（POS の在庫の「商品 → 豆」。操作の画面と同じ）
  const { beanIndex } = useBeanInventory();
  const nowSec = Math.floor((now.getTime() - dayStartMs) / 1000);
  const board = useMemo(
    () =>
      cardsToBoard(
        cards,
        baristas,
        nowSec,
        dayStartMs,
        colorSettings,
        beanIndex,
      ),
    [cards, baristas, nowSec, dayStartMs, colorSettings, beanIndex],
  );
  const nextAvailable = [...board.baristas]
    .map((barista) => ({
      bayNumber: barista.bayNumber,
      seconds: queueWaitSeconds(barista.queue),
      isStandby: barista.queue.length === 0,
    }))
    .sort((a, b) => a.seconds - b.seconds || a.bayNumber - b.bayNumber)
    .slice(0, 3);
  const unassignedCups = board.unassignedOrders.reduce(
    (sum, order) => sum + order.cupCount,
    0,
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
        {/* 時計は日本時間（操作の画面と同じく、日本時間の 0:00 からの秒で出す） */}
        <span className="font-black font-mono text-3xl tabular-nums">
          {formatClockOfDay(nowSec)}
        </span>
        <span className="ml-auto font-bold text-slate-600 text-sm">
          未割当{" "}
          <span className="font-black font-mono text-red-600">
            {unassignedCups}
          </span>{" "}
          杯
        </span>
        {/* 上級生のドリッパーが無いときの知らせ（担当者は表示だけ） */}
        <LaneHeaderStatus />
        <span
          title={`cafeore-pos の盤面: ${STATUS_LABEL[status]}`}
          className={`flex items-center gap-1 rounded-lg border px-2 py-1 font-black text-xs ${status === "open" ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-amber-300 bg-amber-50 text-amber-800"}`}
        >
          <Database className="h-4 w-4" />
          {STATUS_LABEL[status]}
        </span>
      </header>
      <div className="min-h-0 flex-1">
        <ControlViewA
          baristas={board.baristas}
          unassignedOrders={board.unassignedOrders}
          nextAvailable={nextAvailable}
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
