import { useColorSettings } from "@cafeore/common";
import { useCallback, useMemo, useState } from "react";
import { useCurrentTime } from "~/components/functional/useCurrentTime";
import {
  type RebrewDecision,
  advanceBay,
  assignCard,
  mergeUnassigned,
  moveTicket,
  rebrew,
  returnTicket,
} from "../logic/board";
import { timeOfDayLabel } from "../logic/format";
import { paintBoard } from "../logic/posOrders";
import type { Board, TestPlaySession } from "../types";
import { soundManager } from "../utils/audio";
import { useBoardState } from "./useBoardState";
import { usePosIngest } from "./usePosIngest";
import { useTestPlay } from "./useTestPlay";

const startOfLocalDay = (ms: number) => {
  const date = new Date(ms);
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  ).getTime();
};

// CaOS の盤面・時刻・注文の取り込み・実データテストをまとめる。画面（App）はこれを呼んで部品に渡すだけ。
// 普段は cafeore-pos と同じ DB の注文で動かす。実データテスト中（終了後の実績表示も含め、リセットするまで）は
// DB からの取り込みを止め、テストの注文だけで盤面を動かす。
export const useCaosSession = (initial?: {
  board: Board;
  testPlaySession: TestPlaySession | null;
}) => {
  const [isRunning, setIsRunning] = useState(true);
  const [simSpeed, setSimSpeed] = useState(1);
  const [soundEnabled, setSoundEnabled] = useState(soundManager.enabled);
  const stopRunning = useCallback(() => setIsRunning(false), []);

  const state = useBoardState({
    initial: initial?.board,
    isRunning,
    simSpeed,
  });
  const test = useTestPlay({
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

  // できた操作だけ音を鳴らす
  const play = (ok: boolean, sound = () => soundManager.playDispatch()) => {
    if (ok) sound();
    return ok;
  };

  const board = useMemo(
    () => paintBoard(state.board, colorSettings),
    [state.board, colorSettings],
  );

  return {
    board,
    nowSec,
    timeLabel: timeOfDayLabel(nowSec),
    isRunning,
    toggleRunning: () => setIsRunning((value) => !value),
    simSpeed,
    setSimSpeed,
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
      historicalOrders: test.historicalOrders,
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
