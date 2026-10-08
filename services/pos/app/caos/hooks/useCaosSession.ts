import {
  type CaosPlace,
  type CaosWritesResult,
  type PracticeDataOrder,
  caosLane,
  jstDayStart,
  useColorSettings,
  useItemMaster,
} from "@cafeore/common";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { useCurrentTime } from "~/components/functional/useCurrentTime";
import { cardLooks, totalCups } from "../logic/cards";
import { timeOfDayLabel } from "../logic/format";
import { testPlayRemainingLabel } from "../logic/historical";
import { boardLanes, laneActive } from "../logic/lanes";
import { nextAvailableBays } from "../logic/queue";
import {
  mergeCardWrites,
  placeCardWrites,
  unassignCardWrites,
} from "../logic/writes";
import { soundManager } from "../utils/audio";
import { useLiveBoard } from "./useLiveBoard";
import { usePracticeData } from "./usePracticeData";
import { useTestPlay } from "./useTestPlay";

// 実データを読み込んでいないとき
const NO_ORDERS: PracticeDataOrder[] = [];

// タイマーの速さ（ヘッダーで押すたびに次へ）
const SIM_SPEEDS = [1, 2, 5, 10];

// 新しいカード（dripId）の ID
const newDripId = () => crypto.randomUUID();

// CaOS の盤面・時刻・実データテストをまとめる。画面（App）はこれを呼んで部品に渡すだけ。
// 普段は cafeore-pos の注文で動かす（useLiveBoard。盤面は注文のカップの列にあり、操作は API に書いて全部の iPad で共有する）。
// 実データテスト中（終了後の実績表示も含め、リセットするまで）は cafeore-pos の注文を使わず、練習の盤面（useTestPlay）で動かす。
// どちらもカードは @cafeore/common の buildCaosCards で組み立てた CaosCard、操作の書き込みは logic/writes.ts で同じ。違うのは送り先だけ。
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
  const { colorSettings } = useColorSettings();

  // 盤面の秒。日本時間の 0 時から数える（盤面の「今日」と同じ区切りで、日をまたいだら次の日の 0 時から。
  // テスト中はテストの最初の日の 0 時から。24 時を過ぎても戻らない）
  const { cards } = source;
  const dayStartMs = test.dayStartMs ?? jstDayStart(realTime.getTime());
  const nowMs = test.session?.currentMs ?? realTime.getTime();
  const nowSec = Math.floor((nowMs - dayStartMs) / 1000);

  const lanes = useMemo(() => boardLanes(cards), [cards]);
  const unassigned = useMemo(
    () => cards.filter((card) => card.status === "unassigned"),
    [cards],
  );
  const looks = useMemo(
    () => cardLooks(cards, colorSettings),
    [cards, colorSettings],
  );

  // 書き込みを送る（作れなかったら理由を POS の通知で出す。作れたら音を鳴らす）
  const write = (result: CaosWritesResult) => {
    if ("error" in result) {
      toast.error(result.error);
      return false;
    }
    const ok = source.runWrites(result.writes);
    if (ok) soundManager.playDispatch();
    return ok;
  };

  return {
    /** 盤面のカード（@cafeore/common の buildCaosCards） */
    cards,
    /** 6 列のドリッパー（終わり・抽出中・待機） */
    lanes,
    /** 未割当（注文番号の順） */
    unassigned,
    /** カードの色と、分けた注文の中の位置 */
    looks,
    nextAvailable: nextAvailableBays(lanes, nowSec, dayStartMs),
    /** ヘッダーの杯数（未割当・ドリッパーの待ち） */
    cups: {
      unassigned: totalCups(unassigned),
      waiting: totalCups(lanes.flatMap(laneActive)),
    },
    nowSec,
    dayStartMs,
    timeLabel: timeOfDayLabel(nowSec),
    isRunning,
    toggleRunning: () => setIsRunning((value) => !value),
    simSpeed,
    cycleSpeed: () =>
      setSimSpeed(
        (speed) =>
          SIM_SPEEDS[(SIM_SPEEDS.indexOf(speed) + 1) % SIM_SPEEDS.length],
      ),
    posStatus: live.status,
    soundEnabled,
    toggleSound: () => {
      soundManager.enabled = !soundEnabled;
      setSoundEnabled(!soundEnabled);
    },
    /** 未割当・待機のカードをドリッパーへ（place が無ければ待機の最後へ） */
    place: (key: string, bayId: number, place?: CaosPlace) =>
      write(placeCardWrites(cards, key, bayId, place, newDripId)),
    returnToUnassigned: (key: string) => write(unassignCardWrites(cards, key)),
    merge: (firstKey: string, secondKey: string) =>
      write(mergeCardWrites(cards, firstKey, secondKey, newDripId)),
    /**
     * 「次へ」。画面が抽出中と見ているカードの dripId を付ける（二度押しやほかの端末と同時に押したときに断ってもらう）。
     * 抽出中が無ければ（マスターで準備完了にして終わった、など）null で、待機の先頭を始める
     */
    advance: (bayId: number) => {
      const seen = caosLane(cards, bayId).brewing?.dripId ?? null;
      const ok = source.runNext(bayId, seen);
      if (ok) soundManager.playComplete();
      return ok;
    },
    /** 実データテストをやめて cafeore-pos の盤面に戻る（練習の盤面は捨てる。本番のカップは触らない） */
    reset: () => {
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
