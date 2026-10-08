import {
  CHANGEOVER_SEC,
  type CaosWritesResult,
  FIRST_START_DELAY_SEC,
  IMMINENT_SEC,
  STANDBY_LABEL,
  assignWrites,
  brewDurationLabel,
  brewDurationSec,
  buildCaosCards,
  caosDay,
  formatClockOfDay,
  formatMinSec,
  formatRemainingLabel,
  mergeWrites,
  nextCaosDripper,
  putCaosCups,
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
import { cardsToBoard } from "./live/board";
import type {
  Barista,
  HistoricalDataset,
  HistoricalOrder,
  OrderTicket,
  TestPlaySession,
  UnassignedOrder,
} from "./types";
import { soundManager } from "./utils/audio";
import { makeLaneBaristas } from "./utils/lanes";
import {
  arrangeQueue,
  canMergeDripUnits,
  orderNumber,
  queueWaitSeconds,
  splitIntoDripUnits,
  ticketKey,
} from "./utils/orderQueue";

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

// 実データテストの盤面の秒の起点（端末の時刻帯の 0 時）。テストは CaOS9（練習の盤面）で作り直すので、ここは触らない。
// 普段の盤面（cafeore-pos の盤面）は、サーバーの営業日と同じ日本時間の 0 時を起点にする（startOfJstDay）
const startOfLocalDay = (ms: number) => {
  const date = new Date(ms);
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  ).getTime();
};

// 実データテスト（2025年の注文。商品 ID が無い）のカードのまとめ方。盤面のカードには使わない。
// 練習の盤面（CaOS9）で作り直すので、それまでここだけに残す
type HistoricalGroup =
  | "CHAMP"
  | "ORE"
  | "TNZ"
  | "KEN"
  | "BRA"
  | "ICE"
  | "MILK"
  | "SP";
const historicalBeanCode = (name: string, type: string): HistoricalGroup => {
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
  const grouped = new Map<
    HistoricalGroup,
    { names: string[]; count: number }
  >();
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
    ([groupKey, group], index): UnassignedOrder => ({
      id,
      ticketUid: `history-${order.orderId}-${groupKey}-${index}`,
      itemKey: `history-${groupKey}`,
      beanName: group.names.join("・"),
      cupCount: group.count,
      badgeTag: `${group.count}杯`,
      predictedTimeStr: brewDurationLabel(group.count),
      recommendedBaristas: "全ドリッパー",
      recommendedBayIds: [1, 2, 3, 4, 5, 6],
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
    () => standaloneSnapshot?.baristas || makeLaneBaristas(),
  );
  const [unassignedOrders, setUnassignedOrders] = useState<UnassignedOrder[]>(
    [],
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

  // 普段は cafeore-pos の注文で動かす。盤面は注文のカップの列（ドリッパー・順番・カード・抽出の時刻）で持つので、
  // 共有の WebSocket の注文から今日（日本時間）のカードを組み立てる。操作はカップに書く（PUT /api/caos/cups・「次へ」）。
  // 書いた注文は全部の画面に配られるので、複数の iPad で同じものを見て操作できる。
  // 実データテスト中（終了後の実績表示も含め、リセットするまで）は注文を使わず、テストの注文だけで手元の盤面を動かす。
  const live = !testPlaySession;
  const { orders: posOrders, status: posStatus } = usePosOrders(live);
  const today = caosDay(realTime);
  const liveCards = useMemo(
    () => buildCaosCards(posOrders ?? [], today),
    [posOrders, today],
  );
  // カードの色をマスターの画面と同じにするための色の設定（POS の色の設定の API）
  const { colorSettings } = useColorSettings(live);
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
        realDayStartMs,
        colorSettings,
        beanIndex,
      ),
    [
      liveCards,
      baristas,
      realTimeSec,
      realDayStartMs,
      colorSettings,
      beanIndex,
    ],
  );
  const boardBaristas = live ? liveBoard.baristas : baristas;
  const boardUnassignedOrders = live
    ? liveBoard.unassignedOrders
    : unassignedOrders;
  // 「次へ」を送っている途中の列（応答が届く前の二度押しを止める）
  const pendingNextRef = useRef(new Set<number>());
  const [liveError, setLiveError] = useState<string | null>(null);

  useEffect(() => {
    if (!liveError) return;
    const timer = window.setTimeout(() => setLiveError(null), 5000);
    return () => window.clearTimeout(timer);
  }, [liveError]);

  // カップへの書き込みを送る。断られたら（決まりに合わない・ほかの端末が先に書いた）理由を出す。
  // 結果は書いた注文の配信で届く。豆の在庫は POS の在庫（注文から数える）なので、ここでは減らさない
  const runWrites = async (result: CaosWritesResult) => {
    if ("error" in result) {
      setLiveError(result.error);
      return;
    }
    const { error } = await putCaosCups(result.writes);
    if (error) setLiveError(error);
  };
  // 画面のカード（ticketUid）から、組み立てたカードを引く
  const liveCard = (ticketUid: string | undefined) =>
    ticketUid ? liveBoard.cards.get(ticketUid) : undefined;
  const newDripId = () => crypto.randomUUID();

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
    setUnassignedOrders((prev) => [...prev, ...incoming]);
  }, [testPlayCurrentMs, testPlayOrders, testPlayStatus]);

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
      const card = liveCard(orderToAssign.ticketUid);
      if (!card) return;
      void runWrites(
        assignWrites(liveCards, card, targetBayId, { newId: newDripId }),
      );
      return;
    }

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
      itemKey: orderToAssign.itemKey,
      beanName: orderToAssign.beanName,
      cupCount: orderToAssign.cupCount,
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

  // 待機のカードを別のドリッパーへ。toFront なら、そのドリッパーの待機の先頭へ（同じドリッパーの中の順番の入れ替えにも使う）
  const handleMoveScheduledTicket = (
    ticket: OrderTicket,
    targetBayId: number,
    toFront?: boolean,
  ) => {
    if (ticket.status !== "scheduled") return;
    if (ticket.preferredBaristaId && ticket.preferredBaristaId !== targetBayId)
      return;
    if (live) {
      const card = liveCard(ticket.ticketUid);
      if (!card) return;
      void runWrites(
        assignWrites(liveCards, card, targetBayId, {
          index: toFront ? 0 : undefined,
          newId: newDripId,
        }),
      );
      setSelectedOrderId(null);
      soundManager.playDispatch();
      return;
    }
    // 実データテストの盤面は注文番号の順に並べるので、順番の入れ替えはしない
    if (toFront) return;
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

  const handleReturnScheduledTicket = (ticket: OrderTicket) => {
    if (ticket.status !== "scheduled") return;
    if (live) {
      const card = liveCard(ticket.ticketUid);
      if (!card) return;
      void runWrites(unassignWrites(card));
      setSelectedOrderId(null);
      soundManager.playDispatch();
      return;
    }
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
        itemKey: ticket.itemKey,
        beanName: ticket.beanName,
        cupCount: ticket.cupCount,
        badgeTag: `${ticket.cupCount}杯`,
        predictedTimeStr: brewDurationLabel(ticket.cupCount),
        recommendedBaristas: ticket.preferredBaristaId
          ? `ドリッパー ${ticket.preferredBaristaId}`
          : "全ドリッパー",
        recommendedBayIds: ticket.preferredBaristaId
          ? [ticket.preferredBaristaId]
          : [1, 2, 3, 4, 5, 6],
        preferredBaristaId: ticket.preferredBaristaId,
      },
      ...prev,
    ]);
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
    if (live) {
      const card = liveCard(firstUid);
      const withCard = liveCard(secondUid);
      if (!card || !withCard) return;
      void runWrites(mergeWrites(card, withCard, newDripId));
      setSelectedOrderId(null);
      return;
    }
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
    setBaristas(makeLaneBaristas());
    setUnassignedOrders([]);
    setSelectedOrderId(null);
    setSelectedTicketKey(null);
    setAssignSlotData(null);
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
    setBaristas(makeLaneBaristas());
    setUnassignedOrders([]);
    setSelectedOrderId(null);
    setSelectedTicketKey(null);
    setAssignSlotData(null);
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
