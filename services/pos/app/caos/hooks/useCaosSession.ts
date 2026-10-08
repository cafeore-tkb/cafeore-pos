import { useColorSettings } from "@cafeore/common";
import { useCallback, useMemo, useState } from "react";
import { useCurrentTime } from "~/components/functional/useCurrentTime";
import {
  advanceBay,
  assignCard,
  mergeUnassigned,
  moveTicket,
  rebrew,
  returnTicket,
} from "../logic/board";
import { compareUnassigned, totalCups } from "../logic/cards";
import { startOfLocalDay, timeOfDayLabel } from "../logic/format";
import { testPlayAnalytics, testPlayRemainingLabel } from "../logic/historical";
import { paintBoard } from "../logic/posOrders";
import { nextAvailableBays } from "../logic/queue";
import type { RebrewDecision } from "../logic/rebrew";
import type { Board, HistoricalOrder, TestPlaySession } from "../types";
import { soundManager } from "../utils/audio";
import { useBoardState } from "./useBoardState";
import { usePosIngest } from "./usePosIngest";
import { usePracticeData } from "./usePracticeData";
import { useTestPlay } from "./useTestPlay";

// 実データを読み込んでいないとき
const NO_ORDERS: HistoricalOrder[] = [];

// タイマーの速さ（ヘッダーで押すたびに次へ）
const SIM_SPEEDS = [1, 2, 5, 10];

// CaOS の盤面・時刻・注文の取り込み・実データテストをまとめる。画面（App）はこれを呼んで部品に渡すだけ。
// 普段は cafeore-pos と同じ DB の注文で動かす。実データテスト中（終了後の実績表示も含め、リセットするまで）は
// DB からの取り込みを止め、テストの注文だけで盤面を動かす。
export const useCaosSession = (initial?: {
  board: Board;
  testPlaySession: TestPlaySession | null;
}) => {
  const [isRunning, setIsRunning] = useState(true);
  const [simSpeed, setSimSpeed] = useState(SIM_SPEEDS[0]);
  const [soundEnabled, setSoundEnabled] = useState(soundManager.enabled);
  const stopRunning = useCallback(() => setIsRunning(false), []);

  const state = useBoardState({
    initial: initial?.board,
    isRunning,
    simSpeed,
  });
  // 実データテストの注文。過去の注文データは同梱せず、テストプレイの画面で手元の JSON を読み込む
  // （ブラウザの中で名前とコメントを落とす。API には書かないので、本番の盤面・注文・在庫には混ざらない）。
  const practiceData = usePracticeData();
  const test = useTestPlay({
    historicalOrders: practiceData.dataset?.orders ?? NO_ORDERS,
    initial: initial?.testPlaySession ?? null,
    isRunning,
    simSpeed,
    receive: state.receive,
    onTimeUp: stopRunning,
  });
  const pos = usePosIngest({ enabled: !test.session, receive: state.receive });
  const { colorSettings } = useColorSettings();

  // 盤面の秒。その日の 0 時から数える（テスト中はテストの最初の日の 0 時から。24 時を過ぎても戻らない）
  const realTime = useCurrentTime(1000);
  const [realDayStartMs] = useState(() => startOfLocalDay(Date.now()));
  const nowMs = test.session?.currentMs ?? realTime.getTime();
  const dayStartMs = test.session
    ? startOfLocalDay(test.session.startMs)
    : realDayStartMs;
  const nowSec = Math.floor((nowMs - dayStartMs) / 1000);

  const board = useMemo(
    () => paintBoard(state.board, colorSettings),
    [state.board, colorSettings],
  );

  // できた操作だけ音を鳴らす
  const play = (ok: boolean, sound = () => soundManager.playDispatch()) => {
    if (ok) sound();
    return ok;
  };

  return {
    board,
    /** 未割当（入れ直しを先に、注文番号の順） */
    unassigned: [...board.unassigned].sort(compareUnassigned),
    nextAvailable: nextAvailableBays(board.baristas),
    /** ヘッダーの杯数（未割当・ドリッパーの待ち） */
    cups: {
      unassigned: totalCups(board.unassigned),
      waiting: totalCups(board.baristas.flatMap((barista) => barista.queue)),
    },
    nowSec,
    timeLabel: timeOfDayLabel(nowSec),
    isRunning,
    toggleRunning: () => setIsRunning((value) => !value),
    simSpeed,
    cycleSpeed: () =>
      setSimSpeed(
        (speed) =>
          SIM_SPEEDS[(SIM_SPEEDS.indexOf(speed) + 1) % SIM_SPEEDS.length],
      ),
    posStatus: pos.status,
    soundEnabled,
    toggleSound: () => {
      soundManager.enabled = !soundEnabled;
      setSoundEnabled(!soundEnabled);
    },
    undoLabel: state.undoLabel,
    undo: () => play(state.undo()),
    assign: (uid: string, bayId: number) =>
      play(state.apply((board) => assignCard(board, uid, bayId, nowSec))),
    move: (key: string, bayId: number) =>
      play(state.apply((board) => moveTicket(board, key, bayId, nowSec))),
    returnToUnassigned: (key: string) =>
      play(state.apply((board) => returnTicket(board, key, nowSec))),
    advance: (bayId: number) =>
      play(
        state.apply((board) => advanceBay(board, bayId, nowSec)),
        () => soundManager.playComplete(),
      ),
    merge: (firstUid: string, secondUid: string) =>
      state.apply((board) => mergeUnassigned(board, firstUid, secondUid)),
    rebrew: (key: string, decision: RebrewDecision) => {
      const uid = `rebrew-${key}-${Date.now()}`;
      return play(
        state.apply((board) => rebrew(board, key, decision, nowSec, uid)),
      );
    },
    /** 空の盤面に戻し、テストをやめて DB の注文を取り込み直す */
    reset: () => {
      state.reset();
      test.clear();
      pos.reset();
      setIsRunning(true);
      soundManager.playDispatch();
    },
    testPlay: {
      session: test.session,
      isActive: test.session?.status === "active",
      /** 残り（「12分」）。テストをしていなければ null */
      remainingLabel: test.session
        ? testPlayRemainingLabel(test.session)
        : null,
      /** 実績のパネルに渡すもの */
      analytics: testPlayAnalytics(test.session),
      /** 読み込んだ実データ（テストプレイの画面で選ぶ） */
      practiceData,
      start: (startMs: number, durationMinutes: 30 | 60) => {
        state.reset();
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
