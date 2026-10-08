import {
  type CaosLane,
  type CaosOp,
  type CaosPracticeResult,
  type CaosPracticeState,
  advanceCaosPractice,
  createCaosPractice,
  deleteCaosPractice,
  getCaosPractice,
  postCaosPracticeOp,
} from "@cafeore/common";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type PracticeDataOrder,
  ordersInWindow,
  toPracticeOrderInput,
} from "./data";

// 実データテスト（練習用の盤面）。盤面とルールはサーバー（POST /api/caos/practice）にあり、ここは時計と送り役だけ。
//
// - 時計（練習の時刻）はこの画面が持つ。1 回の刻みで練習の時刻を 1 秒進め、倍速は刻みの間隔で決める（1 倍なら 1 秒ごと）。
//   一時停止もこの画面だけで決まる（サーバーは時計を持たず、送られた時刻を使う）
// - 注文が届くのは、時計がサーバーの next_arrival_at を過ぎたとき。そのときだけ「進める」を送る（注文が来ないあいだは何も送らない）
// - 操作は練習の時刻を付けて送り、応答の盤面をそのまま使う（本番の WebSocket には流れない）
// - 送るのは 1 つずつ順番に（時刻が戻らないように）。応答の盤面は version が新しいときだけ使う
// - 練習の ID はこのタブ（sessionStorage）に覚えておき、開き直したら続きから（サーバーが時計の最後の時刻を持っている）。
//   別のタブで開いた CaOS は本番の盤面のまま（練習はタブごと）
// - 終わったら実績を出すために盤面を残し、リセットで消す。放置した練習はサーバーが片付ける

const STORAGE_KEY = "caos-practice-v1";

interface Stored {
  id: string;
  label: string;
  finished: boolean;
}

const readStored = (): Stored | null => {
  try {
    const value = window.sessionStorage.getItem(STORAGE_KEY);
    const parsed = value ? (JSON.parse(value) as Stored) : null;
    return parsed && typeof parsed.id === "string" ? parsed : null;
  } catch {
    return null;
  }
};

const writeStored = (value: Stored | null) => {
  try {
    if (value)
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    else window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // 覚えられなくても練習はできる（開き直すと続きから始められないだけ）
  }
};

export interface PracticeSession {
  id: string;
  /** どのデータか（例「2025年 雙峰祭」） */
  label: string;
  startMs: number;
  endMs: number;
  /** 終わった（実績を出している）。盤面はリセットまで残す */
  finished: boolean;
}

export interface PracticeStart {
  label: string;
  orders: PracticeDataOrder[];
  startMs: number;
  endMs: number;
  /** 列の担当者の初めの状態（本番の列の写し）。練習の中で交代しても本番には響かない */
  lanes: CaosLane[] | null;
}

export const usePractice = ({
  enabled,
  running,
  speed,
  onError,
}: {
  /** false なら、このタブで続けていた練習を読まない（パネルだけを開いたときなど） */
  enabled: boolean;
  running: boolean;
  speed: number;
  onError: (message: string) => void;
}) => {
  const [session, setSession] = useState<PracticeSession | null>(null);
  const [state, setState] = useState<CaosPracticeState | null>(null);
  const [clockMs, setClockMs] = useState(0);
  const [starting, setStarting] = useState(false);
  const clockRef = useRef(0);
  clockRef.current = clockMs;
  const sessionRef = useRef<PracticeSession | null>(null);
  sessionRef.current = session;
  const versionRef = useRef(-1);
  const queueRef = useRef<Promise<unknown>>(Promise.resolve());
  const advancingRef = useRef(false);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const accept = useCallback((next: CaosPracticeState) => {
    if (next.version < versionRef.current) return;
    versionRef.current = next.version;
    setState(next);
  }, []);

  const clear = useCallback(() => {
    writeStored(null);
    versionRef.current = -1;
    setSession(null);
    setState(null);
  }, []);

  // 応答を受けて、盤面を入れ替える。盤面が消えていたら（時間がたって片付けられた）練習を終える。
  // 送ったあとに練習をやめた・始め直したときの応答（別の練習の盤面）は使わない
  const handle = useCallback(
    <T>(
      id: string,
      result: CaosPracticeResult<T>,
      pick: (value: T) => CaosPracticeState,
    ) => {
      if (sessionRef.current?.id !== id) return null;
      if (result.error !== undefined) {
        onErrorRef.current(result.error);
        if (result.notFound) clear();
        return null;
      }
      accept(pick(result.result));
      return result.result;
    },
    [accept, clear],
  );

  // 送るのは 1 つずつ順番に
  const enqueue = useCallback(<T>(task: () => Promise<T>): Promise<T> => {
    const run = queueRef.current.then(task, task);
    queueRef.current = run.catch(() => undefined);
    return run;
  }, []);

  // 開き直したら、このタブで続けていた練習を読む（続きから。時計はサーバーが最後に受け取った時刻）
  useEffect(() => {
    const stored = enabled ? readStored() : null;
    if (!stored) return;
    let cancelled = false;
    void getCaosPractice(stored.id).then((result) => {
      if (cancelled) return;
      if (!result.result) {
        if (result.notFound) writeStored(null);
        return;
      }
      const next = result.result;
      versionRef.current = next.version;
      setState(next);
      setClockMs(new Date(next.now).getTime());
      setSession({
        id: next.id,
        label: stored.label,
        startMs: new Date(next.starts_at).getTime(),
        endMs: new Date(next.ends_at).getTime(),
        finished: stored.finished,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const active = Boolean(session && !session.finished);

  // 時計：1 回の刻みで 1 秒。倍速は刻みの間隔（1000 / speed ミリ秒）。終わりの時刻で止まる
  useEffect(() => {
    if (!active || !running || !session) return;
    const endMs = session.endMs;
    const timer = window.setInterval(() => {
      setClockMs((ms) => Math.min(endMs, ms + 1_000));
    }, 1000 / speed);
    return () => window.clearInterval(timer);
  }, [active, running, speed, session]);

  // 次の注文の時刻を過ぎたら「進める」を送る（届いた注文はサーバーのルールでカードになる）
  const nextArrivalMs = state?.next_arrival_at
    ? new Date(state.next_arrival_at).getTime()
    : null;
  useEffect(() => {
    const current = sessionRef.current;
    if (!current || current.finished || nextArrivalMs === null) return;
    if (clockMs < nextArrivalMs || advancingRef.current) return;
    advancingRef.current = true;
    const id = current.id;
    void enqueue(async () =>
      handle(
        id,
        await advanceCaosPractice(id, new Date(clockRef.current).toISOString()),
        (value) => value,
      ),
    ).finally(() => {
      advancingRef.current = false;
    });
  }, [clockMs, nextArrivalMs, enqueue, handle]);

  /** 操作を送る。通ったら操作の記録の ID（「1つ戻す」用。undo では空）、断られたら null（理由は onError に出す） */
  const runOp = useCallback(
    (op: CaosOp) => {
      const current = sessionRef.current;
      if (!current) return Promise.resolve(null);
      const id = current.id;
      return enqueue(async () => {
        const result = handle(
          id,
          await postCaosPracticeOp(
            id,
            new Date(clockRef.current).toISOString(),
            op,
          ),
          (value) => value.state,
        );
        return result ? result.op_id : null;
      });
    },
    [enqueue, handle],
  );

  /** 練習を始める（前の練習の盤面は消す）。始められたら true */
  const start = useCallback(
    async ({ label, orders, startMs, endMs, lanes }: PracticeStart) => {
      const previous = sessionRef.current;
      setStarting(true);
      try {
        if (previous) void deleteCaosPractice(previous.id);
        clear();
        const result = await createCaosPractice({
          starts_at: new Date(startMs).toISOString(),
          ends_at: new Date(endMs).toISOString(),
          orders: ordersInWindow(orders, startMs, endMs).map(
            toPracticeOrderInput,
          ),
          lanes: (lanes ?? []).map((lane) => ({
            dripper: lane.dripper,
            name: lane.name,
            senior: lane.senior,
          })),
        });
        if (!result.result) {
          onErrorRef.current(result.error);
          return false;
        }
        const next = result.result;
        versionRef.current = next.version;
        setState(next);
        setClockMs(startMs);
        setSession({ id: next.id, label, startMs, endMs, finished: false });
        writeStored({ id: next.id, label, finished: false });
        return true;
      } finally {
        setStarting(false);
      }
    },
    [clear],
  );

  /** 練習を終える（時計を止めて実績を出す。盤面はリセットまで残す） */
  const finish = useCallback(() => {
    setSession((current) => {
      if (!current) return current;
      writeStored({ id: current.id, label: current.label, finished: true });
      return { ...current, finished: true };
    });
  }, []);

  /** 練習をやめて、練習用の盤面を消す（本番の盤面に戻る） */
  const reset = useCallback(() => {
    const current = sessionRef.current;
    if (current) void deleteCaosPractice(current.id);
    clear();
  }, [clear]);

  return {
    session,
    state,
    clockMs,
    starting,
    reachedEnd: Boolean(session && clockMs >= session.endMs),
    runOp,
    start,
    finish,
    reset,
  };
};
