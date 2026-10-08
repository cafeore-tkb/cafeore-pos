import { jstDayStart } from "@cafeore/common";
import { useEffect, useState } from "react";
import { AssignSlotModal } from "./components/AssignSlotModal";
import {
  AuxiliaryContent,
  AuxiliarySheet,
  type AuxiliaryTab,
  StandaloneAuxiliaryPanel,
} from "./components/AuxiliaryPanel";
import {
  type ControlViewMode,
  ControlWorkspace,
} from "./components/ControlWorkspace";
import { TestPlaySetup } from "./components/TestPlaySetup";
import { TicketDetailModal } from "./components/TicketDetailModal";
import { type NavTab, TopHeader } from "./components/TopHeader";
import { usePracticeData } from "./hooks/usePracticeData";
import { useLiveCaosBoard } from "./live/useLiveCaosBoard";
import { usePracticeBoard } from "./practice/usePracticeBoard";
import type {
  Barista,
  HistoricalOrder,
  OrderTicket,
  TestPlaySession,
  UnassignedOrder,
} from "./types";
import { soundManager } from "./utils/audio";
import { makeLaneBaristas } from "./utils/lanes";
import {
  canMergeDripUnits,
  orderNumber,
  queueWaitSeconds,
  ticketKey,
} from "./utils/orderQueue";

// 別のタブで開いたパネルに渡す、その時点の盤面と実績（実データテストの実績は練習の結果）
type PanelSnapshot = {
  baristas: Barista[];
  testPlaySession: TestPlaySession | null;
  salesOrders?: HistoricalOrder[];
};

const PANEL_SNAPSHOT_KEY = "caos-panel-snapshot-v1";

const readPanelSnapshot = (): PanelSnapshot | null => {
  try {
    const value = window.localStorage.getItem(PANEL_SNAPSHOT_KEY);
    return value ? (JSON.parse(value) as PanelSnapshot) : null;
  } catch {
    return null;
  }
};

export default function App() {
  const standaloneTab = (() => {
    const panel = new URLSearchParams(window.location.search).get("panel");
    return panel === "bays" || panel === "beans" || panel === "analytics"
      ? panel
      : null;
  })() as AuxiliaryTab | null;
  const standaloneSnapshot = standaloneTab ? readPanelSnapshot() : null;

  // Navigation
  const [activeTab, setActiveTab] = useState<NavTab>(
    standaloneTab || "control",
  );
  const [controlViewMode, setControlViewMode] =
    useState<ControlViewMode>("current");

  // Core Data
  const [baristas] = useState<Barista[]>(
    () => standaloneSnapshot?.baristas || makeLaneBaristas(),
  );

  // Filters & Toggles
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);

  // Modals
  // Panels hold only the ticket key; the ticket itself is always read from the live
  // queues so a drip that started or finished meanwhile is never acted on as stale.
  const [selectedTicketKey, setSelectedTicketKey] = useState<string | null>(
    null,
  );
  const [assignSlotData, setAssignSlotData] = useState<{
    bayId: number | null;
    order: UnassignedOrder | null;
  } | null>(null);

  const [isRunning, setIsRunning] = useState<boolean>(true);
  const [simSpeed, setSimSpeed] = useState<number>(1);
  const [timelineCommand, setTimelineCommand] = useState<{
    direction: "back" | "now" | "forward";
    id: number;
  } | null>(null);
  // 実データテストの注文。過去の注文データは同梱せず、テストプレイの画面で手元の JSON を読み込む
  // （ブラウザの中で名前とコメントを落とす。API には書かないので、本番の盤面・注文・在庫には混ざらない）。
  const practiceData = usePracticeData();
  const historicalOrders: HistoricalOrder[] =
    practiceData.dataset?.orders ?? [];
  const [testSetupOpen, setTestSetupOpen] = useState(false);
  // 実データテスト（練習）の盤面。ブラウザの中だけで動かし、サーバー・本番の盤面には何も送らない
  const practice = usePracticeBoard({
    running: isRunning,
    speed: simSpeed,
    baristas,
  });
  // 別のタブで開いたパネルは、開いたときの実データテストを出す
  const testPlaySession = standaloneTab
    ? (standaloneSnapshot?.testPlaySession ?? null)
    : practice.session;

  // Linked multi-item order selection (e.g. #152 has items in Bay 1 and Bay 2)
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [realTime, setRealTime] = useState(() => new Date());
  // 秒は日本時間の 0 時から数える（盤面の「今日」と同じ区切り）
  const [realDayStartMs] = useState(() => jstDayStart(Date.now()));
  const testPlayStatus = testPlaySession?.status;
  const testPlayCurrentMs = testPlaySession?.currentMs;
  const testPlayEndMs = testPlaySession?.endMs;
  const operationalTime = testPlaySession
    ? new Date(testPlaySession.currentMs)
    : realTime;
  // Seconds are counted from the session's first midnight so the clock keeps
  // increasing past 24:00 instead of wrapping and scrambling every queue.
  const operationalDayStartMs = testPlaySession
    ? jstDayStart(testPlaySession.startMs)
    : realDayStartMs;
  const realTimeSec = Math.floor(
    (operationalTime.getTime() - operationalDayStartMs) / 1000,
  );

  // 普段は cafeore-pos の注文で動かす（useLiveCaosBoard）。
  // 実データテスト中（終了後の実績表示も含め、リセットするまで）は cafeore-pos の注文を使わず、練習の盤面
  // （ブラウザの中の練習の注文とカップ。practice/usePracticeBoard.ts）から同じ関数でカードを組み立て、
  // 操作も同じ書き込みを練習の盤面に当てる。
  const isLive = !testPlaySession;
  const live = useLiveCaosBoard({
    enabled: isLive,
    baristas,
    now: realTime,
    nowSec: realTimeSec,
    dayStartMs: realDayStartMs,
  });
  const board = isLive ? live : practice;
  // 別のタブで開いたパネルは、開いたときの練習の盤面の列を出す（練習の盤面はもとの画面の中にしか無い）
  const boardBaristas =
    !isLive && standaloneTab ? baristas : board.board.baristas;
  const boardUnassignedOrders = board.board.unassignedOrders;

  const findLiveTicket = (key: string) => {
    for (const bay of boardBaristas) {
      const ticket =
        bay.queue.find((item) => ticketKey(item) === key) ||
        bay.pastTickets?.find((item) => ticketKey(item) === key);
      if (ticket) return ticket;
    }
    return null;
  };
  const selectedTicket = selectedTicketKey
    ? findLiveTicket(selectedTicketKey)
    : null;
  const selectedTicketStatus = selectedTicket?.status;

  // Only drips that have not started can be moved, so close the move UI once it starts.
  useEffect(() => {
    if (selectedTicketKey && selectedTicketStatus !== "scheduled")
      setSelectedTicketKey(null);
  }, [selectedTicketKey, selectedTicketStatus]);

  const sortedUnassignedOrders = [...boardUnassignedOrders].sort(
    (a, b) =>
      orderNumber(a.id) - orderNumber(b.id) ||
      (a.itemIndex || 0) - (b.itemIndex || 0),
  );

  useEffect(() => {
    const clock = window.setInterval(() => setRealTime(new Date()), 1000);
    return () => window.clearInterval(clock);
  }, []);

  useEffect(() => {
    if (
      testPlayStatus === "active" &&
      testPlayCurrentMs !== undefined &&
      testPlayEndMs !== undefined &&
      testPlayCurrentMs >= testPlayEndMs
    ) {
      setIsRunning(false);
    }
  }, [testPlayCurrentMs, testPlayEndMs, testPlayStatus]);

  const handleToggleOrderSelection = (orderId: string) => {
    if (!orderId) {
      setSelectedOrderId(null);
      return;
    }
    if (selectedOrderId === orderId) {
      setSelectedOrderId(null);
      return;
    }
    setSelectedOrderId(orderId);
  };

  const handleToggleSound = () => {
    const nextSoundEnabled = !soundEnabled;
    soundManager.enabled = nextSoundEnabled;
    setSoundEnabled(nextSoundEnabled);
  };

  // Advance / complete a bay's active order
  // 本番は API の「次へ」、実データテスト中は練習の盤面で同じ決まりの「次へ」をする（抽出中のカードを付けるのも同じ）
  const handleAdvanceBay = (bayId: number) => {
    soundManager.playComplete();

    const targetBarista = boardBaristas.find((b) => b.id === bayId);
    if (!targetBarista || targetBarista.queue.length === 0) return;

    board.next(bayId, targetBarista.queue[0]);
  };

  // 未割当のカードをドリッパーへ。beforeTicketUid があれば、その待機のカードの前へ（無ければ待機の最後へ）
  const handleAssignOrderToBay = (
    orderUidOrId: string,
    targetBayId: number,
    beforeTicketUid?: string,
  ) => {
    soundManager.playDispatch();

    const orderToAssign = boardUnassignedOrders.find(
      (o) => o.ticketUid === orderUidOrId || o.id === orderUidOrId,
    );
    if (!orderToAssign) return;
    if (
      orderToAssign.preferredBaristaId &&
      orderToAssign.preferredBaristaId !== targetBayId
    )
      return;
    board.assign(
      orderToAssign.ticketUid,
      targetBayId,
      beforeTicketUid ? { beforeTicketUid } : undefined,
    );
  };

  // 待機のカードを別のドリッパーへ。toFront なら、そのドリッパーの待機の先頭へ。beforeTicketUid があれば、その待機のカードの前へ
  // （どちらも同じドリッパーの中の順番の入れ替えにも使う）。どちらも無ければ待機の最後へ
  const handleMoveScheduledTicket = (
    ticket: OrderTicket,
    targetBayId: number,
    toFront?: boolean,
    beforeTicketUid?: string,
  ) => {
    if (ticket.status !== "scheduled") return;
    if (ticket.preferredBaristaId && ticket.preferredBaristaId !== targetBayId)
      return;
    board.assign(
      ticket.ticketUid,
      targetBayId,
      toFront ? "front" : beforeTicketUid ? { beforeTicketUid } : undefined,
    );
    setSelectedOrderId(null);
    soundManager.playDispatch();
  };

  const handleReturnScheduledTicket = (ticket: OrderTicket) => {
    if (ticket.status !== "scheduled") return;
    board.unassign(ticket.ticketUid);
    setSelectedOrderId(null);
    soundManager.playDispatch();
  };

  const handleMergeUnassignedOrders = (firstUid: string, secondUid: string) => {
    const first = boardUnassignedOrders.find(
      (order) => (order.ticketUid || order.id) === firstUid,
    );
    const second = boardUnassignedOrders.find(
      (order) => (order.ticketUid || order.id) === secondUid,
    );
    if (!first || !second || !canMergeDripUnits(first, second)) return;
    board.merge(firstUid, secondUid);
    setSelectedOrderId(null);
  };

  // リセット：実データテストをやめて cafeore-pos の盤面に戻る（練習の盤面は捨てる。本番のカップは触らない）
  const handleResetData = () => {
    setSelectedOrderId(null);
    setSelectedTicketKey(null);
    setAssignSlotData(null);
    practice.reset();
    setIsRunning(true);
    soundManager.playDispatch();
  };

  const handleStartTestPlay = (startMs: number, durationMinutes: 30 | 60) => {
    setSelectedOrderId(null);
    setSelectedTicketKey(null);
    setAssignSlotData(null);
    practice.start(historicalOrders, startMs, durationMinutes);
    setIsRunning(true);
    setActiveTab("control");
    setTestSetupOpen(false);
  };

  const handleEndTestPlay = () => {
    practice.finish();
    setIsRunning(false);
    setActiveTab("analytics");
  };

  // Live cup totals shown in the header
  const unassignedCardCups = boardUnassignedOrders.reduce(
    (acc, cur) => acc + cur.cupCount,
    0,
  );
  const totalUnassignedDisplay = unassignedCardCups;

  const currentBayQueueCups = boardBaristas.reduce(
    (acc, b) => acc + b.queue.reduce((qAcc, t) => qAcc + t.cupCount, 0),
    0,
  );
  const totalWaitingCupsDisplay = currentBayQueueCups;
  const nextAvailable = [...boardBaristas]
    .map((barista) => ({
      bayNumber: barista.bayNumber,
      seconds: queueWaitSeconds(barista.queue),
      isStandby: barista.queue.length === 0,
    }))
    .sort((a, b) => a.seconds - b.seconds || a.bayNumber - b.bayNumber)
    .slice(0, 3);

  const openAuxiliaryTab = (tab: AuxiliaryTab) => {
    try {
      window.localStorage.setItem(
        PANEL_SNAPSHOT_KEY,
        JSON.stringify({
          baristas: boardBaristas,
          testPlaySession,
          salesOrders: practice.salesOrders,
        } satisfies PanelSnapshot),
      );
    } catch {
      // Opening the panel still works with its default state if storage is unavailable.
    }
    const url = new URL(window.location.href);
    url.searchParams.set("panel", tab);
    window.open(url.toString(), "_blank", "noopener,noreferrer");
  };

  const renderAuxiliaryView = (tab: AuxiliaryTab) => (
    <AuxiliaryContent
      tab={tab}
      baristas={boardBaristas}
      salesOrders={
        standaloneTab
          ? (standaloneSnapshot?.salesOrders ?? [])
          : practice.salesOrders
      }
      periodStartMs={testPlaySession?.startMs}
      periodEndMs={
        testPlaySession
          ? Math.min(testPlaySession.currentMs, testPlaySession.endMs)
          : undefined
      }
    />
  );

  if (standaloneTab) {
    return (
      <StandaloneAuxiliaryPanel tab={standaloneTab}>
        {renderAuxiliaryView(standaloneTab)}
      </StandaloneAuxiliaryPanel>
    );
  }

  return (
    <div className="flex h-screen w-screen select-none overflow-hidden bg-[#f0f4fa] font-sans text-[#0f172a]">
      {/* Main Workstation Area */}
      <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Top Header */}
        <TopHeader
          activeTab={activeTab}
          controlViewMode={controlViewMode}
          onSelectTab={setActiveTab}
          onSelectControlViewMode={setControlViewMode}
          timeStr={`${operationalTime.getHours().toString().padStart(2, "0")}:${operationalTime.getMinutes().toString().padStart(2, "0")}:${operationalTime.getSeconds().toString().padStart(2, "0")}`}
          unassignedCups={totalUnassignedDisplay}
          totalWaitingCups={totalWaitingCupsDisplay}
          soundEnabled={soundEnabled}
          onToggleSound={handleToggleSound}
          isRunning={isRunning}
          onTogglePlay={() => setIsRunning(!isRunning)}
          simSpeed={simSpeed}
          onChangeSpeed={setSimSpeed}
          onResetData={handleResetData}
          showTimelineControls={controlViewMode === "current"}
          onTimelineNavigate={(direction) =>
            setTimelineCommand({ direction, id: Date.now() })
          }
          testPlaying={testPlaySession?.status === "active"}
          testProgressLabel={
            testPlaySession
              ? `${Math.max(0, Math.ceil((testPlaySession.endMs - testPlaySession.currentMs) / 60_000))}分`
              : null
          }
          onOpenTestPlay={() => setTestSetupOpen(true)}
          onEndTestPlay={handleEndTestPlay}
          posStatus={live.status}
        />

        {/* Dynamic Tab Body */}
        <main className="flex flex-1 flex-col gap-2 overflow-hidden p-2">
          <ControlWorkspace
            mode={controlViewMode}
            baristas={boardBaristas}
            unassignedOrders={sortedUnassignedOrders}
            nextAvailable={nextAvailable}
            selectedOrderId={selectedOrderId}
            actionTicketKey={selectedTicket ? selectedTicketKey : null}
            currentTimeSec={realTimeSec}
            timelineCommand={timelineCommand}
            onSelectOrder={handleToggleOrderSelection}
            onAdvanceBay={handleAdvanceBay}
            onOpenTicketDetail={(ticket) =>
              setSelectedTicketKey(ticketKey(ticket))
            }
            onMoveTicket={handleMoveScheduledTicket}
            onReturnToUnassigned={handleReturnScheduledTicket}
            onCloseTicketAction={() => setSelectedTicketKey(null)}
            onOpenEmptySlot={(bayId) =>
              setAssignSlotData({ bayId, order: null })
            }
            onAssignToBay={(order, bayId, beforeTicketUid) =>
              handleAssignOrderToBay(
                order.ticketUid || order.id,
                bayId,
                beforeTicketUid,
              )
            }
            onMergeOrders={handleMergeUnassignedOrders}
          />
        </main>

        {activeTab !== "control" && (
          <AuxiliarySheet
            tab={activeTab}
            onOpenInNewTab={() => openAuxiliaryTab(activeTab)}
            onClose={() => setActiveTab("control")}
          >
            {renderAuxiliaryView(activeTab)}
          </AuxiliarySheet>
        )}
      </div>

      {/* Ticket Detail Recipe Modal */}
      {selectedTicket && controlViewMode !== "current" && (
        <TicketDetailModal
          ticket={selectedTicket}
          currentBayId={
            boardBaristas.find((bay) =>
              bay.queue.some(
                (ticket) => ticketKey(ticket) === selectedTicketKey,
              ),
            )?.id || null
          }
          onClose={() => {
            setSelectedTicketKey(null);
            setSelectedOrderId(null);
          }}
          onMoveTicket={handleMoveScheduledTicket}
          onReturnToUnassigned={handleReturnScheduledTicket}
        />
      )}

      {/* Assign Slot Modal */}
      {assignSlotData && (
        <AssignSlotModal
          bayId={assignSlotData.bayId}
          targetOrder={assignSlotData.order}
          baristas={boardBaristas}
          unassignedOrders={sortedUnassignedOrders}
          onClose={() => setAssignSlotData(null)}
          onAssign={handleAssignOrderToBay}
        />
      )}

      {board.error && (
        <div
          role="alert"
          className="-translate-x-1/2 fixed bottom-4 left-1/2 z-50 max-w-[calc(100vw-32px)] rounded-lg bg-red-700 px-4 py-3 font-bold text-sm text-white shadow-lg"
        >
          {board.error}
        </div>
      )}

      {testSetupOpen && (
        <TestPlaySetup
          dataset={practiceData.dataset}
          loading={practiceData.loading}
          problems={practiceData.problems}
          onSelectFiles={(files) => void practiceData.readFiles(files)}
          onClearData={practiceData.clear}
          onClose={() => setTestSetupOpen(false)}
          onStart={handleStartTestPlay}
        />
      )}
    </div>
  );
}
