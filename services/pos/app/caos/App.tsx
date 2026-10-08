import {
  type CaosLane,
  type CaosWritesResult,
  assignWrites,
  buildCaosCards,
  caosDay,
  formatClockOfDay,
  mergeWrites,
  nextCaosDripper,
  putCaosCups,
  seniorOnlyBlock,
  startOfJstDay,
  unassignWrites,
  useColorSettings,
} from "@cafeore/common";
import { useEffect, useMemo, useRef, useState } from "react";
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
import { useBeanInventory } from "./hooks/useBeanInventory";
import { usePosOrders } from "./hooks/usePosOrders";
import { PracticeLanesScope, useCaosLanes } from "./lanes/CaosLanesContext";
import { cardsToBoard } from "./live/board";
import {
  type PracticeStart,
  usePracticeBoard,
} from "./practice/usePracticeBoard";
import type {
  Barista,
  OrderTicket,
  PracticeSalesOrder,
  UnassignedOrder,
} from "./types";
import { soundManager } from "./utils/audio";
import { makeLaneBaristas } from "./utils/lanes";
import { canMergeDripUnits, queueWaitSeconds } from "./utils/orderQueue";

// 別のタブで開いたパネルに渡す、その時点の盤面と実績（実データテストの実績は練習の結果）。
// 練習中は練習の担当者（始めたときの本番の担当者の写し）も渡す
type PanelSnapshot = {
  baristas: Barista[];
  lanes?: CaosLane[];
  analytics: {
    salesOrders: PracticeSalesOrder[];
    periodStartMs?: number;
    periodEndMs?: number;
  } | null;
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
  const [testSetupOpen, setTestSetupOpen] = useState(false);
  // 実データテスト（練習）の盤面。ブラウザの中だけで動かし、サーバー・本番の盤面には何も送らない
  const practice = usePracticeBoard({ running: isRunning, speed: simSpeed });
  const testPlaySession = practice.session;

  // Linked multi-item order selection (e.g. #152 has items in Bay 1 and Bay 2)
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [realTime, setRealTime] = useState(() => new Date());
  // 盤面の秒の起点。サーバーの営業日と同じく日本時間の 0:00（端末の時刻帯によらない）
  const [realDayStartMs] = useState(() => startOfJstDay(Date.now()));
  const testPlayStatus = testPlaySession?.status;
  const testPlayCurrentMs = testPlaySession?.currentMs;
  const testPlayEndMs = testPlaySession?.endMs;
  // 練習中は練習の時計と、練習の日（日本時間）の 0:00 を起点にする
  const operationalTime = testPlaySession
    ? new Date(testPlaySession.currentMs)
    : realTime;
  const operationalDayStartMs = practice.dayStartMs ?? realDayStartMs;
  const realTimeSec = Math.floor(
    (operationalTime.getTime() - operationalDayStartMs) / 1000,
  );

  // 普段は cafeore-pos の注文で動かす。盤面は注文のカップの列（ドリッパー・順番・カード・抽出の時刻）で持つので、
  // 共有の WebSocket の注文から今日（日本時間）のカードを組み立てる。操作はカップに書く（PUT /api/caos/cups・「次へ」）。
  // 書いた注文は全部の画面に配られるので、複数の iPad で同じものを見て操作できる。
  // 実データテスト中（終了後の実績表示も含め、リセットするまで）は cafeore-pos の注文を使わず、練習の盤面（ブラウザの中の
  // 練習の注文とカップ）から同じ関数でカードを組み立て、操作も同じ書き込みを練習の盤面に当てる（practice/usePracticeBoard.ts）。
  const live = !testPlaySession;
  const { orders: posOrders, status: posStatus } = usePosOrders(live);
  const today = practice.day ?? caosDay(realTime);
  const boardOrders = live ? posOrders : practice.orders;
  const liveCards = useMemo(
    () => buildCaosCards(boardOrders ?? [], today),
    [boardOrders, today],
  );
  // カードの色をマスターの画面と同じにするための色の設定（POS の色の設定の API。読むだけ）
  const { colorSettings } = useColorSettings();
  // 豆の在庫と「商品 → 豆」は POS の在庫（API）をそのまま使う。CaOS では在庫を持たず、減らしもしない
  const {
    beanStatuses,
    beanIndex,
    error: beanError,
    isLoading: beanLoading,
  } = useBeanInventory();
  // カードから組み立てた管制盤。列（1st〜6th）は手元の baristas から取る
  const liveBoard = useMemo(
    () =>
      cardsToBoard(
        liveCards,
        baristas,
        realTimeSec,
        operationalDayStartMs,
        colorSettings,
        beanIndex,
      ),
    [
      liveCards,
      baristas,
      realTimeSec,
      operationalDayStartMs,
      colorSettings,
      beanIndex,
    ],
  );
  const boardBaristas = liveBoard.baristas;
  const boardUnassignedOrders = liveBoard.unassignedOrders;
  // ドリッパーの担当者。限定のカードは上級生のドリッパーにしか置けない（サーバーも確かめる）。
  // 練習中は、始めたときの本番の担当者の写し（練習の盤面も同じ決まりで確かめる。交代はできない）
  const { lanes: liveLanes } = useCaosLanes();
  const lanes = testPlaySession?.lanes ?? liveLanes;
  // 「次へ」を送っている途中の列（応答が届く前の二度押しを止める）
  const pendingNextRef = useRef(new Set<number>());
  const [liveError, setLiveError] = useState<string | null>(null);

  useEffect(() => {
    if (!liveError) return;
    const timer = window.setTimeout(() => setLiveError(null), 5000);
    return () => window.clearTimeout(timer);
  }, [liveError]);

  // カップへの書き込みを送る。断られたら（決まりに合わない・ほかの端末が先に書いた）理由を出す。
  // 結果は書いた注文の配信で届く。豆の在庫は POS の在庫（注文から数える）なので、ここでは減らさない。
  // 練習中はサーバーに送らず、練習の盤面に同じ決まりで当てる
  const runWrites = async (result: CaosWritesResult) => {
    if ("error" in result) {
      setLiveError(result.error);
      return;
    }
    if (!live) {
      const error = practice.apply(result.writes);
      if (error) setLiveError(error);
      return;
    }
    const { error } = await putCaosCups(result.writes);
    if (error) setLiveError(error);
  };
  // 画面のカード（ticketUid）から、組み立てたカードを引く
  const liveCard = (ticketUid: string) => liveBoard.cards.get(ticketUid);
  const newDripId = () => crypto.randomUUID();

  const findLiveTicket = (key: string) => {
    for (const bay of boardBaristas) {
      const ticket =
        bay.queue.find((item) => item.ticketUid === key) ||
        bay.pastTickets?.find((item) => item.ticketUid === key);
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
  const handleAdvanceBay = (bayId: number) => {
    soundManager.playComplete();

    const targetBarista = boardBaristas.find((b) => b.id === bayId);
    if (!targetBarista || targetBarista.queue.length === 0) return;

    if (live) {
      if (pendingNextRef.current.has(bayId)) return;
      // 抽出中のカードを付けて送る（二度押しやほかの端末と同時に押したときは、サーバーが断る）。
      // 抽出中が無ければ（マスターで準備完了にして終わった、など）待機の先頭を始める
      const current = targetBarista.queue[0];
      const card =
        current.status === "brewing" ? liveCard(current.ticketUid) : undefined;
      pendingNextRef.current.add(bayId);
      void nextCaosDripper(bayId, card?.dripId ?? null)
        .then(({ error }) => {
          if (error) setLiveError(error);
        })
        .finally(() => pendingNextRef.current.delete(bayId));
      return;
    }

    // 練習中は、練習の盤面でサーバーと同じ決まりの「次へ」をする（抽出中のカードを付けるのも同じ）
    const current = targetBarista.queue[0];
    const card =
      current.status === "brewing" ? liveCard(current.ticketUid) : undefined;
    const error = practice.next(bayId, card?.dripId ?? null);
    if (error) setLiveError(error);
  };

  // Assign order to a bay
  const handleAssignOrderToBay = (orderUid: string, targetBayId: number) => {
    soundManager.playDispatch();

    const orderToAssign = boardUnassignedOrders.find(
      (o) => o.ticketUid === orderUid,
    );
    if (!orderToAssign) return;
    if (
      orderToAssign.preferredBaristaId &&
      orderToAssign.preferredBaristaId !== targetBayId
    )
      return;
    const card = liveCard(orderToAssign.ticketUid);
    if (!card) return;
    const blocked = seniorOnlyBlock(card, targetBayId, lanes);
    if (blocked) {
      setLiveError(blocked);
      return;
    }
    void runWrites(
      assignWrites(liveCards, card, targetBayId, { newId: newDripId }),
    );
  };

  // 待機のカードを別のドリッパーへ。toFront なら、そのドリッパーの待機の先頭へ（同じドリッパーの中の順番の入れ替えにも使う）
  const handleMoveScheduledTicket = (
    ticket: OrderTicket,
    targetBayId: number,
    toFront?: boolean,
  ) => {
    if (ticket.status !== "scheduled") return;
    if (ticket.preferredBaristaId && ticket.preferredBaristaId !== targetBayId)
      return;
    const card = liveCard(ticket.ticketUid);
    if (!card) return;
    const blocked = seniorOnlyBlock(card, targetBayId, lanes);
    if (blocked) {
      setLiveError(blocked);
      return;
    }
    void runWrites(
      assignWrites(liveCards, card, targetBayId, {
        index: toFront ? 0 : undefined,
        newId: newDripId,
      }),
    );
    setSelectedOrderId(null);
    soundManager.playDispatch();
  };

  const handleReturnScheduledTicket = (ticket: OrderTicket) => {
    if (ticket.status !== "scheduled") return;
    const card = liveCard(ticket.ticketUid);
    if (!card) return;
    void runWrites(unassignWrites(card));
    setSelectedOrderId(null);
    soundManager.playDispatch();
  };

  const handleMergeUnassignedOrders = (firstUid: string, secondUid: string) => {
    const first = boardUnassignedOrders.find(
      (order) => order.ticketUid === firstUid,
    );
    const second = boardUnassignedOrders.find(
      (order) => order.ticketUid === secondUid,
    );
    if (!first || !second || !canMergeDripUnits(first, second)) return;
    const card = liveCard(firstUid);
    const withCard = liveCard(secondUid);
    if (!card || !withCard) return;
    void runWrites(mergeWrites(card, withCard, newDripId));
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

  const handleStartTestPlay = (start: PracticeStart) => {
    setSelectedOrderId(null);
    setSelectedTicketKey(null);
    setAssignSlotData(null);
    // 練習の担当者は、始めたときの本番の担当者の写し
    practice.start(start, liveLanes);
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

  // 盤面にある（未割当・待機・抽出中の）杯数（豆＝在庫対象の ID ごと）。豆のパネルに出す。実データテスト中は出さない
  const beanWaitingCups = useMemo(() => {
    if (!live) return undefined;
    const cups = new Map<string, number>();
    const waiting = [
      ...boardUnassignedOrders,
      ...boardBaristas.flatMap((barista) => barista.queue),
    ];
    for (const card of waiting) {
      for (const bean of card.beans ?? []) {
        cups.set(bean.id, (cups.get(bean.id) ?? 0) + card.cupCount);
      }
    }
    for (const status of beanStatuses) {
      if (!cups.has(status.resource.id)) cups.set(status.resource.id, 0);
    }
    return cups;
  }, [live, boardUnassignedOrders, boardBaristas, beanStatuses]);

  // 実績（実データテストの練習の結果）。届いた注文だけ
  const analytics: PanelSnapshot["analytics"] = {
    salesOrders: practice.salesOrders,
    periodStartMs: testPlaySession?.startMs,
    periodEndMs: testPlaySession
      ? Math.min(testPlaySession.currentMs, testPlaySession.endMs)
      : undefined,
  };

  const openAuxiliaryTab = (tab: AuxiliaryTab) => {
    try {
      window.localStorage.setItem(
        PANEL_SNAPSHOT_KEY,
        JSON.stringify({
          baristas: boardBaristas,
          lanes: testPlaySession?.lanes,
          analytics: testPlaySession ? analytics : null,
        } satisfies PanelSnapshot),
      );
    } catch {
      // Opening the panel still works with its default state if storage is unavailable.
    }
    const url = new URL(window.location.href);
    url.searchParams.set("panel", tab);
    window.open(url.toString(), "_blank", "noopener,noreferrer");
  };

  const renderAuxiliaryView = (tab: AuxiliaryTab) => {
    // 別のタブで開いたパネルは、開いたときの実績を出す（練習の盤面はその画面の中にしか無いので、列も開いたときのもの）
    const shown = standaloneTab ? standaloneSnapshot?.analytics : analytics;
    return (
      <AuxiliaryContent
        tab={tab}
        baristas={
          standaloneTab && standaloneSnapshot?.analytics
            ? standaloneSnapshot.baristas
            : boardBaristas
        }
        beanInventory={{
          statuses: beanStatuses,
          isLoading: beanLoading,
          error: beanError,
        }}
        beanWaitingCups={beanWaitingCups}
        salesOrders={shown?.salesOrders ?? []}
        periodStartMs={shown?.periodStartMs}
        periodEndMs={shown?.periodEndMs}
      />
    );
  };

  if (standaloneTab) {
    return (
      <PracticeLanesScope
        lanes={
          standaloneSnapshot?.analytics
            ? (standaloneSnapshot.lanes ?? null)
            : null
        }
      >
        <StandaloneAuxiliaryPanel tab={standaloneTab}>
          {renderAuxiliaryView(standaloneTab)}
        </StandaloneAuxiliaryPanel>
      </PracticeLanesScope>
    );
  }

  // 練習中は、見出し・ヘッダーの担当者を練習の担当者（写し）にし、交代は出さない
  return (
    <PracticeLanesScope lanes={testPlaySession?.lanes ?? null}>
      <div className="flex h-screen w-screen select-none overflow-hidden bg-[#f0f4fa] font-sans text-[#0f172a]">
        {/* Main Workstation Area */}
        <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
          {/* Top Header */}
          <TopHeader
            activeTab={activeTab}
            controlViewMode={controlViewMode}
            onSelectTab={setActiveTab}
            onSelectControlViewMode={setControlViewMode}
            timeStr={formatClockOfDay(realTimeSec)}
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
            posStatus={posStatus}
          />

          {/* Dynamic Tab Body */}
          <main className="flex flex-1 flex-col gap-2 overflow-hidden p-2">
            <ControlWorkspace
              mode={controlViewMode}
              baristas={boardBaristas}
              unassignedOrders={boardUnassignedOrders}
              nextAvailable={nextAvailable}
              selectedOrderId={selectedOrderId}
              actionTicketKey={selectedTicket ? selectedTicketKey : null}
              currentTimeSec={realTimeSec}
              timelineCommand={timelineCommand}
              onSelectOrder={handleToggleOrderSelection}
              onAdvanceBay={handleAdvanceBay}
              onOpenTicketDetail={(ticket) =>
                setSelectedTicketKey(ticket.ticketUid)
              }
              onMoveTicket={handleMoveScheduledTicket}
              onReturnToUnassigned={handleReturnScheduledTicket}
              onCloseTicketAction={() => setSelectedTicketKey(null)}
              onOpenEmptySlot={(bayId) =>
                setAssignSlotData({ bayId, order: null })
              }
              onAssignToBay={(order, bayId) =>
                handleAssignOrderToBay(order.ticketUid, bayId)
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
                  (ticket) => ticket.ticketUid === selectedTicketKey,
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
            unassignedOrders={boardUnassignedOrders}
            onClose={() => setAssignSlotData(null)}
            onAssign={handleAssignOrderToBay}
          />
        )}

        {liveError && (
          <div
            role="alert"
            className="-translate-x-1/2 fixed bottom-4 left-1/2 z-50 max-w-[calc(100vw-32px)] rounded-lg bg-red-700 px-4 py-3 font-bold text-sm text-white shadow-lg"
          >
            {liveError}
          </div>
        )}

        {testSetupOpen && (
          <TestPlaySetup
            onClose={() => setTestSetupOpen(false)}
            onStart={handleStartTestPlay}
          />
        )}
      </div>
    </PracticeLanesScope>
  );
}
