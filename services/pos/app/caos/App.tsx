import {
  CHANGEOVER_SEC,
  FIRST_START_DELAY_SEC,
  IMMINENT_SEC,
  STANDBY_LABEL,
  brewDurationLabel,
  brewDurationSec,
  formatClockOfDay,
  formatMinSec,
  formatRemainingLabel,
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
import type {
  Barista,
  BeanCode,
  HistoricalDataset,
  HistoricalOrder,
  OrderTicket,
  TestPlaySession,
  UnassignedOrder,
} from "./types";
import { soundManager } from "./utils/audio";
import { isLimitedCard, laneOrdinal, makeLaneBaristas } from "./utils/lanes";
import {
  arrangeQueue,
  canMergeDripUnits,
  orderNumber,
  queueWaitSeconds,
  reanchorQueueInOrder,
  splitIntoDripUnits,
  ticketKey,
} from "./utils/orderQueue";
import type { CaosOp } from "./utils/posOrders";

type UndoSnapshot = {
  baristas: Barista[];
  unassignedOrders: UnassignedOrder[];
  label: string;
};

// 交代・入れ替えで、上級生でない人になる列に限定のカードが待っているときの確認
type LaneConfirm = { messages: string[]; run: () => void };

type PanelSnapshot = {
  baristas: Barista[];
  testPlaySession: TestPlaySession | null;
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

// 実データテストの盤面の秒の起点（端末の時刻帯の 0 時）。テストは CaOS12（練習用の盤面）で作り直すので、ここは触らない。
// 普段の盤面（cafeore-pos の盤面）は、サーバーの営業日と同じ日本時間の 0 時を起点にする（startOfJstDay）
const startOfLocalDay = (ms: number) => {
  const date = new Date(ms);
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  ).getTime();
};

// 実データテスト（2025年の注文。商品 ID が無い）の豆のコード。盤面のカードには使わない。
// サーバーの練習用の盤面に移したら消す
const historicalBeanCode = (name: string, type: string): BeanCode => {
  if (type === "ice") return "ICE";
  if (type === "iceOre" || type === "milk") return "MILK";
  if (name.includes("俺")) return "ORE";
  if (name.includes("縁")) return "CHAMP";
  if (name.includes("キリマンジャロ")) return "TNZ";
  if (name.includes("トラジャ")) return "BRA";
  if (name.includes("ピンク")) return "KEN";
  return "SP";
};

const historicalOrderToDripUnits = (
  order: HistoricalOrder,
): UnassignedOrder[] => {
  // Plain iced milk is served without dripping, so it never enters CaOS's drip queue.
  const drinks = order.items.filter(
    (item) =>
      item.type !== "others" &&
      item.type !== "milk" &&
      !item.name.includes("アイスミルク"),
  );
  const grouped = new Map<BeanCode, { names: string[]; count: number }>();
  drinks.forEach((item) => {
    const code = historicalBeanCode(item.name, item.type);
    const current = grouped.get(code) || { names: [], count: 0 };
    current.count += 1;
    if (!current.names.includes(item.name)) current.names.push(item.name);
    grouped.set(code, current);
  });
  const id = `#${order.orderId.toString().padStart(3, "0")}`;
  const source = Array.from(
    grouped,
    ([beanCode, group], index): UnassignedOrder => ({
      id,
      ticketUid: `history-${order.orderId}-${beanCode}-${index}`,
      beanCode,
      beanName: group.names.join("・"),
      cupCount: group.count,
      badgeTag: `${group.count}杯`,
      predictedTimeStr: brewDurationLabel(group.count),
      recommendedBaristas: "全ドリッパー",
      recommendedBayIds: [1, 2, 3, 4, 5, 6],
      cardColor:
        beanCode === "ICE"
          ? "cyan"
          : beanCode === "SP"
            ? "emerald"
            : beanCode === "KEN"
              ? "peach"
              : "blue",
    }),
  );
  return splitIntoDripUnits(source);
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
  // 実データテストの手元の盤面（列の担当者はサーバーのものを重ねて出す）
  const [baristas, setBaristas] = useState<Barista[]>(
    () => standaloneSnapshot?.baristas || makeLaneBaristas(null),
  );
  const [unassignedOrders, setUnassignedOrders] = useState<UnassignedOrder[]>(
    [],
  );
  const undoSnapshotRef = useRef<UndoSnapshot | null>(null);
  const arrivalsAfterUndoSnapshotRef = useRef<UnassignedOrder[]>([]);
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

  const [isRunning, setIsRunning] = useState<boolean>(true);
  const [simSpeed, setSimSpeed] = useState<number>(1);
  const [timelineCommand, setTimelineCommand] = useState<{
    direction: "back" | "now" | "forward";
    id: number;
  } | null>(null);
  const [historicalOrders, setHistoricalOrders] = useState<HistoricalOrder[]>(
    [],
  );
  const [testDataLoading, setTestDataLoading] = useState(true);
  const [testSetupOpen, setTestSetupOpen] = useState(false);
  const [testPlaySession, setTestPlaySession] =
    useState<TestPlaySession | null>(
      () => standaloneSnapshot?.testPlaySession || null,
    );
  const historicalOrderCursor = useRef(0);

  // Linked multi-item order selection (e.g. #152 has items in Bay 1 and Bay 2)
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [realTime, setRealTime] = useState(() => new Date());
  // 盤面の秒の起点。サーバーの営業日と同じく日本時間の 0:00（端末の時刻帯によらない）
  const [realDayStartMs] = useState(() => startOfJstDay(Date.now()));
  const testPlayStatus = testPlaySession?.status;
  const testPlayCurrentMs = testPlaySession?.currentMs;
  const testPlayEndMs = testPlaySession?.endMs;
  const testPlayOrders = testPlaySession?.orders;
  const operationalTime = testPlaySession
    ? new Date(testPlaySession.currentMs)
    : realTime;
  // Seconds are counted from the session's first midnight so the clock keeps
  // increasing past 24:00 instead of wrapping and scrambling every queue.
  const operationalDayStartMs = testPlaySession
    ? startOfLocalDay(testPlaySession.startMs)
    : realDayStartMs;
  const realTimeSec = Math.floor(
    (operationalTime.getTime() - operationalDayStartMs) / 1000,
  );

  // 普段は cafeore-pos の盤面（抽出カード）で動かす。カードと注文は同じ WebSocket で届き、操作は POST /api/caos/ops。
  // 実データテスト中（終了後の実績表示も含め、リセットするまで）は盤面を使わず、テストの注文だけで手元の盤面を動かす。
  const live = !testPlaySession;
  const {
    orders: posOrders,
    drips: liveDrips,
    lanes: liveLanes,
    status: posStatus,
  } = usePosOrders(live);
  // 列（1st〜6th）とその担当者。サーバーの盤面にあり、全部の iPad でそろう
  const laneBaristas = useMemo(() => makeLaneBaristas(liveLanes), [liveLanes]);
  const catalog = useMemo(() => buildCatalog(posOrders), [posOrders]);
  // カードの色をマスターの画面と同じにするための色の設定（POS の色の設定の API）
  const { colorSettings } = useColorSettings(live);
  // 豆の在庫と「商品 → 豆」は POS の在庫（API）をそのまま使う。CaOS では在庫を持たず、減らしもしない
  const {
    beanStatuses,
    beanIndex,
    error: beanError,
    isLoading: beanLoading,
  } = useBeanInventory();
  // 盤面のカードから組み立てた管制盤。列の担当者はサーバーの盤面のもの
  const liveBoard = useMemo(
    () =>
      dripsToBoard(
        liveDrips ?? [],
        catalog,
        laneBaristas,
        realTimeSec,
        realDayStartMs,
        colorSettings,
        beanIndex,
      ),
    [
      liveDrips,
      catalog,
      laneBaristas,
      realTimeSec,
      realDayStartMs,
      colorSettings,
      beanIndex,
    ],
  );
  const boardBaristas = live
    ? liveBoard.baristas
    : baristas.map((barista) => {
        const lane = laneBaristas.find((item) => item.id === barista.id);
        return {
          ...barista,
          name: lane?.name ?? "",
          senior: lane?.senior ?? false,
        };
      });
  const boardUnassignedOrders = live
    ? liveBoard.unassignedOrders
    : unassignedOrders;
  // 直前の盤面の操作を「1つ戻す」ための操作の ID（サーバーが操作の記録を持っている）
  const liveUndoRef = useRef<string | null>(null);
  // 「次へ」を送っている途中のドリッパー（応答が盤面に届く前の二度押しを止める）
  const pendingNextRef = useRef(new Set<number>());
  // 「1つ戻す」を送っている途中（結果が返るまでの二度押しを止める）
  const pendingUndoRef = useRef(false);
  const [liveError, setLiveError] = useState<string | null>(null);

  useEffect(() => {
    if (!liveError) return;
    const timer = window.setTimeout(() => setLiveError(null), 5000);
    return () => window.clearTimeout(timer);
  }, [liveError]);

  // 盤面への操作を送る。label を付けると「1つ戻す」の対象にする。結果のカードは WebSocket の drips で届く。
  // 通ったら true を返す。豆の在庫は POS の在庫（注文から数える）なので、ここでは減らさない
  const runLive = async (label: string | null, op: CaosOp) => {
    const { result, error } = await postCaosOp(op);
    if (error || !result) {
      setLiveError(error || "操作に失敗しました");
      return false;
    }
    if (label && result.op_id) {
      undoSnapshotRef.current = null;
      liveUndoRef.current = result.op_id;
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

  useEffect(() => {
    let cancelled = false;
    setTestDataLoading(true);
    import("./data/sohosai-2025-day12.json")
      .then((module) => {
        const dataset = module.default as HistoricalDataset;
        if (!cancelled) setHistoricalOrders(dataset.orders);
      })
      .catch(() => {
        if (!cancelled) setHistoricalOrders([]);
      })
      .finally(() => {
        if (!cancelled) setTestDataLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (testPlayStatus !== "active" || !isRunning) return;
    // One test-play tick advances one second of historical time. The shared
    // speed control changes the tick frequency so the clock, timeline, order
    // arrivals, and brewing countdown all stay on the same multiplier.
    const timer = window.setInterval(() => {
      setTestPlaySession((session) =>
        session
          ? {
              ...session,
              currentMs: Math.min(session.endMs, session.currentMs + 1_000),
            }
          : session,
      );
    }, 1000 / simSpeed);
    return () => window.clearInterval(timer);
  }, [testPlayStatus, isRunning, simSpeed]);

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

  useEffect(() => {
    if (
      testPlayStatus !== "active" ||
      testPlayCurrentMs === undefined ||
      !testPlayOrders
    )
      return;
    const incoming: UnassignedOrder[] = [];
    while (historicalOrderCursor.current < testPlayOrders.length) {
      const order = testPlayOrders[historicalOrderCursor.current];
      if (new Date(order.createdAt).getTime() > testPlayCurrentMs) break;
      incoming.push(...historicalOrderToDripUnits(order));
      historicalOrderCursor.current += 1;
    }
    if (incoming.length === 0) return;
    if (undoSnapshotRef.current) {
      arrivalsAfterUndoSnapshotRef.current.push(...incoming);
    }
    setUnassignedOrders((prev) => [...prev, ...incoming]);
  }, [testPlayCurrentMs, testPlayOrders, testPlayStatus]);

  const captureUndo = (label: string) => {
    liveUndoRef.current = null;
    undoSnapshotRef.current = {
      baristas,
      unassignedOrders,
      label,
    };
    arrivalsAfterUndoSnapshotRef.current = [];
    setUndoLabel(label);
  };

  const handleUndo = () => {
    const liveUndo = liveUndoRef.current;
    if (live && liveUndo) {
      if (pendingUndoRef.current) return;
      setSelectedOrderId(null);
      setRebrewSource(null);
      setSelectedTicketKey(null);
      // 戻せたときだけ「1つ戻す」の対象を消す。
      // 断られたら（ほかの iPad が先に操作した、など）対象を残して、もう一度押せるようにする
      pendingUndoRef.current = true;
      void runLive(null, { name: "undo", op_id: liveUndo })
        .then((ok) => {
          if (!ok) return;
          // 送っている間にほかの操作をしていたら、そちらを「1つ戻す」の対象に残す
          if (liveUndoRef.current === liveUndo) {
            liveUndoRef.current = null;
            setUndoLabel(null);
          }
        })
        .finally(() => {
          pendingUndoRef.current = false;
        });
      soundManager.playDispatch();
      return;
    }
    const snapshot = undoSnapshotRef.current;
    if (!snapshot) return;
    const restoredKeys = new Set(
      snapshot.unassignedOrders.map((order) => order.ticketUid || order.id),
    );
    const arrivals = arrivalsAfterUndoSnapshotRef.current.filter(
      (order) => !restoredKeys.has(order.ticketUid || order.id),
    );
    setBaristas(snapshot.baristas);
    setUnassignedOrders([...snapshot.unassignedOrders, ...arrivals]);
    setSelectedOrderId(null);
    setRebrewSource(null);
    setSelectedTicketKey(null);
    undoSnapshotRef.current = null;
    arrivalsAfterUndoSnapshotRef.current = [];
    setUndoLabel(null);
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

  // Simulation timer loop
  useEffect(() => {
    if (!isRunning) return;
    const elapsedStep = 1;

    const interval = setInterval(() => {
      // Decrement remaining seconds on active tickets
      setBaristas((prevBaristas) =>
        prevBaristas.map((barista) => {
          if (barista.queue.length === 0) return barista;

          const updatedQueue = [...barista.queue];
          const activeTicket = { ...updatedQueue[0] };

          if (
            activeTicket.status === "brewing" &&
            activeTicket.timeRemainingSec !== undefined
          ) {
            const nextSec = Math.max(
              0,
              activeTicket.timeRemainingSec - elapsedStep,
            );
            activeTicket.timeRemainingSec = nextSec;
            updatedQueue[0] = activeTicket;

            return {
              ...barista,
              status: nextSec <= IMMINENT_SEC ? "imminent" : "brewing",
              remainingStr: formatRemainingLabel(nextSec),
              queue: updatedQueue,
            };
          }
          return barista;
        }),
      );
    }, 1000 / simSpeed);

    return () => clearInterval(interval);
  }, [isRunning, simSpeed]);

  // Advance / complete a bay's active order
  const handleAdvanceBay = (bayId: number) => {
    soundManager.playComplete();

    const targetBarista = boardBaristas.find((b) => b.id === bayId);
    if (!targetBarista || targetBarista.queue.length === 0) return;
    if (live && targetBarista.queue[0].status !== "brewing") return;
    if (live && pendingNextRef.current.has(bayId)) return;
    const label = `${laneOrdinal(targetBarista.bayNumber)}の「次へ」`;

    if (live) {
      // 見ていたカードを付けて送る（二度押しやほかの端末と同時に押したときは、サーバーが 422 で断る）
      pendingNextRef.current.add(bayId);
      void runLive(label, {
        name: "next",
        dripper: bayId,
        drip_id: targetBarista.queue[0].ticketUid,
      }).finally(() => pendingNextRef.current.delete(bayId));
      return;
    }

    captureUndo(label);

    setBaristas((prev) =>
      prev.map((b) => {
        if (b.id !== bayId) return b;
        if (b.queue.length === 0) return b;

        const doneTicket: OrderTicket = {
          ...b.queue[0],
          status: "completed",
          endTimeSec: realTimeSec,
        };
        const pastTickets = [...(b.pastTickets || []), doneTicket];
        // Re-anchor the entire downstream queue to the actual completion time.
        // This compensates every later card when the active drip ran long or short.
        const nextQueue = arrangeQueue(b.queue.slice(1), realTimeSec, true);

        return {
          ...b,
          status: nextQueue.length > 0 ? "brewing" : "standby",
          remainingStr:
            nextQueue.length > 0
              ? formatRemainingLabel(nextQueue[0].totalDurationSec)
              : STANDBY_LABEL,
          queue: nextQueue,
          pastTickets,
        };
      }),
    );
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
    if (live) {
      void runLive(`${orderToAssign.id}の割当`, {
        name: "assign",
        drip_id: orderToAssign.ticketUid,
        dripper: targetBayId,
      });
      return;
    }
    captureUndo(`${orderToAssign.id}の割当`);

    // Remove from unassigned
    setUnassignedOrders((prev) =>
      prev.filter(
        (o) =>
          (o.ticketUid || o.id) !==
          (orderToAssign.ticketUid || orderToAssign.id),
      ),
    );

    // Calculate dynamic start time based on target bay's queue
    const targetBay = baristas.find((b) => b.id === targetBayId);
    const lastTicket = targetBay?.queue[targetBay.queue.length - 1];
    const duration = brewDurationSec(orderToAssign.cupCount);
    const computedStartSec =
      lastTicket?.startTimeSec && lastTicket.totalDurationSec
        ? lastTicket.startTimeSec + lastTicket.totalDurationSec + CHANGEOVER_SEC
        : realTimeSec + FIRST_START_DELAY_SEC;

    // Convert to OrderTicket
    const newTicket: OrderTicket = {
      id: orderToAssign.id,
      ticketUid:
        orderToAssign.ticketUid || `${orderToAssign.id}-bay${targetBayId}`,
      itemIndex: orderToAssign.itemIndex,
      totalItemsInOrder: orderToAssign.totalItemsInOrder,
      totalOrderCups: orderToAssign.totalOrderCups,
      orderNotes: orderToAssign.orderNotes,
      sourceOrderIds: orderToAssign.sourceOrderIds,
      preferredBaristaId: orderToAssign.preferredBaristaId,
      nominee: orderToAssign.nominee,
      isRebrew: orderToAssign.isRebrew,
      rebrewOfTicketUid: orderToAssign.rebrewOfTicketUid,
      beanCode: orderToAssign.beanCode,
      beanName: orderToAssign.beanName,
      cupCount: orderToAssign.cupCount,
      tag: orderToAssign.badgeTag.includes("HOT")
        ? "HOT"
        : orderToAssign.badgeTag.includes("ICE")
          ? "ICE"
          : orderToAssign.badgeTag.includes("BATCH")
            ? "BATCH"
            : orderToAssign.badgeTag.includes("SP")
              ? "★SP"
              : undefined,
      status: "scheduled",
      scheduledTimeStr: formatMinSec(duration),
      startTimeSec: computedStartSec,
      totalDurationSec: duration,
    };

    // Add to target bay queue
    setBaristas((prev) =>
      prev.map((b) => {
        if (b.id !== targetBayId) return b;
        return {
          ...b,
          queue: arrangeQueue([...b.queue, newTicket], realTimeSec),
        };
      }),
    );
  };

  const handleMoveScheduledTicket = (
    ticket: OrderTicket,
    targetBayId: number,
  ) => {
    if (ticket.status !== "scheduled") return;
    if (ticket.preferredBaristaId && ticket.preferredBaristaId !== targetBayId)
      return;
    if (rejectLimited(ticket, targetBayId)) return;
    if (live) {
      void runLive(`${ticket.id}の割当変更`, {
        name: "assign",
        drip_id: ticket.ticketUid,
        dripper: targetBayId,
      });
      setSelectedOrderId(null);
      soundManager.playDispatch();
      return;
    }
    captureUndo(`${ticket.id}の割当変更`);
    const key = ticketKey(ticket);
    setBaristas((prev) => {
      return prev.map((bay) => ({
        ...bay,
        queue: arrangeQueue(
          bay.id === targetBayId
            ? [
                ...bay.queue.filter((item) => ticketKey(item) !== key),
                { ...ticket, status: "scheduled" as const },
              ]
            : bay.queue.filter((item) => ticketKey(item) !== key),
          realTimeSec,
        ),
      }));
    });
    setSelectedOrderId(null);
    soundManager.playDispatch();
  };

  // ---------------------------------------------------------------- 列の担当者（交代・入れ替え）
  // 交代は人が押したときにその場で行う（抽出中かどうかは見ない。時刻どおりの自動の交代はしない）。
  // 担当者はサーバーの盤面に持ち、全部の iPad にすぐ届く。「1つ戻す」で戻せる。

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
    if (!bay || !live) return;
    const person = name.trim();
    // 上級生かは、この時点の sohosai-shift の名簿で決めてサーバーに持つ（名簿を読めない iPad でも同じ表示にする）
    const senior = isSeniorName(shiftFeed.feed, person);
    confirmLaneChange(
      limitedWarnings([{ bay, name: person, senior }], true),
      () => {
        void runLive(`${laneOrdinal(bayId)}の交代`, {
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
    if (!bay || !other || bay.id === other.id || !live) return;
    confirmLaneChange(
      limitedWarnings(
        [
          { bay, name: other.name, senior: other.senior },
          { bay: other, name: bay.name, senior: bay.senior },
        ],
        false,
      ),
      () => {
        void runLive(
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
  const laneNotice =
    live && !boardBaristas.some((barista) => barista.senior)
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
    if (live) {
      void runLive(`${ticket.id}を未割当に戻す`, {
        name: "unassign",
        drip_id: ticket.ticketUid,
      });
      setSelectedOrderId(null);
      soundManager.playDispatch();
      return;
    }
    captureUndo(`${ticket.id}を未割当に戻す`);
    const key = ticketKey(ticket);
    setBaristas((prev) =>
      prev.map((bay) => ({
        ...bay,
        queue: arrangeQueue(
          bay.queue.filter((item) => ticketKey(item) !== key),
          realTimeSec,
        ),
      })),
    );
    setUnassignedOrders((prev) => [
      {
        id: ticket.id,
        ticketUid: ticket.ticketUid,
        itemIndex: ticket.itemIndex,
        totalItemsInOrder: ticket.totalItemsInOrder,
        totalOrderCups: ticket.totalOrderCups,
        orderNotes: ticket.orderNotes,
        sourceOrderIds: ticket.sourceOrderIds,
        beanCode: ticket.beanCode,
        beanName: ticket.beanName,
        cupCount: ticket.cupCount,
        badgeTag: `${ticket.cupCount}杯 ${ticket.tag || "HOT"}`,
        predictedTimeStr: brewDurationLabel(ticket.cupCount),
        recommendedBaristas: ticket.preferredBaristaId
          ? `ドリッパー ${ticket.preferredBaristaId}`
          : "全ドリッパー",
        recommendedBayIds: ticket.preferredBaristaId
          ? [ticket.preferredBaristaId]
          : [1, 2, 3, 4, 5, 6],
        preferredBaristaId: ticket.preferredBaristaId,
        nominee: ticket.nominee,
        isRebrew: ticket.isRebrew,
        rebrewOfTicketUid: ticket.rebrewOfTicketUid,
        cardColor:
          ticket.beanCode === "ICE"
            ? "cyan"
            : ticket.beanCode === "SP"
              ? "emerald"
              : "blue",
      },
      ...prev,
    ]);
    setSelectedOrderId(null);
    soundManager.playDispatch();
  };

  const handleConfirmRebrew = (decision: RebrewDecision) => {
    if (!rebrewSource || !rebrewTicket) return;
    const { bayId: sourceBayId } = rebrewSource;
    const ticket = rebrewTicket;
    if (
      decision.targetBayId !== null &&
      rejectLimited(ticket, decision.targetBayId)
    )
      return;
    if (live) {
      const targetQueue =
        boardBaristas.find((barista) => barista.id === decision.targetBayId)
          ?.queue || [];
      void runLive(`${ticket.id}の入れ直し`, {
        name: "rebrew",
        source_id: ticket.ticketUid,
        cups: decision.cupCount,
        interrupt: decision.interruptCurrent,
        dripper: decision.targetBayId,
        queue_pos:
          decision.targetBayId === null
            ? null
            : queuePosAt(
                targetQueue,
                decision.insertIndex ?? targetQueue.length,
              ),
      });
      setRebrewSource(null);
      setSelectedTicketKey(null);
      setSelectedOrderId(ticket.id);
      soundManager.playDispatch();
      return;
    }
    captureUndo(`${ticket.id}の入れ直し`);
    const originalKey = ticketKey(ticket);
    const duration = brewDurationSec(decision.cupCount);
    const rebrewUid = `rebrew-${originalKey}-${Date.now()}`;
    const newTicket: OrderTicket = {
      ...ticket,
      ticketUid: rebrewUid,
      cupCount: decision.cupCount,
      status: "scheduled",
      totalDurationSec: duration,
      scheduledTimeStr: formatMinSec(duration),
      startTimeSec: undefined,
      endTimeSec: undefined,
      completedAtSec: undefined,
      timeRemainingSec: undefined,
      isRebrew: true,
      rebrewOfTicketUid: originalKey,
      isInterrupted: false,
    };

    if (decision.targetBayId === null) {
      setUnassignedOrders((prev) => [
        {
          id: newTicket.id,
          ticketUid: newTicket.ticketUid,
          itemIndex: newTicket.itemIndex,
          totalItemsInOrder: newTicket.totalItemsInOrder,
          totalOrderCups: newTicket.totalOrderCups,
          orderNotes: newTicket.orderNotes,
          sourceOrderIds: newTicket.sourceOrderIds,
          beanCode: newTicket.beanCode,
          beanName: newTicket.beanName,
          cupCount: newTicket.cupCount,
          badgeTag: `${newTicket.cupCount}杯 入れ直し`,
          predictedTimeStr: brewDurationLabel(newTicket.cupCount),
          recommendedBaristas: isLimitedCard(newTicket)
            ? "上級生の列"
            : "全ドリッパー",
          recommendedBayIds: boardBaristas
            .filter((barista) => !isLimitedCard(newTicket) || barista.senior)
            .map((barista) => barista.id),
          preferredBaristaId: newTicket.preferredBaristaId,
          nominee: newTicket.nominee,
          cardColor: newTicket.beanCode === "SP" ? "emerald" : "blue",
          isRebrew: true,
          rebrewOfTicketUid: originalKey,
        },
        ...prev,
      ]);
    }

    setBaristas((prev) => {
      let updated: Barista[] = prev.map((barista): Barista => {
        if (
          barista.id !== sourceBayId ||
          !decision.interruptCurrent ||
          ticket.status !== "brewing"
        )
          return barista;
        const sourceIndex = barista.queue.findIndex(
          (item) => ticketKey(item) === originalKey,
        );
        if (sourceIndex < 0) return barista;
        const interrupted: OrderTicket = {
          ...barista.queue[sourceIndex],
          status: "completed",
          endTimeSec: realTimeSec,
          completedAtSec: realTimeSec,
          isInterrupted: true,
        };
        const remaining = barista.queue.filter(
          (_, index) => index !== sourceIndex,
        );
        const queue = reanchorQueueInOrder(remaining, realTimeSec);
        return {
          ...barista,
          queue,
          pastTickets: [...(barista.pastTickets || []), interrupted],
          status: queue.length > 0 ? "brewing" : "standby",
          remainingStr: queue.length > 0 ? "再計算中" : STANDBY_LABEL,
        };
      });

      if (decision.targetBayId !== null) {
        updated = updated.map((barista): Barista => {
          if (barista.id !== decision.targetBayId) return barista;
          const queue = [...barista.queue];
          const canReplaceInterruptedNow =
            decision.interruptCurrent &&
            ticket.status === "brewing" &&
            barista.id === sourceBayId;
          const minimumIndex =
            queue.length > 0 && !canReplaceInterruptedNow ? 1 : 0;
          const insertion = Math.max(
            minimumIndex,
            Math.min(decision.insertIndex ?? queue.length, queue.length),
          );
          queue.splice(insertion, 0, newTicket);
          const arranged = reanchorQueueInOrder(queue, realTimeSec);
          return {
            ...barista,
            queue: arranged,
            status: arranged.length > 0 ? "brewing" : "standby",
            remainingStr:
              arranged.length > 0 ? barista.remainingStr : STANDBY_LABEL,
          };
        });
      }
      return updated;
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
    if (live) {
      void runLive(`${first.id}と${second.id}の統合`, {
        name: "merge",
        first_id: firstUid,
        second_id: secondUid,
      });
      setSelectedOrderId(null);
      return;
    }
    captureUndo(`${first.id}と${second.id}の統合`);
    setUnassignedOrders((prev) => {
      const sourceOrderIds = Array.from(
        new Set([
          ...(first.sourceOrderIds || [first.id]),
          ...(second.sourceOrderIds || [second.id]),
        ]),
      ).sort((a, b) => orderNumber(a) - orderNumber(b));
      const merged: UnassignedOrder = {
        ...first,
        id: sourceOrderIds.join("+"),
        ticketUid: `merged-${[firstUid, secondUid].sort().join("-")}`,
        sourceOrderIds,
        cupCount: 2,
        badgeTag: "2杯 統合",
        orderNotes: `${sourceOrderIds.join(" + ")} 同時ドリップ`,
      };
      return [
        ...prev.filter((order) => {
          const uid = order.ticketUid || order.id;
          return uid !== firstUid && uid !== secondUid;
        }),
        merged,
      ];
    });
    setSelectedOrderId(null);
  };

  // Reset to initial screenshot state
  const handleResetData = () => {
    setBaristas(makeLaneBaristas(null));
    setUnassignedOrders([]);
    undoSnapshotRef.current = null;
    liveUndoRef.current = null;
    arrivalsAfterUndoSnapshotRef.current = [];
    setUndoLabel(null);
    setSelectedOrderId(null);
    setSelectedTicketKey(null);
    setAssignSlotData(null);
    setRebrewSource(null);
    setTestPlaySession(null);
    historicalOrderCursor.current = 0;
    setIsRunning(true);
    soundManager.playDispatch();
  };

  const handleStartTestPlay = (startMs: number, durationMinutes: 30 | 60) => {
    const endMs = startMs + durationMinutes * 60_000;
    const orders = historicalOrders
      .filter((order) => {
        const createdAt = new Date(order.createdAt).getTime();
        return createdAt >= startMs && createdAt < endMs;
      })
      .sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );
    setBaristas(makeLaneBaristas(null));
    setUnassignedOrders([]);
    setSelectedOrderId(null);
    undoSnapshotRef.current = null;
    arrivalsAfterUndoSnapshotRef.current = [];
    setUndoLabel(null);
    setSelectedTicketKey(null);
    setAssignSlotData(null);
    setRebrewSource(null);
    historicalOrderCursor.current = 0;
    setTestPlaySession({
      status: "active",
      startMs,
      endMs,
      currentMs: startMs,
      durationMinutes,
      orders,
    });
    setIsRunning(true);
    setActiveTab("control");
    setTestSetupOpen(false);
  };

  const handleEndTestPlay = () => {
    setTestPlaySession((session) =>
      session ? { ...session, status: "finished" } : session,
    );
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

  const openAuxiliaryTab = (tab: AuxiliaryTab) => {
    try {
      window.localStorage.setItem(
        PANEL_SNAPSHOT_KEY,
        JSON.stringify({
          baristas: boardBaristas,
          testPlaySession,
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
      salesOrders={
        testPlaySession?.orders.filter(
          (order) =>
            new Date(order.createdAt).getTime() <= testPlaySession.currentMs,
        ) || []
      }
      periodStartMs={testPlaySession?.startMs}
      periodEndMs={
        testPlaySession
          ? Math.min(testPlaySession.currentMs, testPlaySession.endMs)
          : undefined
      }
      onChangeLane={live ? setLaneDialogBay : undefined}
      onSwapLanes={live ? handleSwapLanes : undefined}
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
          testPlaying={testPlaySession?.status === "active"}
          testProgressLabel={
            testPlaySession
              ? `${Math.max(0, Math.ceil((testPlaySession.endMs - testPlaySession.currentMs) / 60_000))}分`
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
            onChangeLane={live ? setLaneDialogBay : undefined}
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
          orders={historicalOrders}
          loading={testDataLoading}
          onClose={() => setTestSetupOpen(false)}
          onStart={handleStartTestPlay}
        />
      )}
    </div>
  );
}
