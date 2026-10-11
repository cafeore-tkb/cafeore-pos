import {
  type CaosCard,
  type CaosPlace,
  type CaosWritesResult,
  type PracticeDataOrder,
  assignWrites,
  caosLane,
  dripperLabel,
  jstClock,
  mergeWrites,
  seniorOnlyBlock,
  unassignWrites,
  undoOfNext,
  undoOfWrites,
  useCaosBrewTimes,
  useColorSettings,
  useItemMaster,
} from "@cafeore/common";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  type EmergencyCup,
  useCupEmergency,
} from "~/components/functional/useCupEmergency";
import { useCurrentTime } from "~/components/functional/useCurrentTime";
import { waitingCupsByBean } from "../logic/beans";
import { cardLooks, orderLabel, orderNoLabel, totalCups } from "../logic/cards";
import { testPlayRemainingLabel } from "../logic/historical";
import { boardLanes, laneActive } from "../logic/lanes";
import { nextAvailableBays } from "../logic/queue";
import { soundManager } from "../utils/audio";
import { useBeanInventory } from "./useBeanInventory";
import { useCaosLanes } from "./useCaosLanes";
import { type UndoRun, useCaosUndo } from "./useCaosUndo";
import { useLiveBoard } from "./useLiveBoard";
import { usePracticeData } from "./usePracticeData";
import { useTestPlay } from "./useTestPlay";

// 実データを読み込んでいないとき
const NO_ORDERS: PracticeDataOrder[] = [];

// タイマーの速さ（ヘッダーで押すたびに次へ）
const SIM_SPEEDS = [1, 2, 5, 10];

// 新しいカード（dripId）の ID
const newDripId = () => crypto.randomUUID();

// 押したカードが、もう盤面に無いとき（ほかの端末で動いた・注文が消えた）
const NOT_FOUND = "カードが見つかりません";

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
  const [simSpeed, setSimSpeed] = useState(SIM_SPEEDS[0]);
  const [soundEnabled, setSoundEnabled] = useState(soundManager.enabled);
  const stopRunning = useCallback(() => setIsRunning(false), []);

  // 実データテストの注文。過去の注文データは同梱せず、テストプレイの画面で手元の JSON を読み込む
  // （ブラウザの中で名前とコメントを落とす。API には書かないので、本番の盤面・注文・在庫には混ざらない）。
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
  // ドリッパーの担当者（サーバーの今日の担当者）。本番では、上級生のみのカードは上級生のドリッパーにしか置けない（サーバーも確かめる）
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

  // 予定の時刻（タイムライン・残り・次に空く）は抽出時間の実測で立てる（実データテストも同じ）
  const brewTimes = useCaosBrewTimes();
  const lanes = useMemo(() => boardLanes(cards, brewTimes), [cards, brewTimes]);
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
     * 緊急（入れ直し）。実データテスト中は null（練習の盤面には入れ直しが無い）
     *   - orders：番号から入れ直すカップを選ぶ注文
     *   - add：入れ直しを足す。入れ直しのカードが未割当のいちばん上に出て、カップのシールを刷る
     *   - cancel：入れ直しのカード（未割当・待機）の入れ直しを取り消す
     * どちらも「1つ戻す」で戻せる（足したのは取り消し、取り消したのは同じカップ・理由で未割当に足し直す。シールは刷り直さない）
     */
    emergency: test.session
      ? null
      : {
          orders: live.orders ?? [],
          add: async (cups: EmergencyCup[], reason: string) => {
            const ids = await addEmergency(cups, reason);
            if (ids) {
              const nos = new Set(cups.map((cup) => cup.order.orderId));
              undo.remember(
                `緊急 ${[...nos].map((no) => `#${orderNoLabel(no)}`).join("・")}`,
                () => cancelEmergency(ids),
              );
            }
            return ids;
          },
          cancel: (card: CaosCard) => {
            const cups = card.cups.filter((cup) => cup.emergency);
            void cancelEmergency(cups.map((cup) => cup.id)).then((ok) => {
              if (!ok) return;
              undo.remember(`緊急の取り消し ${orderLabel(card)}`, () =>
                restoreEmergencies(
                  cups.map((cup) => ({
                    cupId: cup.cupId,
                    reason: cup.emergencyReason,
                  })),
                ),
              );
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
      const blocked = test.session
        ? null
        : seniorOnlyBlock(card, bayId, people);
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
    /** 1 杯のカードどうしを 2 杯の同時抽出にまとめる */
    merge: (firstKey: string, secondKey: string) => {
      const card = cardOf(firstKey);
      const withCard = cardOf(secondKey);
      if (!card || !withCard) return fail(NOT_FOUND);
      return write(
        mergeWrites(card, withCard, newDripId),
        `統合 ${orderLabel(card)}・${orderLabel(withCard)}`,
      );
    },
    /**
     * 「次へ」。画面が抽出中と見ているカードの dripId を付ける（二度押しやほかの端末と同時に押したときに断ってもらう）。
     * 抽出中が無ければ（マスターで準備完了にして終わった、など）null で、待機の先頭を始める
     */
    advance: (bayId: number) => {
      const seen = caosLane(cards, bayId).brewing?.dripId ?? null;
      const undoRun = source.undoRun(undoOfNext(cards, bayId));
      return onSuccess(
        source.runNext(bayId, seen),
        `次へ ${dripperLabel(bayId)}`,
        undoRun,
        () => soundManager.playComplete(),
      );
    },
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
      },
      finish: () => {
        test.finish();
        setIsRunning(false);
      },
    },
  };
};
