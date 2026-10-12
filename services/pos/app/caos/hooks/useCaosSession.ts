import {
  type CaosBoardCup,
  type CaosCard,
  type CaosOrderInput,
  type CaosPlace,
  type CaosWritesResult,
  type PracticeDataOrder,
  assignWrites,
  caosLateMerge,
  dripperLabel,
  jstClock,
  mergeWrites,
  moveQueueWrites,
  seniorOnlyBlock,
  seniorOnlyMergeBlock,
  splitWrites,
  unassignWrites,
  undoOfNext,
  undoOfWrites,
  useColorSettings,
  useItemMaster,
} from "@cafeore/common";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  type EmergencyCup,
  toastEmergenciesAdded,
  toastEmergenciesCancelled,
  useCupEmergency,
} from "~/components/functional/useCupEmergency";
import { useCurrentTime } from "~/components/functional/useCurrentTime";
import { waitingCupsByBean } from "../logic/beans";
import { cardLooks, orderLabel, orderNoLabel, totalCups } from "../logic/cards";
import { testPlayRemainingLabel } from "../logic/historical";
import { boardLanes, laneActive } from "../logic/lanes";
import { earlyNext, nextAvailableBays } from "../logic/queue";
import { soundManager } from "../utils/audio";
import { useBeanInventory } from "./useBeanInventory";
import { useCaosLanes } from "./useCaosLanes";
import { type UndoRun, useCaosUndo } from "./useCaosUndo";
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
// 足した・取り消したら「1つ戻す」の処理を返し、断られたら null
type EmergencyOps = {
  /** 番号から入れ直すカップを選ぶ注文 */
  orders: readonly CaosOrderInput[];
  add: (
    cups: EmergencyCup<CaosOrderInput>[],
    reason: string,
  ) => Promise<{ ids: string[]; undo: UndoRun } | null>;
  cancel: (cups: CaosBoardCup[]) => Promise<UndoRun | null>;
};

// 操作を断った理由を POS の通知で出す
const fail = (error: string) => {
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
  // 押し間違いかもしれない「次へ」（抽出時間の半分もたっていない）。確かめてから進める
  const [nextConfirm, setNextConfirm] = useState<
    ({ bayId: number } & NonNullable<ReturnType<typeof earlyNext>>) | null
  >(null);
  // 抽出を始めてから時間のたったカードへの統合（caosLateMerge）。確かめてから統合する
  const [mergeConfirm, setMergeConfirm] = useState<{
    card: CaosCard;
    into: CaosCard;
    elapsedSec: number;
  } | null>(null);
  const stopRunning = useCallback(() => setIsRunning(false), []);

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
  // ドリッパーの担当者（サーバーの今日の担当者）。本番では、指名の無い上級生のみのカードは上級生のドリッパーにしか置けない（サーバーも確かめる）
  const { lanes: people } = useCaosLanes();
  const { colorSettings } = useColorSettings();
  const { beanIndex, ...beanStock } = useBeanInventory();
  // 緊急（入れ直し）と、そのシールを刷るこの端末のプリンター
  const {
    printer: labelPrinter,
    addEmergency,
    cancelEmergency,
    restoreEmergencies,
  } = useCupEmergency();
  const undo = useCaosUndo(realTime.getTime());

  // 今（エポックのミリ秒）。テスト中は練習の時計
  const { cards } = source;
  const nowMs = test.session?.currentMs ?? realTime.getTime();

  const lanes = useMemo(() => boardLanes(cards), [cards]);
  const unassigned = useMemo(
    () => cards.filter((card) => card.status === "unassigned"),
    [cards],
  );
  const looks = useMemo(
    () => cardLooks(cards, colorSettings, beanIndex),
    [cards, colorSettings, beanIndex],
  );
  // 豆キューに出す、盤面で待っている杯数（豆ごと）。実データテスト中は出さない
  const beanWaitingCups = useMemo(
    () => (test.session ? undefined : waitingCupsByBean(cards, beanIndex)),
    [cards, beanIndex, test.session],
  );

  // 画面のカードのキーから、今の盤面のカードを引く
  const cardOf = (key: string) => cards.find((card) => card.key === key);
  // 本番では、指名の無い上級生のみのカードは上級生のドリッパーにしか置けない（実データテストでは確かめない）
  const seniorBlock = (card: CaosCard, dripper: number) =>
    test.session ? null : seniorOnlyBlock(card, dripper, people);
  // 送った操作が通ったら（練習はすぐ、本番は API の応答で決まる）play で音を鳴らし、「1つ戻す」に label と戻す処理を覚える。
  // 断られたら何もしない。送れたか（練習で断られた・「次へ」の二度押しは false）を返す
  const onSuccess = (
    sent: boolean | Promise<boolean>,
    label: string,
    undoRun: UndoRun,
    play: () => void,
  ) => {
    void Promise.resolve(sent).then((ok) => {
      if (!ok) return;
      play();
      undo.remember(label, undoRun);
    });
    return sent !== false;
  };
  // 「次へ」を送る（seen は終えるカード）。書けたら音を鳴らし、「1つ戻す」に覚える
  const runNext = (bayId: number, seen: string | null) =>
    onSuccess(
      source.runNext(bayId, seen),
      `次へ ${dripperLabel(bayId)}`,
      source.undoRun(undoOfNext(cards, bayId)),
      () => soundManager.playComplete(),
    );
  // 統合（firstKey のカードを intoKey のカードへ）。抽出を始めてから時間のたったカード（caosLateMerge）へは、
  // checkLate なら送らずに mergeConfirm で確かめる（確かめを開いたら true）
  const runMerge = (firstKey: string, intoKey: string, checkLate: boolean) => {
    const card = cardOf(firstKey);
    const into = cardOf(intoKey);
    if (!card || !into) return fail(NOT_FOUND);
    const blocked = test.session
      ? null
      : seniorOnlyMergeBlock(card, into, people);
    if (blocked) return fail(blocked);
    const elapsedSec = checkLate ? caosLateMerge(into, nowMs) : null;
    if (elapsedSec !== null) {
      setMergeConfirm({ card, into, elapsedSec });
      return true;
    }
    return write(
      mergeWrites(card, into, newDripId),
      `統合 ${orderLabel(card)} → ${orderLabel(into)}`,
    );
  };
  // 書き込みを送る（作れなかったら理由を POS の通知で出す。書けたら音を鳴らす）。label は「1つ戻す」に出す操作の名前
  const write = (result: CaosWritesResult, label: string) => {
    if ("error" in result) return fail(result.error);
    // 今と同じ場所に置き直したなど、変わるものが無ければ送らず、音も鳴らさない
    if (result.writes.length === 0) return true;
    const undoRun = source.undoRun(undoOfWrites(cards, result.writes));
    return onSuccess(source.runWrites(result.writes), label, undoRun, () =>
      soundManager.playDispatch(),
    );
  };

  // 本番の緊急のカップに、刷るための POS の注文を付ける（本番のカードと入力は POS の注文から作るので、注文はある。無ければ null）
  const withPosOrder = <T extends { orderId: string }>(cups: T[]) => {
    const found = cups.flatMap((cup) => {
      const order = live.orders?.find((o) => o.id === cup.orderId);
      return order ? [{ ...cup, order }] : [];
    });
    return found.length === cups.length ? found : null;
  };
  const emergencyOps: EmergencyOps = test.session
    ? {
        // 練習の盤面の中だけ。戻すのは操作の前の練習の盤面
        orders: test.arrivedOrders,
        add: async (cups, reason) => {
          const undoRun = test.undoRun();
          const ids = test.addEmergencies(
            cups.map((cup) => cup.cupId),
            reason,
          );
          if (ids) toastEmergenciesAdded(ids.length);
          return ids && { ids, undo: undoRun };
        },
        cancel: async (cups) => {
          const undoRun = test.undoRun();
          if (!test.cancelEmergencies(cups.map((cup) => cup.id))) return null;
          toastEmergenciesCancelled(cups.length);
          return undoRun;
        },
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
          const ids = await addEmergency(pos, reason);
          return ids && { ids, undo: () => cancelEmergency(ids) };
        },
        cancel: async (cups) => {
          const restore = withPosOrder(
            cups.map((cup) => ({
              orderId: cup.orderId,
              cupId: cup.cupId,
              reason: cup.emergencyReason,
            })),
          );
          if (!restore) {
            fail(NOT_FOUND);
            return null;
          }
          if (!(await cancelEmergency(cups.map((cup) => cup.id)))) return null;
          return () => restoreEmergencies(restore);
        },
      };

  return {
    /** 盤面のカード（@cafeore/common の buildCaosCards） */
    cards,
    /** 6 列のドリッパー（終わり・抽出中・待機） */
    lanes,
    /** 未割当（注文番号の順） */
    unassigned,
    /** カードの色・豆と、分けた注文の中の位置 */
    looks,
    nextAvailable: nextAvailableBays(lanes, nowMs),
    /** ヘッダーの杯数（未割当・ドリッパーの待ち） */
    cups: {
      unassigned: totalCups(unassigned),
      waiting: totalCups(lanes.flatMap(laneActive)),
    },
    /** 今（エポックのミリ秒。テスト中は練習の時計） */
    nowMs,
    /** ヘッダーの時刻（日本時間の「10:05:09」） */
    timeLabel: jstClock(nowMs),
    /** 豆キューに出す POS の在庫（豆だけ）と、盤面で待っている杯数。実データテスト中は本物の在庫に記録させない */
    beans: {
      ...beanStock,
      waitingCups: beanWaitingCups,
      onRecorded: test.session ? undefined : beanStock.onRecorded,
    },
    /** 実データテストの時計（一時停止・速さ・やめる）を出すか。本番の盤面は実時間なので出さない */
    simulating: Boolean(test.session),
    isRunning,
    toggleRunning: () => setIsRunning((value) => !value),
    simSpeed,
    cycleSpeed: () =>
      setSimSpeed(
        (speed) =>
          SIM_SPEEDS[(SIM_SPEEDS.indexOf(speed) + 1) % SIM_SPEEDS.length],
      ),
    posStatus: live.status,
    /** この端末のシールのプリンター（刷れずに残っているシールの数と、送り直し） */
    labelPrinter,
    /**
     * 緊急（入れ直し）。本番は API に書いてシールを刷り、実データテスト中は練習の盤面の中だけ（刷らない。emergencyOps）
     *   - orders：番号から入れ直すカップを選ぶ注文
     *   - add：入れ直しを足す。入れ直しのカードが未割当のいちばん上に出る
     *   - cancel：入れ直しのカード（未割当・待機）の入れ直しを取り消す
     * どちらも「1つ戻す」で戻せる（本番は、足したのは取り消し、取り消したのは同じカップ・理由で未割当に足し直し、この端末でそのカップのシールを刷り直す。
     * 実データテストは練習の盤面を操作の前に戻す）
     */
    emergency: {
      orders: emergencyOps.orders,
      add: async (cups: EmergencyCup<CaosOrderInput>[], reason: string) => {
        const added = await emergencyOps.add(cups, reason);
        if (!added) return null;
        const nos = new Set(cups.map((cup) => cup.order.orderId));
        undo.remember(
          `緊急 ${[...nos].map((no) => `#${orderNoLabel(no)}`).join("・")}`,
          added.undo,
        );
        return added.ids;
      },
      cancel: (card: CaosCard) => {
        void emergencyOps
          .cancel(card.cups.filter((cup) => cup.emergency))
          .then((undoRun) => {
            if (undoRun)
              undo.remember(`緊急の取り消し ${orderLabel(card)}`, undoRun);
          });
      },
    },
    soundEnabled,
    toggleSound: () => {
      soundManager.enabled = !soundEnabled;
      setSoundEnabled(!soundEnabled);
    },
    /** 割当・ドリッパーの移動・順番の入れ替え（place が "front" なら待機の先頭、{ beforeKey } ならそのカードの前、無ければ最後）。順番の数はサーバー（練習なら練習の盤面）が決める */
    place: (key: string, bayId: number, place?: CaosPlace) => {
      const card = cardOf(key);
      if (!card) return fail(NOT_FOUND);
      const blocked = seniorBlock(card, bayId);
      if (blocked) return fail(blocked);
      const action =
        card.status === "unassigned"
          ? "割当"
          : card.dripper === bayId
            ? "並べ替え"
            : "移動";
      return write(
        assignWrites(cards, card, bayId, { place, newId: newDripId }),
        `${action} ${orderLabel(card)} → ${dripperLabel(bayId)}`,
      );
    },
    /** 待機のカードを未割当に戻す */
    returnToUnassigned: (key: string) => {
      const card = cardOf(key);
      if (!card) return fail(NOT_FOUND);
      return write(unassignWrites(card), `未割当に戻す ${orderLabel(card)}`);
    },
    /** 1 杯のカード（firstKey）を、もう 1 枚の 1 杯のカード（intoKey）に入れて 2 杯の同時抽出にまとめる（intoKey の場所のまま） */
    merge: (firstKey: string, intoKey: string) =>
      runMerge(firstKey, intoKey, true),
    /** 確かめている統合（抽出を始めてから時間のたったカードへ。無ければ null） */
    mergeConfirm,
    /** 確かめた統合を送る（そのあいだに変わったカードは、今の盤面で確かめ直す） */
    confirmMerge: () => {
      if (mergeConfirm)
        runMerge(mergeConfirm.card.key, mergeConfirm.into.key, false);
      setMergeConfirm(null);
    },
    cancelMerge: () => setMergeConfirm(null),
    /** 統合の解除：統合したカードから cupId の 1 杯を外して未割当に戻す */
    split: (key: string, cupId: string) => {
      const card = cardOf(key);
      const cup = card?.cups.find((c) => c.id === cupId);
      if (!card || !cup) return fail(NOT_FOUND);
      return write(
        splitWrites(card, cupId),
        `外す #${orderNoLabel(cup.orderNo)}`,
      );
    },
    /** ドリッパー from の待機を全部 to へ（置けないカードは残して知らせる） */
    moveQueue: (from: number, to: number) => {
      const result = moveQueueWrites(cards, from, to, (card) =>
        seniorBlock(card, to),
      );
      if ("kept" in result && result.kept > 0)
        toast(
          `指名・上級生のみで ${dripperLabel(to)} に置けないカード ${result.kept} 枚は残しました`,
        );
      return write(
        result,
        `まとめて移す ${dripperLabel(from)} → ${dripperLabel(to)}`,
      );
    },
    /**
     * 「次へ」。抽出中のカードの dripId を付ける（二度押しやほかの端末と同時に押したときに断ってもらう）。
     * 抽出中が無ければ（マスターで準備完了にして終わった、など）null で、待機の先頭を始める。
     * 抽出時間の半分もたっていなければ（隣の列の押し間違いかもしれない）、すぐには送らず nextConfirm で確かめる
     */
    advance: (bayId: number) => {
      const lane = lanes.find((l) => l.id === bayId);
      const early = lane && earlyNext(lane, nowMs);
      if (early) setNextConfirm({ bayId, ...early });
      else runNext(bayId, lane?.brewing?.dripId ?? null);
    },
    /** 確かめている「次へ」（無ければ null） */
    nextConfirm,
    /** 確かめた「次へ」を送る（確かめたカードを終える。そのあいだに終わっていれば断られる） */
    confirmNext: () => {
      if (nextConfirm) runNext(nextConfirm.bayId, nextConfirm.card.dripId);
      setNextConfirm(null);
    },
    cancelNext: () => setNextConfirm(null),
    /** 「1つ戻す」（この画面が最後にした操作を、10 秒のあいだ戻せる） */
    undo: {
      label: undo.label,
      secondsLeft: undo.secondsLeft,
      pending: undo.pending,
      run: undo.undo,
    },
    /** 実データテストをやめて cafeore-pos の盤面に戻る（練習の盤面は捨てる。本番のカップは触らない） */
    reset: () => {
      undo.forget();
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
        undo.forget();
        test.start(startMs, durationMinutes);
        setIsRunning(true);
        setSimSpeed(TEST_START_SPEED);
      },
      finish: () => {
        test.finish();
        setIsRunning(false);
      },
    },
  };
};
