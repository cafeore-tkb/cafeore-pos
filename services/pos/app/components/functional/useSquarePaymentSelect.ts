import {
  type SquareAction,
  type SquareActionOption,
  squareRepository,
} from "@cafeore/common";
import { useCallback, useEffect, useRef, useState } from "react";

/** 端末の状態を問い合わせる間隔 */
const POLL_INTERVAL_MS = 1500;
/** 出すものが決まってから端末に出すまで待つ時間 */
const SHOW_DELAY_MS = 400;

/** 端末に出す、お客さんが決済手段を選ぶ画面 */
export type SquarePaymentSelectRequest = {
  /**
   * 出す中身（端末・額・小計など）を表すキー。同じキーの間は 1 回だけ出し、
   * 変わったら出し直す（前の画面は取り消す）
   */
  key: string;
  deviceId: string;
  /** 今払う額（画面に出す） */
  amount: number;
  /** 並べる決済手段（並べる順） */
  options: SquareActionOption[];
};

export type SquarePaymentSelectStatus =
  /** 出していない */
  | "idle"
  /** 端末に出している（出している途中を含む） */
  | "showing"
  /** 出せなかった（決済が進行中・Square が断ったなど） */
  | "failed";

type Entry = {
  key: string;
  /** Square に出した画面。出している途中は null */
  action: SquareAction | null;
  /** もう要らない（キーが変わった・スタッフが選んだ）。出している途中なら、出せたらすぐ取り消す */
  abandoned: boolean;
};

type Options = {
  /** 出すもの。出さないときは null（出していれば取り消す） */
  request: SquarePaymentSelectRequest | null;
  /** お客さんが端末で決済手段を選んだときに呼ぶ */
  onSelected: (option: SquareActionOption) => void;
};

const cancelQuietly = (id: string) => {
  squareRepository.cancelAction(id).catch((error) => {
    // 取り消せなくても、次に決済を始めるときにサーバーが取り消す
    console.error(error);
  });
};

/**
 * お客さんが Square Terminal で決済手段を選べるようにする
 *
 * request を渡すと端末に決済手段を並べた画面を出し、選ばれるまで問い合わせ続け、選ばれたら
 * onSelected を呼ぶ。request が null になる・キーが変わる・dismiss（スタッフがレジで選んだ）と取り消す。
 * 選ばれた・取り消された・出せなかった・dismiss したキーでは、request が null になるまで出し直さない。
 */
export const useSquarePaymentSelect = ({ request, onSelected }: Options) => {
  const [entry, setEntry] = useState<Entry | null>(null);
  const [failure, setFailure] = useState<{
    key: string;
    message: string;
  } | null>(null);
  const entryRef = useRef<Entry | null>(null);
  // 出し終えたキー。同じキーでは出し直さない
  const doneKeyRef = useRef<string | null>(null);
  const requestRef = useRef(request);
  requestRef.current = request;
  const onSelectedRef = useRef(onSelected);
  onSelectedRef.current = onSelected;

  const replaceEntry = useCallback((next: Entry | null) => {
    entryRef.current = next;
    setEntry(next);
  }, []);

  /** 出している画面をやめる。Square に出せていれば取り消す */
  const abandon = useCallback(
    (target: Entry) => {
      target.abandoned = true;
      if (target.action?.outcome === "pending") {
        cancelQuietly(target.action.id);
      }
      if (entryRef.current === target) {
        replaceEntry(null);
      }
    },
    [replaceEntry],
  );

  /** Square から受け取った状態を反映する。選ばれたら onSelected を呼ぶ */
  const apply = useCallback(
    (target: Entry, action: SquareAction) => {
      if (target.abandoned || entryRef.current !== target) {
        return;
      }
      if (action.outcome === "pending") {
        // 画面に要るのは出せたかどうかだけ。問い合わせのたびにレジを描き直さない
        const first = target.action === null;
        target.action = action;
        if (first) {
          setEntry({ ...target });
        }
        return;
      }
      doneKeyRef.current = target.key;
      replaceEntry(null);
      if (action.outcome === "selected" && action.selected) {
        onSelectedRef.current(action.selected as SquareActionOption);
      } else if (action.error_message) {
        setFailure({ key: target.key, message: action.error_message });
      }
    },
    [replaceEntry],
  );

  const show = useCallback(
    async (target: SquarePaymentSelectRequest) => {
      const created: Entry = {
        key: target.key,
        action: null,
        abandoned: false,
      };
      replaceEntry(created);
      setFailure(null);
      try {
        const action = await squareRepository.createAction({
          idempotencyKey: crypto.randomUUID(),
          deviceId: target.deviceId,
          amount: target.amount,
          options: target.options,
        });
        if (created.abandoned) {
          // 出している間に要らなくなった。出したままにしない
          if (action.outcome === "pending") {
            cancelQuietly(action.id);
          }
          return;
        }
        apply(created, action);
      } catch (error) {
        if (created.abandoned || entryRef.current !== created) {
          return;
        }
        doneKeyRef.current = created.key;
        replaceEntry(null);
        setFailure({
          key: created.key,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [replaceEntry, apply],
  );

  // 出すものが変わったら、前の画面を取り消して出し直す。
  // 出すのは少し待ってから（会計に進んですぐスタッフが選んだら出さない。端末の画面がちらつかないように）
  const requested = request !== null;
  const wantedKey =
    request !== null && request.key !== doneKeyRef.current ? request.key : null;
  useEffect(() => {
    if (!requested) {
      // 出すものが無くなった（会計を終えた・決済を始めたなど）。次の会計は同じ額でも、また出す
      doneKeyRef.current = null;
    }
    const current = entryRef.current;
    if (current !== null && current.key !== wantedKey) {
      abandon(current);
    }
    if (wantedKey === null || entryRef.current !== null) {
      return;
    }
    const timer = setTimeout(() => {
      const target = requestRef.current;
      if (
        target?.key === wantedKey &&
        doneKeyRef.current !== wantedKey &&
        entryRef.current === null
      ) {
        void show(target);
      }
    }, SHOW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [requested, wantedKey, abandon, show]);

  // 画面を閉じたら、出したままにしない
  useEffect(
    () => () => {
      if (entryRef.current !== null) {
        abandon(entryRef.current);
      }
    },
    [abandon],
  );

  /**
   * スタッフがレジで決済手段を選んだ。出していれば取り消し、今の中身ではもう出さない。
   * 出すものが無いとき（入れる段階など）は何もしない
   */
  const dismiss = useCallback(() => {
    const key = requestRef.current?.key;
    if (key === undefined) {
      return;
    }
    doneKeyRef.current = key;
    setFailure(null);
    if (entryRef.current !== null) {
      abandon(entryRef.current);
    }
  }, [abandon]);

  // 選ばれるまで問い合わせ続ける
  const actionId =
    entry?.action?.outcome === "pending" ? entry.action.id : undefined;
  useEffect(() => {
    if (actionId === undefined) {
      return;
    }
    let stopped = false;
    const timer = setInterval(async () => {
      try {
        const action = await squareRepository.getAction(actionId);
        const current = entryRef.current;
        if (!stopped && current?.action?.id === actionId) {
          apply(current, action);
        }
      } catch (error) {
        // 一時的な通信エラーは次の問い合わせで回復する
        console.error(error);
      }
    }, POLL_INTERVAL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [actionId, apply]);

  const status: SquarePaymentSelectStatus =
    entry !== null
      ? "showing"
      : failure !== null && failure.key === request?.key
        ? "failed"
        : "idle";

  return {
    status,
    /** 出せなかった理由（status が failed のとき） */
    message: status === "failed" ? (failure?.message ?? null) : null,
    dismiss,
  };
};
