import {
  type CaosOp,
  formatClockOfDay,
  isSeniorName,
  postCaosOp,
  startOfJstDay,
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
import { LaneChangeDialog } from "./components/LaneChangeDialog";
import { LaneConfirmDialog } from "./components/LaneConfirmDialog";
import { type RebrewDecision, RebrewPanel } from "./components/RebrewPanel";
import { ShiftFeedSettings } from "./components/ShiftFeedSettings";
import { TestPlaySetup } from "./components/TestPlaySetup";
import { TicketDetailModal } from "./components/TicketDetailModal";
import { type NavTab, TopHeader } from "./components/TopHeader";
import { useBeanInventory } from "./hooks/useBeanInventory";
import { usePosOrders } from "./hooks/usePosOrders";
import { useShiftFeed } from "./hooks/useShiftFeed";
import { useLimitedLabel } from "./limitedLabel";
import { buildCatalog, dripsToBoard, queuePosAt } from "./live/drips";
import { practiceCatalog, practiceSalesOrders } from "./practice/board";
import type { PracticeDataOrder } from "./practice/data";
import { usePractice } from "./practice/usePractice";
import type {
  Barista,
  BeanCode,
  OrderTicket,
  SalesOrder,
  UnassignedOrder,
} from "./types";
import { soundManager } from "./utils/audio";
import type { BeanIndex } from "./utils/beans";
import { isLimitedCard, laneOrdinal, makeLaneBaristas } from "./utils/lanes";
import {
  canMergeDripUnits,
  orderNumber,
  queueWaitSeconds,
  ticketKey,
} from "./utils/orderQueue";

// 交代・入れ替えで、上級生でない人になる列に限定のカードが待っているときの確認
type LaneConfirm = { messages: string[]; run: () => void };

// 別のタブで開くパネル（ドリッパー・豆キュー・実績）に渡す、開いた時点の盤面
type PanelSnapshot = {
  baristas: Barista[];
  /** 実データテストの実績（練習していなければ null） */
  practice: { orders: SalesOrder[]; startMs: number; endMs: number } | null;
};

const PANEL_SNAPSHOT_KEY = "caos-panel-snapshot-v2";

const readPanelSnapshot = (): PanelSnapshot | null => {
  try {
    const value = window.localStorage.getItem(PANEL_SNAPSHOT_KEY);
    return value ? (JSON.parse(value) as PanelSnapshot) : null;
  } catch {
    return null;
  }
};

// 練習用の盤面のカードは POS の在庫の商品ではないので、豆は引かない
const NO_BEANS: BeanIndex = new Map();

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

  const [undoLabel, setUndoLabel] = useState<string | null>(null);
  // 列の「交代」のダイアログ（どの列か）と、限定のカードの確認、設定（合言葉）
  const [laneDialogBay, setLaneDialogBay] = useState<number | null>(null);
  const [laneConfirm, setLaneConfirm] = useState<LaneConfirm | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // sohosai-shift の担当者の予定（交代の候補と上級生の判定に使う。合言葉はこの端末の設定）
  const shiftFeed = useShiftFeed();
  const limitedLabel = useLimitedLabel() || "限定";

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
  const [rebrewSource, setRebrewSource] = useState<{
    ticketKey: string;
    bayId: number;
  } | null>(null);

  // 実データテストの時計（一時停止・倍速）。普段の盤面は本当の時刻で動くので使わない
  const [isRunning, setIsRunning] = useState<boolean>(true);
  const [simSpeed, setSimSpeed] = useState<number>(1);
  const [timelineCommand, setTimelineCommand] = useState<{
    direction: "back" | "now" | "forward";
    id: number;
  } | null>(null);
  const [testSetupOpen, setTestSetupOpen] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);

  // 実データテスト：サーバーの練習用の盤面（本番と同じルール、本番とは別の盤面）。時計はこの画面が持つ
  const practice = usePractice({
    enabled: !standaloneTab,
    running: isRunning,
    speed: simSpeed,
    onError: setLiveError,
  });
  const practiceSession = practice.session;

  // Linked multi-item order selection (e.g. #152 has items in Bay 1 and Bay 2)
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [realTime, setRealTime] = useState(() => new Date());
  // 盤面の秒の起点。サーバーの営業日と同じく日本時間の 0:00（端末の時刻帯によらない）。
  // 実データテストでは、練習の時間帯の日の日本時間の 0:00
  const [realDayStartMs] = useState(() => startOfJstDay(Date.now()));
  const dayStartMs = practiceSession
    ? startOfJstDay(practiceSession.startMs)
    : realDayStartMs;
  const nowMs = practiceSession ? practice.clockMs : realTime.getTime();
  const realTimeSec = Math.floor((nowMs - dayStartMs) / 1000);

  // 普段は cafeore-pos の盤面（抽出カード）で動かす。カードと注文は同じ WebSocket で届き、操作は POST /api/caos/ops。
  // 実データテスト中（終了後の実績表示も含め、リセットするまで）は練習用の盤面を出す。操作は練習用の盤面へ送り、応答の盤面を使う
  const live = !practiceSession;
  const {
    orders: posOrders,
    drips: liveDrips,
    lanes: liveLanes,
    status: posStatus,
  } = usePosOrders(live);
  // 列（1st〜6th）とその担当者。サーバーの盤面にあり、全部の iPad でそろう（練習では練習用の盤面の列）
  const laneBaristas = useMemo(
    () => makeLaneBaristas(live ? liveLanes : (practice.state?.lanes ?? null)),
    [live, liveLanes, practice.state],
  );
  const catalog = useMemo(
    () => (live ? buildCatalog(posOrders) : practiceCatalog(practice.state)),
    [live, posOrders, practice.state],
  );
  // カードの色をマスターの画面と同じにするための色の設定
  const { colorSettings } = useColorSettings(live);
  // 豆の在庫と「商品 → 豆」は POS の在庫（API）をそのまま使う。CaOS では在庫を持たず、減らしもしない
  const {
    beanStatuses,
    beanIndex,
    error: beanError,
    isLoading: beanLoading,
  } = useBeanInventory();
  // 盤面のカードから組み立てた管制盤。本番の盤面と練習用の盤面は、同じ組み立て（予定時刻は planLane）
  const board = useMemo(
    () =>
      dripsToBoard(
        (live ? liveDrips : practice.state?.drips) ?? [],
        catalog,
        laneBaristas,
        realTimeSec,
        dayStartMs,
        live ? colorSettings : [],
        live ? beanIndex : NO_BEANS,
      ),
    [
      live,
      liveDrips,
      practice.state,
      catalog,
      laneBaristas,
      realTimeSec,
      dayStartMs,
      colorSettings,
      beanIndex,
    ],
  );
  const boardBaristas =
    standaloneSnapshot?.practice && standaloneSnapshot.baristas
      ? standaloneSnapshot.baristas
      : board.baristas;
  const boardUnassignedOrders = board.unassignedOrders;
  // 直前の盤面の操作を「1つ戻す」ための操作の ID（サーバーが操作の記録を持っている）
  const undoOpRef = useRef<string | null>(null);
  // 「次へ」を送っている途中のドリッパー（応答が盤面に届く前の二度押しを止める）
  const pendingNextRef = useRef(new Set<number>());
  // 「1つ戻す」を送っている途中（結果が返るまでの二度押しを止める）
  const pendingUndoRef = useRef(false);

  useEffect(() => {
    if (!liveError) return;
    const timer = window.setTimeout(() => setLiveError(null), 5000);
    return () => window.clearTimeout(timer);
  }, [liveError]);

  // 盤面への操作を送る（本番の盤面か、練習中なら練習用の盤面）。label を付けると「1つ戻す」の対象にする。
  // 本番の結果のカードは WebSocket の drips で、練習の結果は応答の盤面で届く。通ったら true を返す。
  // 豆の在庫は POS の在庫（注文から数える）なので、ここでは減らさない
  const runOp = async (label: string | null, op: CaosOp) => {
    let opId: string | null;
    if (practiceSession) {
      opId = await practice.runOp(op);
      if (opId === null) return false;
    } else {
      const { result, error } = await postCaosOp(op);
      if (error || !result) {
        setLiveError(error || "操作に失敗しました");
        return false;
      }
      opId = result.op_id;
    }
    if (label && opId) {
      undoOpRef.current = opId;
      setUndoLabel(label);
    }
    return true;
  };

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
  const rebrewTicket = rebrewSource
    ? findLiveTicket(rebrewSource.ticketKey)
    : null;

  // Only drips that have not started can be moved, so close the move UI once it starts.
  useEffect(() => {
    if (selectedTicketKey && selectedTicketStatus !== "scheduled")
      setSelectedTicketKey(null);
  }, [selectedTicketKey, selectedTicketStatus]);

  const sortedUnassignedOrders = [...boardUnassignedOrders].sort(
    (a, b) =>
      Number(Boolean(b.isRebrew)) - Number(Boolean(a.isRebrew)) ||
      orderNumber(a.id) - orderNumber(b.id) ||
      (a.itemIndex || 0) - (b.itemIndex || 0),
  );

  useEffect(() => {
    const clock = window.setInterval(() => setRealTime(new Date()), 1000);
    return () => window.clearInterval(clock);
  }, []);

  // 実データテストの時計が終わりの時刻に着いたら止める（残ったカードは「次へ」で終えられる）
  const practiceReachedEnd = practice.reachedEnd;
  useEffect(() => {
    if (practiceReachedEnd) setIsRunning(false);
  }, [practiceReachedEnd]);

  const clearUndo = () => {
    undoOpRef.current = null;
    setUndoLabel(null);
  };

  const handleUndo = () => {
    const opId = undoOpRef.current;
    if (!opId || pendingUndoRef.current) return;
    setSelectedOrderId(null);
    setRebrewSource(null);
    setSelectedTicketKey(null);
    // 戻せたときだけ「1つ戻す」の対象を消す。
    // 断られたら（ほかの iPad が先に操作した、など）対象を残して、もう一度押せるようにする
    pendingUndoRef.current = true;
    void runOp(null, { name: "undo", op_id: opId })
      .then((ok) => {
        if (!ok) return;
        // 送っている間にほかの操作をしていたら、そちらを「1つ戻す」の対象に残す
        if (undoOpRef.current === opId) clearUndo();
      })
      .finally(() => {
        pendingUndoRef.current = false;
      });
    soundManager.playDispatch();
  };

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
    if (targetBarista.queue[0].status !== "brewing") return;
    if (pendingNextRef.current.has(bayId)) return;

    const completedTicket = targetBarista.queue[0];
    // 見ていたカードを付けて送る（二度押しやほかの端末と同時に押したときは、サーバーが 422 で断る）
    pendingNextRef.current.add(bayId);
    void runOp(`${laneOrdinal(targetBarista.bayNumber)}の「次へ」`, {
      name: "next",
      dripper: bayId,
      drip_id: completedTicket.ticketUid,
    }).finally(() => pendingNextRef.current.delete(bayId));
  };

  // 限定のカードは上級生の列にしか割り当てられない（入れ直し・移動も同じ）。断るときは理由を出す
  const isSeniorBay = (bayId: number) =>
    Boolean(boardBaristas.find((barista) => barista.id === bayId)?.senior);
  const rejectLimited = (card: { beanCode: BeanCode }, bayId: number) => {
    if (!isLimitedCard(card) || isSeniorBay(bayId)) return false;
    setLiveError(`${limitedLabel}のカードは上級生の列にしか割り当てられません`);
    return true;
  };

  // Assign order to a bay
  const handleAssignOrderToBay = (
    orderUidOrId: string,
    targetBayId: number,
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
    if (rejectLimited(orderToAssign, targetBayId)) return;
    void runOp(`${orderToAssign.id}の割当`, {
      name: "assign",
      drip_id: orderToAssign.ticketUid,
      dripper: targetBayId,
    });
  };

  const handleMoveScheduledTicket = (
    ticket: OrderTicket,
    targetBayId: number,
  ) => {
    if (ticket.status !== "scheduled") return;
    if (ticket.preferredBaristaId && ticket.preferredBaristaId !== targetBayId)
      return;
    if (rejectLimited(ticket, targetBayId)) return;
    void runOp(`${ticket.id}の割当変更`, {
      name: "assign",
      drip_id: ticket.ticketUid,
      dripper: targetBayId,
    });
    setSelectedOrderId(null);
    soundManager.playDispatch();
  };

  // ---------------------------------------------------------------- 列の担当者（交代・入れ替え）
  // 交代は人が押したときにその場で行う（抽出中かどうかは見ない。時刻どおりの自動の交代はしない）。
  // 担当者はサーバーの盤面に持ち、全部の iPad にすぐ届く。「1つ戻す」で戻せる。
  // 実データテスト中は練習用の盤面の列を替える（本番の列には響かない）

  // 上級生でない人になる列に限定のカードが待っていれば、その知らせ（列ごとに 1 行）
  const limitedWarnings = (
    changes: { bay: Barista; name: string; senior: boolean }[],
    single: boolean,
  ) =>
    changes.flatMap(({ bay, name, senior }) => {
      if (senior) return [];
      const count = bay.queue.filter((ticket) => isLimitedCard(ticket)).length;
      if (count === 0) return [];
      const where = single ? "この列" : `${laneOrdinal(bay.bayNumber)}の列`;
      const who = name
        ? `${name}さんは上級生ではありません`
        : "担当者なしになります";
      return [
        `${where}に${limitedLabel}のカードが${count}枚あります（${who}）`,
      ];
    });

  const confirmLaneChange = (messages: string[], run: () => void) => {
    if (messages.length > 0) setLaneConfirm({ messages, run });
    else run();
  };

  const handlePickLanePerson = (bayId: number, name: string) => {
    const bay = boardBaristas.find((barista) => barista.id === bayId);
    setLaneDialogBay(null);
    if (!bay) return;
    const person = name.trim();
    // 上級生かは、この時点の sohosai-shift の名簿で決めてサーバーに持つ（名簿を読めない iPad でも同じ表示にする）
    const senior = isSeniorName(shiftFeed.feed, person);
    confirmLaneChange(
      limitedWarnings([{ bay, name: person, senior }], true),
      () => {
        void runOp(`${laneOrdinal(bayId)}の交代`, {
          name: "set_lane",
          dripper: bayId,
          person,
          senior,
        });
        soundManager.playDispatch();
      },
    );
  };

  const handleSwapLanes = (bayId: number, otherBayId: number) => {
    const bay = boardBaristas.find((barista) => barista.id === bayId);
    const other = boardBaristas.find((barista) => barista.id === otherBayId);
    if (!bay || !other || bay.id === other.id) return;
    confirmLaneChange(
      limitedWarnings(
        [
          { bay, name: other.name, senior: other.senior },
          { bay: other, name: bay.name, senior: bay.senior },
        ],
        false,
      ),
      () => {
        void runOp(
          `${laneOrdinal(bayId)}と${laneOrdinal(otherBayId)}の入れ替え`,
          { name: "swap_lanes", dripper: bayId, other_dripper: otherBayId },
        );
        soundManager.playDispatch();
      },
    );
  };

  // 上級生のいる列が無いときは、ヘッダーで知らせる（限定のカードを割り当てられない）
  const unassignedLimitedCount = boardUnassignedOrders.filter((order) =>
    isLimitedCard(order),
  ).length;
  const laneNotice = !boardBaristas.some((barista) => barista.senior)
    ? {
        full: `上級生のいる列がありません${unassignedLimitedCount > 0 ? `（${limitedLabel} ${unassignedLimitedCount}枚を割り当てられません）` : ""}`,
        short: "上級生なし",
      }
    : null;
  const laneDialogBarista =
    laneDialogBay === null
      ? null
      : boardBaristas.find((barista) => barista.id === laneDialogBay) || null;
  const feedNote = !shiftFeed.feedKey
    ? "sohosai-shift の合言葉を入れていないので、名前の候補はありません（右上の設定で入れられます）。名前を入れて交代できます"
    : shiftFeed.error && !shiftFeed.feed
      ? `sohosai-shift の予定を読めません：${shiftFeed.error}。名前を入れて交代できます`
      : null;

  const handleReturnScheduledTicket = (ticket: OrderTicket) => {
    if (ticket.status !== "scheduled") return;
    void runOp(`${ticket.id}を未割当に戻す`, {
      name: "unassign",
      drip_id: ticket.ticketUid,
    });
    setSelectedOrderId(null);
    soundManager.playDispatch();
  };

  const handleConfirmRebrew = (decision: RebrewDecision) => {
    if (!rebrewSource || !rebrewTicket) return;
    const ticket = rebrewTicket;
    if (
      decision.targetBayId !== null &&
      rejectLimited(ticket, decision.targetBayId)
    )
      return;
    const targetQueue =
      boardBaristas.find((barista) => barista.id === decision.targetBayId)
        ?.queue || [];
    // 入れ直しで余分に使った豆は、POS の在庫の計算に入れる（作業計画 K3。P4 のあと）
    void runOp(`${ticket.id}の入れ直し`, {
      name: "rebrew",
      source_id: ticket.ticketUid,
      cups: decision.cupCount,
      interrupt: decision.interruptCurrent,
      dripper: decision.targetBayId,
      queue_pos:
        decision.targetBayId === null
          ? null
          : queuePosAt(targetQueue, decision.insertIndex ?? targetQueue.length),
    });
    setRebrewSource(null);
    setSelectedTicketKey(null);
    setSelectedOrderId(ticket.id);
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
    void runOp(`${first.id}と${second.id}の統合`, {
      name: "merge",
      first_id: firstUid,
      second_id: secondUid,
    });
    setSelectedOrderId(null);
  };

  const clearSelection = () => {
    clearUndo();
    setSelectedOrderId(null);
    setSelectedTicketKey(null);
    setAssignSlotData(null);
    setRebrewSource(null);
  };

  // リセット：実データテストをやめて練習用の盤面を消し、本番の盤面に戻る
  const handleResetData = () => {
    practice.reset();
    clearSelection();
    setIsRunning(true);
    soundManager.playDispatch();
  };

  const handleStartTestPlay = async (start: {
    label: string;
    orders: PracticeDataOrder[];
    startMs: number;
    endMs: number;
  }) => {
    // 列の担当者は、本番の列の今の状態から始める（練習の中で交代しても本番には響かない）
    const ok = await practice.start({ ...start, lanes: liveLanes });
    if (!ok) return;
    clearSelection();
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
  const totalUnassignedDisplay = boardUnassignedOrders.reduce(
    (acc, cur) => acc + cur.cupCount,
    0,
  );
  const totalWaitingCupsDisplay = boardBaristas.reduce(
    (acc, b) => acc + b.queue.reduce((qAcc, t) => qAcc + t.cupCount, 0),
    0,
  );
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

  // 実績に出す実データテストの注文と時間帯（別のタブのパネルでは、開いた時点の写し）
  const practiceSales = practiceSession
    ? {
        orders: practiceSalesOrders(practice.state),
        startMs: practiceSession.startMs,
        endMs: Math.min(practice.clockMs, practiceSession.endMs),
      }
    : (standaloneSnapshot?.practice ?? null);

  const openAuxiliaryTab = (tab: AuxiliaryTab) => {
    try {
      window.localStorage.setItem(
        PANEL_SNAPSHOT_KEY,
        JSON.stringify({
          baristas: boardBaristas,
          practice: practiceSales,
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
      beanInventory={{
        statuses: beanStatuses,
        isLoading: beanLoading,
        error: beanError,
      }}
      beanWaitingCups={beanWaitingCups}
      salesOrders={practiceSales?.orders || []}
      periodStartMs={practiceSales?.startMs}
      periodEndMs={practiceSales?.endMs}
      onChangeLane={standaloneTab ? undefined : setLaneDialogBay}
      onSwapLanes={standaloneTab ? undefined : handleSwapLanes}
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
          canUndo={Boolean(undoLabel)}
          undoLabel={undoLabel}
          onUndo={handleUndo}
          testPlaying={Boolean(practiceSession && !practiceSession.finished)}
          testProgressLabel={
            practiceSession
              ? `${Math.max(0, Math.ceil((practiceSession.endMs - practice.clockMs) / 60_000))}分`
              : null
          }
          onOpenTestPlay={() => setTestSetupOpen(true)}
          onEndTestPlay={handleEndTestPlay}
          posStatus={posStatus}
          laneNotice={laneNotice}
          onOpenSettings={() => setSettingsOpen(true)}
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
            onRequestRebrew={(ticket, bayId) => {
              setSelectedTicketKey(null);
              setRebrewSource({ ticketKey: ticketKey(ticket), bayId });
            }}
            onOpenEmptySlot={(bayId) =>
              setAssignSlotData({ bayId, order: null })
            }
            onAssignToBay={(order, bayId) =>
              handleAssignOrderToBay(order.ticketUid || order.id, bayId)
            }
            onMergeOrders={handleMergeUnassignedOrders}
            onChangeLane={setLaneDialogBay}
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

      {rebrewSource && rebrewTicket && (
        <RebrewPanel
          ticket={rebrewTicket}
          sourceBayId={rebrewSource.bayId}
          baristas={boardBaristas}
          onClose={() => setRebrewSource(null)}
          onConfirm={handleConfirmRebrew}
        />
      )}

      {laneDialogBarista && (
        <LaneChangeDialog
          barista={laneDialogBarista}
          feed={shiftFeed.feed}
          feedNote={feedNote}
          nowMs={realTime.getTime()}
          onPick={(name) => handlePickLanePerson(laneDialogBarista.id, name)}
          onClose={() => setLaneDialogBay(null)}
        />
      )}

      {laneConfirm && (
        <LaneConfirmDialog
          messages={laneConfirm.messages}
          onCancel={() => setLaneConfirm(null)}
          onConfirm={() => {
            setLaneConfirm(null);
            laneConfirm.run();
          }}
        />
      )}

      {settingsOpen && (
        <ShiftFeedSettings
          shiftFeed={shiftFeed}
          onClose={() => setSettingsOpen(false)}
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
          starting={practice.starting}
          onClose={() => setTestSetupOpen(false)}
          onStart={(start) => void handleStartTestPlay(start)}
        />
      )}
    </div>
  );
}
