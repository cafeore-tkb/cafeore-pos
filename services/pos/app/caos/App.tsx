import { postCaosOp, useColorSettings } from "@cafeore/common";
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
import { type RebrewDecision, RebrewPanel } from "./components/RebrewPanel";
import { TestPlaySetup } from "./components/TestPlaySetup";
import { TicketDetailModal } from "./components/TicketDetailModal";
import { type NavTab, TopHeader } from "./components/TopHeader";
import {
  INITIAL_BARISTAS,
  INITIAL_BEANS,
  INITIAL_LEARNING_LOGS,
} from "./data/initialData";
import { usePosOrders } from "./hooks/usePosOrders";
import { buildCatalog, dripsToBoard, queuePosAt } from "./live/drips";
import type {
  Barista,
  BeanCode,
  BeanItem,
  HistoricalDataset,
  HistoricalOrder,
  LearningEngineLog,
  OrderTicket,
  TestPlaySession,
  UnassignedOrder,
} from "./types";
import { soundManager } from "./utils/audio";
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

// 1 回のドリップで手元の豆の在庫から引く分
type BeanUse = { code: BeanCode; grams: number };

type UndoSnapshot = {
  baristas: Barista[];
  beans: BeanItem[];
  unassignedOrders: UnassignedOrder[];
  shiftRosterIndex: number;
  label: string;
};

type PanelSnapshot = {
  baristas: Barista[];
  beans: BeanItem[];
  learningLogs: LearningEngineLog[];
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

const startOfLocalDay = (ms: number) => {
  const date = new Date(ms);
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  ).getTime();
};

type ShiftMember = { name: string; canHandleSpecial: boolean };

const SHIFT_ROSTERS: ShiftMember[][] = [
  [
    { name: "鈴木", canHandleSpecial: true },
    { name: "山口", canHandleSpecial: true },
    { name: "小林", canHandleSpecial: false },
    { name: "松本", canHandleSpecial: false },
    { name: "井上", canHandleSpecial: false },
    { name: "木村", canHandleSpecial: false },
  ],
  [
    { name: "林", canHandleSpecial: true },
    { name: "中西", canHandleSpecial: true },
    { name: "近藤", canHandleSpecial: true },
    { name: "斎藤", canHandleSpecial: false },
    { name: "清水", canHandleSpecial: false },
    { name: "山本", canHandleSpecial: false },
  ],
  [
    { name: "森", canHandleSpecial: true },
    { name: "橋本", canHandleSpecial: false },
    { name: "阿部", canHandleSpecial: false },
    { name: "石川", canHandleSpecial: false },
    { name: "山下", canHandleSpecial: false },
    { name: "藤田", canHandleSpecial: false },
  ],
  [
    { name: "沼田", canHandleSpecial: true },
    { name: "佐藤", canHandleSpecial: true },
    { name: "三田", canHandleSpecial: true },
    { name: "前田", canHandleSpecial: false },
    { name: "岡田", canHandleSpecial: false },
    { name: "石井", canHandleSpecial: false },
  ],
  [
    { name: "瀬邉", canHandleSpecial: true },
    { name: "菅原", canHandleSpecial: true },
    { name: "長谷川", canHandleSpecial: false },
    { name: "村上", canHandleSpecial: false },
    { name: "坂本", canHandleSpecial: false },
    { name: "青木", canHandleSpecial: false },
  ],
];

const placeShiftMembers = (members: ShiftMember[]) => {
  const special = members.filter((member) => member.canHandleSpecial);
  const regular = members.filter((member) => !member.canHandleSpecial);
  const placed: Array<ShiftMember | undefined> = Array(6).fill(undefined);
  if (special[0]) placed[0] = special.shift();
  if (special[0]) placed[5] = special.shift();
  [...special, ...regular].forEach((member) => {
    const openIndex = placed.findIndex((placedMember) => !placedMember);
    if (openIndex >= 0) placed[openIndex] = member;
  });
  return placed as ShiftMember[];
};

const makeCleanBaristas = (): Barista[] =>
  INITIAL_BARISTAS.map((barista) => ({
    ...barista,
    status: "standby",
    remainingStr: "00:00 待機中",
    activeTicketId: undefined,
    queue: [],
    pastTickets: [],
  }));

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
      predictedTimeStr: group.count > 1 ? "3分15秒" : "2分15秒",
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
  const [baristas, setBaristas] = useState<Barista[]>(
    () => standaloneSnapshot?.baristas || makeCleanBaristas(),
  );
  const [beans, setBeans] = useState<BeanItem[]>(
    () => standaloneSnapshot?.beans || INITIAL_BEANS,
  );
  const [unassignedOrders, setUnassignedOrders] = useState<UnassignedOrder[]>(
    [],
  );
  // 取り込み済みの cafeore-pos 注文（UUID）。全件が届くたびに、新しい注文だけを未割当へ足すために使う。
  const undoSnapshotRef = useRef<UndoSnapshot | null>(null);
  const arrivalsAfterUndoSnapshotRef = useRef<UnassignedOrder[]>([]);
  const [undoLabel, setUndoLabel] = useState<string | null>(null);
  const [shiftRosterIndex, setShiftRosterIndex] = useState(0);
  const lastAutomaticShiftHour = useRef(new Date().getHours());
  const [learningLogs, setLearningLogs] = useState<LearningEngineLog[]>(
    () => standaloneSnapshot?.learningLogs || INITIAL_LEARNING_LOGS,
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
  const [realDayStartMs] = useState(() => startOfLocalDay(Date.now()));
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
    status: posStatus,
  } = usePosOrders(live);
  const catalog = useMemo(() => buildCatalog(posOrders), [posOrders]);
  // カードの色をマスターの画面と同じにするための色の設定
  const { colorSettings } = useColorSettings(live);
  // 盤面のカードから組み立てた管制盤。ドリッパーの名前と係数は手元の baristas から取る
  const liveBoard = useMemo(
    () =>
      dripsToBoard(
        liveDrips ?? [],
        catalog,
        baristas,
        realTimeSec,
        realDayStartMs,
        colorSettings,
      ),
    [liveDrips, catalog, baristas, realTimeSec, realDayStartMs, colorSettings],
  );
  const boardBaristas = live ? liveBoard.baristas : baristas;
  const boardUnassignedOrders = live
    ? liveBoard.unassignedOrders
    : unassignedOrders;
  // 直前の盤面の操作を「1つ戻す」ための操作の ID（サーバーが操作の記録を持っている）
  const liveUndoRef = useRef<string | null>(null);
  // その操作で手元の豆の在庫から引いた分（「1つ戻す」が通ったら戻す）。在庫はこの端末だけのもの
  const liveUndoBeansRef = useRef<BeanUse | null>(null);
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

  const adjustBeans = ({ code, grams }: BeanUse, sign: 1 | -1) =>
    setBeans((prev) =>
      prev.map((bean) =>
        bean.code === code
          ? { ...bean, stockGrams: Math.max(0, bean.stockGrams + sign * grams) }
          : bean,
      ),
    );

  // 盤面への操作を送る。label を付けると「1つ戻す」の対象にする。結果のカードは WebSocket の drips で届く。
  // usedBeans は、操作が通ったときだけ手元の豆の在庫から引く分（失敗したら在庫は変えない）。通ったら true を返す
  const runLive = async (
    label: string | null,
    op: CaosOp,
    usedBeans?: BeanUse,
  ) => {
    const { result, error } = await postCaosOp(op);
    if (error || !result) {
      setLiveError(error || "操作に失敗しました");
      return false;
    }
    if (usedBeans) adjustBeans(usedBeans, -1);
    if (label && result.op_id) {
      undoSnapshotRef.current = null;
      liveUndoRef.current = result.op_id;
      liveUndoBeansRef.current = usedBeans ?? null;
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
      beans,
      unassignedOrders,
      shiftRosterIndex,
      label,
    };
    arrivalsAfterUndoSnapshotRef.current = [];
    setUndoLabel(label);
  };

  const handleUndo = () => {
    const liveUndo = liveUndoRef.current;
    if (live && liveUndo) {
      if (pendingUndoRef.current) return;
      const usedBeans = liveUndoBeansRef.current;
      setSelectedOrderId(null);
      setRebrewSource(null);
      setSelectedTicketKey(null);
      // 戻せたときだけ「1つ戻す」の対象を消し、その操作で引いた豆の在庫も戻す。
      // 断られたら（ほかの iPad が先に操作した、など）対象を残して、もう一度押せるようにする
      pendingUndoRef.current = true;
      void runLive(null, { name: "undo", op_id: liveUndo })
        .then((ok) => {
          if (!ok) return;
          if (usedBeans) adjustBeans(usedBeans, 1);
          // 送っている間にほかの操作をしていたら、そちらを「1つ戻す」の対象に残す
          if (liveUndoRef.current === liveUndo) {
            liveUndoRef.current = null;
            liveUndoBeansRef.current = null;
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
    setBeans(snapshot.beans);
    setUnassignedOrders([...snapshot.unassignedOrders, ...arrivals]);
    setShiftRosterIndex(snapshot.shiftRosterIndex);
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

  // Format digital clock time HH:mm:ss
  const formatTimeStr = (totalSec: number) => {
    const hours = Math.floor(totalSec / 3600) % 24;
    const minutes = Math.floor((totalSec % 3600) / 60);
    const seconds = totalSec % 60;
    return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
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

            const m = Math.floor(nextSec / 60);
            const s = nextSec % 60;
            const remainingStr = `0${m}:${s < 10 ? "0" : ""}${s} 残り`;

            return {
              ...barista,
              status: nextSec <= 15 ? "imminent" : "brewing",
              remainingStr,
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
    if (!live) captureUndo(`${targetBarista.bayNumber}の「次へ」`);

    const completedTicket = targetBarista.queue[0];

    // Compute log outside of state updater to prevent duplicate execution
    const actualM = Math.floor(completedTicket.totalDurationSec / 60);
    const actualS = completedTicket.totalDurationSec % 60;
    const deltaSec = Math.floor(Math.random() * 20 - 10);
    const deltaStr = deltaSec < 0 ? `(${deltaSec}秒)` : `(+${deltaSec}秒)`;

    const newLog: LearningEngineLog = {
      id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      baristaKey: `${String.fromCharCode(64 + targetBarista.id)} ${targetBarista.name}`,
      recentActual: `${actualM}:${actualS < 10 ? "0" : ""}${actualS}`,
      deltaStr,
      deltaType: deltaSec < 0 ? "faster" : "slower",
      coefficient: targetBarista.coefficient,
      coefficientStatus:
        deltaSec < -15
          ? `最速補正 ${targetBarista.coefficient.toFixed(2)}`
          : deltaSec < 0
            ? `係数 ${targetBarista.coefficient.toFixed(2)} 維持`
            : `係数 ${targetBarista.coefficient.toFixed(2)} 連動`,
      timestamp: formatTimeStr(realTimeSec),
    };

    const usedBeans: BeanUse = {
      code: completedTicket.beanCode,
      grams: completedTicket.cupCount * 14,
    };
    const addLog = () =>
      setLearningLogs((prevLogs) => [
        newLog,
        ...prevLogs.filter((l) => l.id !== newLog.id).slice(0, 4),
      ]);

    if (live) {
      // 見ていたカードを付けて送る（二度押しやほかの端末と同時に押したときは、サーバーが 422 で断る）。
      // 豆の在庫と学習ログは、サーバーで通ってから更新する
      pendingNextRef.current.add(bayId);
      void runLive(
        `${targetBarista.bayNumber}の「次へ」`,
        { name: "next", dripper: bayId, drip_id: completedTicket.ticketUid },
        usedBeans,
      )
        .then((ok) => {
          if (ok) addLog();
        })
        .finally(() => pendingNextRef.current.delete(bayId));
      return;
    }

    addLog();
    adjustBeans(usedBeans, -1);

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
        const nextQueue = arrangeQueue(
          b.queue.slice(1),
          b.coefficient,
          realTimeSec,
          true,
        );

        return {
          ...b,
          status: nextQueue.length > 0 ? "brewing" : "standby",
          remainingStr: nextQueue.length > 0 ? "01:50 残り" : "00:00 待機中",
          queue: nextQueue,
          pastTickets,
        };
      }),
    );
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
    const duration = orderToAssign.cupCount > 1 ? 195 : 135;
    const computedStartSec =
      lastTicket?.startTimeSec && lastTicket.totalDurationSec
        ? lastTicket.startTimeSec + lastTicket.totalDurationSec + 15
        : realTimeSec + 10;

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
      scheduledTimeStr: `${Math.floor(duration / 60)}:${(duration % 60).toString().padStart(2, "0")}`,
      startTimeSec: computedStartSec,
      totalDurationSec: duration,
    };

    // Add to target bay queue
    setBaristas((prev) =>
      prev.map((b) => {
        if (b.id !== targetBayId) return b;
        return {
          ...b,
          queue: arrangeQueue(
            [...b.queue, newTicket],
            b.coefficient,
            realTimeSec,
          ),
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
          bay.coefficient,
          realTimeSec,
        ),
      }));
    });
    setSelectedOrderId(null);
    soundManager.playDispatch();
  };

  const changeShift = (allowUndo: boolean) => {
    if (allowUndo) {
      captureUndo("シフト交代");
    } else {
      undoSnapshotRef.current = null;
      liveUndoRef.current = null;
      arrivalsAfterUndoSnapshotRef.current = [];
      setUndoLabel(null);
    }
    const roster = placeShiftMembers(
      SHIFT_ROSTERS[shiftRosterIndex % SHIFT_ROSTERS.length],
    );
    setBaristas((prev) =>
      [...prev]
        .sort((a, b) => a.bayNumber - b.bayNumber)
        .map((barista, index) => {
          const member = roster[index];
          return {
            ...barista,
            name: member.name,
            canHandleSpecial: member.canHandleSpecial || undefined,
            coefficient: member.canHandleSpecial ? 0.97 : 1.05,
            coefficientColor: member.canHandleSpecial ? "green" : "orange",
          };
        }),
    );
    setShiftRosterIndex((index) => (index + 1) % SHIFT_ROSTERS.length);
    setSelectedTicketKey(null);
    setSelectedOrderId(null);
    soundManager.playDispatch();
  };

  const currentHour = realTime.getHours();

  // The shift should run only when the wall-clock hour changes. Including
  // changeShift would retrigger this effect on every render because it closes
  // over the current operational state.
  // biome-ignore lint/correctness/useExhaustiveDependencies: currentHour is the intentional trigger
  useEffect(() => {
    if (currentHour === lastAutomaticShiftHour.current) return;
    lastAutomaticShiftHour.current = currentHour;
    changeShift(false);
  }, [currentHour]);

  const nextShiftHour = (realTime.getHours() + 1) % 24;
  const nextShiftLabel = `${nextShiftHour.toString().padStart(2, "0")}:00`;

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
          bay.coefficient,
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
        predictedTimeStr: ticket.scheduledTimeStr || "2:15",
        recommendedBaristas: ticket.preferredBaristaId
          ? `ドリッパー ${ticket.preferredBaristaId}`
          : "全ドリッパー",
        recommendedBayIds: ticket.preferredBaristaId
          ? [ticket.preferredBaristaId]
          : [1, 2, 3, 4, 5, 6],
        preferredBaristaId: ticket.preferredBaristaId,
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
    if (live) {
      const targetQueue =
        boardBaristas.find((barista) => barista.id === decision.targetBayId)
          ?.queue || [];
      void runLive(
        `${ticket.id}の入れ直し`,
        {
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
        },
        // 抽出中を途中でやめたら、その分の豆を使ったことにする（ライブでない盤面と同じ）
        decision.interruptCurrent && ticket.status === "brewing"
          ? { code: ticket.beanCode, grams: ticket.cupCount * 14 }
          : undefined,
      );
      setRebrewSource(null);
      setSelectedTicketKey(null);
      setSelectedOrderId(ticket.id);
      soundManager.playDispatch();
      return;
    }
    captureUndo(`${ticket.id}の入れ直し`);
    const originalKey = ticketKey(ticket);
    const duration = decision.cupCount > 1 ? 195 : 135;
    const rebrewUid = `rebrew-${originalKey}-${Date.now()}`;
    const newTicket: OrderTicket = {
      ...ticket,
      ticketUid: rebrewUid,
      cupCount: decision.cupCount,
      status: "scheduled",
      totalDurationSec: duration,
      scheduledTimeStr: `${Math.floor(duration / 60)}:${(duration % 60).toString().padStart(2, "0")}`,
      startTimeSec: undefined,
      endTimeSec: undefined,
      completedAtSec: undefined,
      timeRemainingSec: undefined,
      isRebrew: true,
      rebrewOfTicketUid: originalKey,
      isInterrupted: false,
    };

    if (decision.interruptCurrent && ticket.status === "brewing") {
      setBeans((prev) =>
        prev.map((bean) =>
          bean.code === ticket.beanCode
            ? {
                ...bean,
                stockGrams: Math.max(0, bean.stockGrams - ticket.cupCount * 14),
              }
            : bean,
        ),
      );
    }

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
          predictedTimeStr: newTicket.scheduledTimeStr || "2:15",
          recommendedBaristas:
            newTicket.beanCode === "SP" ? "SP対応ドリッパー" : "全ドリッパー",
          recommendedBayIds: baristas
            .filter(
              (barista) =>
                newTicket.beanCode !== "SP" || barista.canHandleSpecial,
            )
            .map((barista) => barista.id),
          preferredBaristaId: newTicket.preferredBaristaId,
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
        const queue = reanchorQueueInOrder(
          remaining,
          barista.coefficient,
          realTimeSec,
        );
        return {
          ...barista,
          queue,
          pastTickets: [...(barista.pastTickets || []), interrupted],
          status: queue.length > 0 ? "brewing" : "standby",
          remainingStr: queue.length > 0 ? "再計算中" : "00:00 待機中",
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
          const arranged = reanchorQueueInOrder(
            queue,
            barista.coefficient,
            realTimeSec,
          );
          return {
            ...barista,
            queue: arranged,
            status: arranged.length > 0 ? "brewing" : "standby",
            remainingStr:
              arranged.length > 0 ? barista.remainingStr : "00:00 待機中",
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

  // Manual trigger for AI recalibration
  const _handleTriggerRecalibration = () => {
    soundManager.playDispatch();
    setBaristas((prev) =>
      prev.map((b) => {
        const drift = Math.random() * 0.04 - 0.02;
        const newCoef = Math.max(
          0.85,
          Math.min(1.2, Number((b.coefficient + drift).toFixed(2))),
        );
        return {
          ...b,
          coefficient: newCoef,
        };
      }),
    );
  };

  // Reset to initial screenshot state
  const handleResetData = () => {
    setBaristas(makeCleanBaristas());
    setBeans(INITIAL_BEANS);
    setUnassignedOrders([]);
    undoSnapshotRef.current = null;
    liveUndoRef.current = null;
    arrivalsAfterUndoSnapshotRef.current = [];
    setUndoLabel(null);
    setLearningLogs(INITIAL_LEARNING_LOGS);
    setSelectedOrderId(null);
    setSelectedTicketKey(null);
    setAssignSlotData(null);
    setRebrewSource(null);
    setShiftRosterIndex(0);
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
    setBaristas(makeCleanBaristas());
    setBeans(INITIAL_BEANS);
    setUnassignedOrders([]);
    setLearningLogs(INITIAL_LEARNING_LOGS);
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
      seconds: queueWaitSeconds(barista.queue, barista.coefficient),
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
          beans,
          learningLogs,
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
      beans={beans}
      learningLogs={learningLogs}
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
      nextShiftLabel={nextShiftLabel}
      onChangeShift={() => changeShift(true)}
      onUpdateCoefficient={(bayId, coefficient) =>
        setBaristas((prev) =>
          prev.map((barista) =>
            barista.id === bayId ? { ...barista, coefficient } : barista,
          ),
        )
      }
      onResetLearning={handleResetData}
      onUpdateBean={(updated) =>
        setBeans((prev) =>
          prev.map((bean) => (bean.code === updated.code ? updated : bean)),
        )
      }
      onAddBean={(newBean) => setBeans((prev) => [newBean, ...prev])}
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
