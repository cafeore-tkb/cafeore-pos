import {
  CAOS_NEXT_COOLDOWN_SEC,
  type CaosBoardCup,
  type CaosCard,
  type CaosLane,
  type CaosOrderInput,
  type CaosPlace,
  type CaosWritesResult,
  type PracticeDataOrder,
  assignWrites,
  caosDayOrders,
  caosLane,
  caosLateMerge,
  caosMergePair,
  caosNextLocked,
  caosRebrewMergePair,
  caosRebrewsTogether,
  dripperLabel,
  jstClock,
  jstDate,
  mergeWrites,
  moveQueueWrites,
  nonSeniorMerge,
  nonSeniorPlacement,
  seniorOnlyOffSenior,
  splitWrites,
  unassignWrites,
  useColorSettings,
  useItemMaster,
} from "@cafeore/common";
import { useCallback, useLayoutEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  type EmergencyCup,
  toastEmergenciesAdded,
  toastEmergenciesCancelled,
  useCupEmergency,
} from "~/components/functional/useCupEmergency";
import { useCurrentTime } from "~/components/functional/useCurrentTime";
import { orderBacklog } from "../logic/alerts";
import { waitingCupsByBean } from "../logic/beans";
import type { CardBoardAction } from "../logic/cardActions";
import {
  cardLooks,
  orderAndCupCounts,
  orderLabel,
  orderNoLabel,
} from "../logic/cards";
import { commentsByOrder } from "../logic/comments";
import { testPlayRemainingLabel } from "../logic/historical";
import { boardLanes } from "../logic/lanes";
import { earlyNext, nextAvailableBays } from "../logic/queue";
import { runCardAction } from "../logic/runCardAction";
import { soundManager } from "../utils/audio";
import { caosLog, logCaosAsync } from "../utils/log";
import { useBeanInventory } from "./useBeanInventory";
import { useCaosLanes } from "./useCaosLanes";
import { useCaosOutboxSender } from "./useCaosOutbox";
import { useCaosStateLog } from "./useCaosStateLog";
import { type NextStart, useCornerToasts } from "./useCornerToasts";
import { useLastAction } from "./useLastAction";
import { useLiveBoard } from "./useLiveBoard";
import { usePracticeData } from "./usePracticeData";
import { useTestPlay } from "./useTestPlay";

// 実データを読み込んでいないとき
const NO_ORDERS: PracticeDataOrder[] = [];

// 実データテストの時計の速さ（ヘッダーで押すたびに次へ）。テストは最も速い 10x で始める
const SIM_SPEEDS = [1, 2, 5, 10];
const TEST_START_SPEED = SIM_SPEEDS[SIM_SPEEDS.length - 1];

// 新しいカード（dripId）の ID
const newDripId = () => crypto.randomUUID();

// 押したカードが、もう盤面に無いとき（ほかの端末で動いた・注文が消えた）
const NOT_FOUND = "カードが見つかりません";

// 緊急（入れ直し）を足す・取り消す（本番は API と印刷、実データテストは練習の盤面の中だけ）。
// 足したら入れ直しの id、取り消したら true を返し、断られたら null・false。label は「直前の操作」に出す操作の名前
type EmergencyOps = {
  /** 番号から入れ直すカップを選ぶ注文 */
  orders: readonly CaosOrderInput[];
  add: (
    cups: EmergencyCup<CaosOrderInput>[],
    reason: string,
  ) => Promise<string[] | null>;
  cancel: (cups: CaosBoardCup[], label: string) => boolean;
};

// 操作を断った理由を POS の通知で出す
const fail = (error: string) => {
  caosLog("operation.rejected", { error });
  toast.error(error);
  return false;
};

// CaOS の盤面・時刻・実データテストをまとめる。画面（App）はこれを呼んで部品に渡すだけ。
// 普段は cafeore-pos の注文で動かす（useLiveBoard。盤面は注文のカップの列にあり、操作は API に書いて全部の iPad で共有する）。
// 実データテスト中（終了後の実績表示も含め、リセットするまで）は cafeore-pos の注文を使わず、練習の盤面（useTestPlay）で動かす。
// どちらもカードは @cafeore/common の buildCaosCards で組み立てた CaosCard、操作の書き込みは @cafeore/common の
// assignWrites・unassignWrites・mergeWrites で同じ。違うのは送り先だけ。
export const useCaosSession = () => {
  const [isRunning, setIsRunning] = useState(true);
  const [simSpeed, setSimSpeed] = useState(TEST_START_SPEED);
  const [soundEnabled, setSoundEnabled] = useState(soundManager.enabled);
  const stopRunning = useCallback(() => {
    caosLog("practice.finished", { source: "time-up" });
    setIsRunning(false);
  }, []);

  // 実データテストの注文。過去の注文データは同梱せず、テストプレイの画面で手元の JSON を読み込む
  // （ブラウザの中で練習に使う項目だけを写す。API には書かないので、本番の盤面・注文・在庫には混ざらない）。
  const practiceData = usePracticeData();
  const { itemTypes } = useItemMaster();
  const test = useTestPlay({
    historicalOrders: practiceData.dataset?.orders ?? NO_ORDERS,
    itemTypes,
    isRunning,
    simSpeed,
    onTimeUp: stopRunning,
  });
  const realTime = useCurrentTime(1000);
  const live = useLiveBoard({
    enabled: !test.session,
    nowMs: realTime.getTime(),
  });
  const source = test.session ? test : live;
  // ドリッパーの担当者（サーバーの今日の担当者）。本番では、指名の無い上級生のみのカードを上級生でない担当者のドリッパーに置いたら知らせ、カードに警告の印を出す（止めない）
  const { lanes: people } = useCaosLanes();
  const { colorSettings } = useColorSettings();
  const { beanIndex, ...beanStock } = useBeanInventory();
  // 緊急（入れ直し）と、そのシールを刷るこの端末のプリンター
  const { printer: labelPrinter, addEmergency } = useCupEmergency(caosLog);
  useCaosStateLog("printer.state.changed", {
    status: labelPrinter.status,
    pendingCount: labelPrinter.pendingCount,
  });
  const lastAction = useLastAction();
  // 押し間違いかもしれない「次へ」（抽出時間の半分もたっていない）は右上で確かめてから送る。
  // 抽出を始めてから時間のたったカードへの統合（caosLateMerge）と、上級生のみのカードを上級生でない担当者に置いたのは、
  // 止めずにそのまま書き、同じ所に知らせだけ出す
  const toasts = useCornerToasts(realTime.getTime());
  // この端末の送れていない操作を送る（実データテスト中も、テストの前に押した本番の操作は送る）。
  // 通らなかった操作は「直前の操作」から忘れ、その操作の右上の知らせも消す（盤面は戻っているので）
  const unsent = useCaosOutboxSender(realTime.getTime(), (entry) => {
    lastAction.forget(entry);
    toasts.forgetOp(entry);
  });

  // 今（エポックのミリ秒）。テスト中は練習の時計
  const { cards } = source;
  const nowMs = test.session?.currentMs ?? realTime.getTime();

  const lanes = useMemo(() => boardLanes(cards), [cards]);
  const unassigned = useMemo(
    () => cards.filter((card) => card.status === "unassigned"),
    [cards],
  );
  // 本番の今日の注文のコメント（実データテスト中と、注文が届くまでは null）
  const today = jstDate(realTime.getTime());
  const comments = useMemo(
    () =>
      live.orders ? commentsByOrder(caosDayOrders(live.orders, today)) : null,
    [live.orders, today],
  );
  const testing = Boolean(test.session);
  const looks = useMemo(
    () =>
      cardLooks(
        cards,
        colorSettings,
        beanIndex,
        comments,
        // 練習には担当者がいないので出さない
        (card) => !testing && seniorOnlyOffSenior(card, people),
      ),
    [cards, colorSettings, beanIndex, comments, testing, people],
  );
  // 豆残量確認に出す、盤面で待っている杯数（豆ごと）。実データテスト中は出さない
  const beanWaitingCups = useMemo(
    () => (test.session ? undefined : waitingCupsByBean(cards, beanIndex)),
    [cards, beanIndex, test.session],
  );

  // 画面のカードのキーから、今の盤面のカードを引く
  const cardOf = (key: string) => cards.find((card) => card.key === key);
  // 本番で、指名の無い上級生のみのカードを上級生でない担当者のドリッパーに置いたら、置いたうえで右上に知らせる（実データテストには担当者がいない。
  // 担当者のいないドリッパーは知らせず、警告の印だけ。nonSeniorPlacement）。placed はまとめて移したときは何枚も（知らせは 1 つ）。
  // 知らせには置いた操作の id を付ける（断られたら知らせも消す。liveIds。書いた直後に呼ぶ）
  const noticeNonSenior = (placed: CaosCard[], lane: CaosLane | null) => {
    if (lane && placed.length > 0 && !testing)
      toasts.show({ kind: "seniorOnly", cards: placed, lane }, liveIds());
  };
  // 通った操作で端末に残した操作の id（本番だけ。通らなかったら「直前の操作」から忘れる）
  const liveIds = () => (test.session ? [] : live.lastEnqueued());
  // 操作が通ったら（練習も本番も押したときの盤面で決まる。本番の書き込みは後ろで送る）play で音を鳴らし、「直前の操作」に label を覚える。
  // 断られたら何もしない。通ったかを返す
  const onSuccess = (ok: boolean, label: string, play: () => void) => {
    if (ok) {
      // 音は盤面を描いてから鳴らす（初めて鳴らすときの音の準備で、盤面が変わるのを待たせない）
      setTimeout(play);
      lastAction.remember(label, liveIds());
    }
    return ok;
  };
  // 「次へ」を送る（seen は終えるカード、start は終えたあとに始めるもの）。未着手のカードを ▶ で始めるときは、そのカードが待機の先頭でなければ（ほかの端末で入れ替わった）先に待機の先頭へ動かす
  // （同じ 1 つの操作として端末に残す）。書けたら音を鳴らし、「直前の操作」に覚える
  const runNext = (bayId: number, seen: string | null, start: NextStart) => {
    const { brewing, queued } = caosLane(cards, bayId);
    const head = queued[0];
    const card =
      typeof start === "object"
        ? queued.find((other) => other.key === start.key)
        : start === "head"
          ? head
          : undefined;
    if (typeof start === "object" && !card) return fail(NOT_FOUND);
    const moved =
      card && card !== head
        ? assignWrites(cards, card, bayId, {
            place: "queueFront",
            newId: newDripId,
          })
        : { writes: [] };
    if ("error" in moved) return fail(moved.error);
    const label =
      typeof start === "object" && card
        ? `始める ${orderLabel(card)}`
        : start === "none" && brewing
          ? `終える ${orderLabel(brewing)}`
          : `次へ ${dripperLabel(bayId)}`;
    return onSuccess(
      source.runNext(
        {
          dripper: bayId,
          dripId: seen,
          startId: card?.dripId ?? null,
          startNext: start !== "none",
          // 押したカードを始めるときは、送る前にそれが待機の先頭かを確かめる（先頭へ動かすのが通らなかったら、ほかのカードを始めない）
          ...(moved.writes.length > 0 && { startPressed: true }),
        },
        label,
        moved.writes,
      ),
      label,
      () => soundManager.playComplete(),
    );
  };
  // 抽出中のカードを終える操作（カードの ✓・✋）。始めてから 10 秒は終えられず、
  // 抽出時間の半分もたっていなければ（隣の列の押し間違いかもしれない）すぐには送らず右上で確かめる
  const endBrewing = (bayId: number, start: NextStart) => {
    const lane = lanes.find((l) => l.id === bayId);
    if (!lane) return;
    if (caosNextLocked(lane.brewing, nowMs)) {
      fail(`始めてから ${CAOS_NEXT_COOLDOWN_SEC} 秒は終えられません`);
      return;
    }
    const early = earlyNext(lane, nowMs);
    if (early) toasts.show({ kind: "next", bayId, start, ...early });
    else runNext(bayId, lane.brewing?.dripId ?? null, start);
  };
  // 統合（firstKey のカードを intoKey のカードへ。firstKey が抽出中なら逆向き。caosMergePair）。どれだけ前に抽出を始めたカードへも統合し、
  // 始めてから時間がたっていれば（caosLateMerge）、統合したあとに右上で知らせる（向きを決めたあとのカードで出す）
  const runMerge = (firstKey: string, intoKey: string) => {
    caosLog("board.merge.requested", {
      firstKey,
      intoKey,
      mode: testing ? "practice" : "live",
    });
    const first = cardOf(firstKey);
    const second = cardOf(intoKey);
    if (!first || !second) return fail(NOT_FOUND);
    // 統合できなければ、そのまま mergeWrites が断る
    const { card, into } = caosMergePair(first, second) ?? {
      card: first,
      into: second,
    };
    const label = `統合 ${orderLabel(card)} → ${orderLabel(into)}`;
    if (!write(mergeWrites(card, into, newDripId), label)) return false;
    const elapsedSec = caosLateMerge(into, nowMs);
    if (elapsedSec !== null)
      toasts.show({ kind: "lateMerge", card, into, elapsedSec }, liveIds());
    noticeNonSenior([card], nonSeniorMerge(card, into, people));
    return true;
  };
  // 書き込みを送る（作れなかったら理由を POS の通知で出す。書けたら音を鳴らす）。label は「直前の操作」に出す操作の名前
  const write = (result: CaosWritesResult, label: string) => {
    if ("error" in result) return fail(result.error);
    // 今と同じ場所に置き直したなど、変わるものが無ければ送らず、音も鳴らさない
    if (result.writes.length === 0) return true;
    return onSuccess(source.runWrites(result.writes, label), label, () =>
      soundManager.playDispatch(),
    );
  };

  // 統合したカードから全部の杯を入れ直した（caosRebrewsTogether）ときの、足した入れ直しの id（1 回の入れ直しごとに 1 組。続けて入れ直せば組が並ぶ）。
  // 組の全部が盤面に届いたら、元のカードと同じ組み合わせの 1 枚のカードにまとめる（本番は足した応答の前にも後にも WebSocket で届くので、盤面が変わるたびに見る。
  // 足せた入れ直しはサーバーにあるので、つなぎ直して遅れて届いても、どちらもまだ未割当の 1 杯のカードならまとめる。まとめるのは「直前の操作」に出さない）
  const [rebrewsToMerge, setRebrewsToMerge] = useState<string[][]>([]);
  const mergeRebrews = (ids: string[]) =>
    setRebrewsToMerge((groups) => [...groups, ids]);
  useLayoutEffect(() => {
    if (rebrewsToMerge.length === 0) return;
    const waiting: string[][] = [];
    for (const ids of rebrewsToMerge) {
      const pair = caosRebrewMergePair(cards, ids);
      if (pair === "arriving") {
        waiting.push(ids);
        continue;
      }
      if (!pair) continue;
      const result = mergeWrites(pair.card, pair.into, newDripId);
      if ("writes" in result)
        source.runWrites(
          result.writes,
          `統合 ${orderLabel(pair.card)} → ${orderLabel(pair.into)}`,
        );
    }
    if (waiting.length < rebrewsToMerge.length) setRebrewsToMerge(waiting);
  }, [cards, rebrewsToMerge, source]);

  // 本番と実データテストを行き来するときに、覚えている操作（「直前の操作」・右上の確かめ・知らせ・入れ直しのまとめ）を忘れる
  const forgetPending = () => {
    lastAction.forget();
    toasts.clear();
    setRebrewsToMerge([]);
  };

  // 本番の緊急のカップに、刷るための POS の注文を付ける（本番のカードと入力は POS の注文から作るので、注文はある。無ければ null）
  const withPosOrder = (cups: { orderId: string; cupId: string }[]) => {
    const found = cups.flatMap((cup) => {
      const order = live.orders?.find((o) => o.id === cup.orderId);
      return order ? [{ ...cup, order }] : [];
    });
    return found.length === cups.length ? found : null;
  };
  const emergencyOps: EmergencyOps = test.session
    ? {
        // 練習の盤面の中だけ（足したときの知らせは、本番は addEmergency がマスターと同じく出すので、練習もここで出す）
        orders: test.arrivedOrders,
        add: async (cups, reason) => {
          const ids = test.addEmergencies(
            cups.map((cup) => cup.cupId),
            reason,
          );
          if (ids) toastEmergenciesAdded(ids.length);
          return ids;
        },
        cancel: (cups) => test.cancelEmergencies(cups.map((cup) => cup.id)),
      }
    : {
        orders: live.orders ?? [],
        add: async (cups, reason) => {
          const pos = withPosOrder(
            cups.map(({ order, cupId }) => ({ orderId: order.id, cupId })),
          );
          if (!pos) {
            fail(NOT_FOUND);
            return null;
          }
          return addEmergency(pos, reason);
        },
        // 画面はすぐ変わり、送るのは後ろで（取り消せたらこの端末に残っているシールも消す）
        cancel: (cups, label) =>
          live.cancelEmergencies(
            cups.map((cup) => cup.id),
            label,
          ),
      };

  return {
    /** 盤面のカード（@cafeore/common の buildCaosCards） */
    cards,
    /** 6 列のドリッパー（終わり・抽出中・待機） */
    lanes,
    /** 未割当（注文番号の順） */
    unassigned,
    /** カードの色・豆・コメントと、分けた注文の中の位置 */
    looks,
    /** 本番の今日の注文のコメント（注文ごと）。実データテスト中と、注文が届くまでは null */
    comments,
    nextAvailable: nextAvailableBays(lanes, nowMs),
    /** ヘッダーの注文の数と杯数（未割当・ドリッパーに置いてまだ始めていない待機。抽出中は数えない） */
    counts: {
      unassigned: orderAndCupCounts(unassigned),
      waiting: orderAndCupCounts(lanes.flatMap((lane) => lane.queued)),
    },
    /** 抽出を始めていない注文の待ち（いちばん古い未割当・LATE_ORDER_SEC を超えた注文） */
    backlog: orderBacklog(cards, nowMs),
    /** 今（エポックのミリ秒。テスト中は練習の時計） */
    nowMs,
    /** ヘッダーの時刻（日本時間の「10:05:09」） */
    timeLabel: jstClock(nowMs),
    /** 豆残量確認に出す POS の在庫（豆だけ）と、盤面で待っている杯数。実データテスト中は本物の在庫に記録させない */
    beans: {
      ...beanStock,
      waitingCups: beanWaitingCups,
      onRecorded: test.session ? undefined : beanStock.onRecorded,
    },
    /** 実データテストの時計（一時停止・速さ・やめる）を出すか。本番の盤面は実時間なので出さない */
    simulating: Boolean(test.session),
    isRunning,
    toggleRunning: () => {
      caosLog("practice.running.changed", {
        running: !isRunning,
        simulatedAt: nowMs,
      });
      setIsRunning(!isRunning);
    },
    simSpeed,
    cycleSpeed: () => {
      caosLog("practice.speed.changed", {
        before: simSpeed,
        after:
          SIM_SPEEDS[(SIM_SPEEDS.indexOf(simSpeed) + 1) % SIM_SPEEDS.length],
      });
      setSimSpeed(
        (speed) =>
          SIM_SPEEDS[(SIM_SPEEDS.indexOf(speed) + 1) % SIM_SPEEDS.length],
      );
    },
    posStatus: live.status,
    /** この端末のシールのプリンター（つながっているか・証明書を許可するページ・刷れずに残っているシールの数と、送り直し） */
    labelPrinter: {
      ...labelPrinter,
      retry: () => {
        caosLog("printer.retry");
        labelPrinter.retry();
      },
    },
    /** この端末のまだ送れていない盤面の操作の数と、今すぐ送り直す */
    unsent,
    /**
     * 緊急（入れ直し）。本番は API に書いてシールを刷り、実データテスト中は練習の盤面の中だけ（刷らない。emergencyOps）
     *   - orders：番号から入れ直すカップを選ぶ注文
     *   - add：入れ直しを足す。入れ直しのカードが未割当のいちばん上に出る（統合したカードから全部の杯を入れ直せば、元のカードと同じ組み合わせの 1 枚）
     *   - cancel：入れ直しのカード（未割当・待機）の入れ直しを取り消す
     * どちらも「直前の操作」に出す
     */
    emergency: {
      orders: emergencyOps.orders,
      add: async (cups: EmergencyCup<CaosOrderInput>[], reason: string) => {
        const nos = new Set(cups.map((cup) => cup.order.orderId));
        const label = `緊急 ${[...nos].map((no) => `#${orderNoLabel(no)}`).join("・")}`;
        const together = caosRebrewsTogether(
          cards,
          cups.map((cup) => cup.cupId),
        );
        const ids = await logCaosAsync(
          "emergency.add",
          {
            mode: testing ? "practice" : "live",
            simulatedAt: testing ? nowMs : undefined,
            reason,
            cups: cups.map(({ order, cupId }) => ({
              orderId: order.id,
              orderNo: order.orderId,
              cupId,
            })),
          },
          () => emergencyOps.add(cups, reason),
        );
        if (!ids) return null;
        if (together) mergeRebrews(ids);
        lastAction.remember(label, []);
        return ids;
      },
      cancel: (card: CaosCard) => {
        const label = `緊急の取り消し ${orderLabel(card)}`;
        const cups = card.cups.filter((cup) => cup.emergency);
        caosLog("emergency.cancel.requested", {
          mode: testing ? "practice" : "live",
          cupIds: cups.map((c) => c.cupId),
          unitIds: cups.map((c) => c.id),
          orderIds: cups.map((c) => c.orderId),
        });
        if (!emergencyOps.cancel(cups, label)) {
          caosLog("emergency.cancel.rejected", { label });
          return;
        }
        caosLog("emergency.cancel.accepted", {
          label,
          unitIds: cups.map((c) => c.id),
          mode: testing ? "practice" : "live",
        });
        toastEmergenciesCancelled(cups.length);
        lastAction.remember(label, liveIds());
      },
    },
    soundEnabled,
    toggleSound: () => {
      caosLog("sound.changed", { enabled: !soundEnabled });
      soundManager.enabled = !soundEnabled;
      setSoundEnabled(!soundEnabled);
    },
    /** 割当・ドリッパーの移動・順番の入れ替え（place は @cafeore/common の CaosPlace：列の先頭（今から始まる）・待機の先頭・カードの前後。無ければ最後）。抽出中のカードも動かせる。順番の数はサーバー（練習なら練習の盤面）が決める */
    place: (key: string, bayId: number, place?: CaosPlace) => {
      caosLog("board.place.requested", {
        key,
        bayId,
        place,
        mode: testing ? "practice" : "live",
      });
      const card = cardOf(key);
      if (!card) return fail(NOT_FOUND);
      const action =
        card.status === "unassigned"
          ? "割当"
          : card.dripper === bayId
            ? "並べ替え"
            : "移動";
      const label = `${action} ${orderLabel(card)} → ${dripperLabel(bayId)}`;
      const ok = write(
        assignWrites(cards, card, bayId, { place, newId: newDripId }),
        label,
      );
      if (ok) noticeNonSenior([card], nonSeniorPlacement(card, bayId, people));
      return ok;
    },
    /** 待機・抽出中のカードを未割当に戻す */
    returnToUnassigned: (key: string) => {
      caosLog("board.unassign.requested", {
        key,
        mode: testing ? "practice" : "live",
      });
      const card = cardOf(key);
      if (!card) return fail(NOT_FOUND);
      return write(unassignWrites(card), `未割当に戻す ${orderLabel(card)}`);
    },
    /** 1 杯のカード（firstKey）を、もう 1 枚の 1 杯のカード（intoKey）に入れて 2 杯の同時抽出にまとめる（intoKey の場所のまま。firstKey が抽出中なら逆向き） */
    merge: runMerge,
    /** 統合の解除：統合したカードから cupId の 1 杯を外して未割当に戻す */
    split: (key: string, cupId: string) => {
      caosLog("board.split.requested", {
        key,
        cupId,
        mode: testing ? "practice" : "live",
      });
      const card = cardOf(key);
      const cup = card?.cups.find((c) => c.id === cupId);
      if (!card || !cup) return fail(NOT_FOUND);
      return write(
        splitWrites(card, cupId),
        `外す #${orderNoLabel(cup.orderNo)}`,
      );
    },
    /** ドリッパー from の待機を全部 to へ（指名で置けないカードは残して知らせる。上級生のみのカードは移して知らせる） */
    moveQueue: (from: number, to: number) => {
      caosLog("board.move-queue.requested", {
        from,
        to,
        mode: testing ? "practice" : "live",
      });
      const result = moveQueueWrites(cards, from, to);
      if ("kept" in result && result.kept > 0)
        toast(
          `指名で ${dripperLabel(to)} に置けないカード ${result.kept} 枚は残しました`,
        );
      const label = `まとめて移す ${dripperLabel(from)} → ${dripperLabel(to)}`;
      const ok = write(result, label);
      // 上級生でない担当者のドリッパーへ移した上級生のみのカードは、まとめて 1 つの知らせに（担当者は移す先の 1 人）
      if (ok && "moved" in result) {
        const lane = people.find((l) => l.dripper === to) ?? null;
        noticeNonSenior(
          result.moved.filter((card) => nonSeniorPlacement(card, to, people)),
          lane,
        );
      }
      return ok;
    },
    /**
     * カードの上のアイコンの操作（logic/cardActions）。
     *   - start（▶）：未着手のカードを始める（「次へ」。抽出中があれば断る）
     *   - finish（✓）：抽出中のカードを終え、待機の先頭を始める（「次へ」）
     *   - unstart（✋）：着手後60秒未満のカードを未着手に戻す
     *   - assign:1〜6・unassign：未着手のカードを再割当・未割当に戻す
     * 終える操作は「次へ」と同じ押し間違いの決まり（endBrewing）。押したときの盤面とカードの段階が違えば断る
     */
    runCardAction: (pressed: CaosCard, action: CardBoardAction) =>
      runCardAction(cards, pressed, action, nowMs, {
        write,
        fail,
        newId: newDripId,
        onAssigned: (card, bayId) =>
          noticeNonSenior([card], nonSeniorPlacement(card, bayId, people)),
        start: (bayId, key) => runNext(bayId, null, { key }),
        finish: (bayId) => endBrewing(bayId, "head"),
      }),
    /** 右上の確かめ（「次へ」）と知らせ（時間のたったカードへの統合・上級生のみのカードを上級生でない担当者に置いた）。新しいものが先 */
    cornerToasts: toasts.open,
    /** 確かめた「次へ」を送る（確かめたカードを終える。そのあいだに終わっていれば断られる） */
    confirm: (id: string) => {
      const asked = toasts.take(id);
      caosLog("confirmation.confirmed", {
        id,
        available: Boolean(asked),
        kind: asked?.kind,
      });
      if (asked?.kind === "next")
        runNext(asked.bayId, asked.card.dripId, asked.start);
    },
    /** 右上の確かめ・知らせを閉じる（確かめはやめる） */
    dismissToast: toasts.dismiss,
    /** 「直前の操作」（この画面が最後にした操作の名前。しばらくたつと null） */
    lastAction: lastAction.label,
    /** 実データテストをやめて cafeore-pos の盤面に戻る（練習の盤面は捨てる。本番のカップは触らない） */
    reset: () => {
      caosLog("practice.reset");
      forgetPending();
      test.clear();
      setIsRunning(true);
      soundManager.playDispatch();
    },
    testPlay: {
      isActive: test.session?.status === "active",
      /** テストを終えて、実績を見ている（盤面はまだテストのまま） */
      finished: test.session?.status === "finished",
      /** 残り（「12分」）。テストをしていなければ null */
      remainingLabel: test.session
        ? testPlayRemainingLabel(test.session)
        : null,
      /** 実績のパネルに渡すもの */
      analytics: {
        salesOrders: test.salesOrders,
        periodStartMs: test.session?.startMs,
        periodEndMs: test.session?.currentMs,
      },
      /** 読み込んだ実データ（テストプレイの画面で選ぶ） */
      practiceData,
      start: (startMs: number, durationMinutes: 30 | 60) => {
        caosLog("practice.started", {
          startMs,
          durationMinutes,
          speed: TEST_START_SPEED,
        });
        forgetPending();
        test.start(startMs, durationMinutes);
        setIsRunning(true);
        setSimSpeed(TEST_START_SPEED);
      },
      finish: () => {
        caosLog("practice.finished", { simulatedAt: nowMs, source: "manual" });
        test.finish();
        setIsRunning(false);
      },
    },
  };
};
