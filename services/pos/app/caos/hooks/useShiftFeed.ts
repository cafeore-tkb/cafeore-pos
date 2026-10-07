import {
  CAOS_FEED_KEY_PATTERN,
  type ShiftFeed,
  fetchShiftFeed,
} from "@cafeore/common";
import { useCallback, useEffect, useRef, useState } from "react";

// sohosai-shift の担当者の予定（caosFeeds/{合言葉}）を読む。合言葉はビルドに焼き込まず、
// 各 iPad の CaOS の設定で入れて、その端末に覚えさせる（localStorage）。
// 合言葉が無い・読めないときは、名前の候補と上級生の判定が無いだけで、交代（自由入力）は使える。

const STORAGE_KEY = "caos-shift-feed-key";
/** 読み直す間隔 */
export const SHIFT_FEED_REFRESH_MS = 5 * 60_000;

const readStoredKey = () => {
  try {
    return window.localStorage.getItem(STORAGE_KEY) || "";
  } catch {
    return "";
  }
};

const writeStoredKey = (key: string) => {
  try {
    if (key) window.localStorage.setItem(STORAGE_KEY, key);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 覚えられなくても、開いている間は使える
  }
};

export interface ShiftFeedState {
  /** 端末に覚えさせた合言葉（無ければ空） */
  feedKey: string;
  /** 最後に読めた予定（読めなくなっても、前に読めたものは残す） */
  feed: ShiftFeed | null;
  loading: boolean;
  /** 最後に読んだときの失敗の理由 */
  error: string | null;
  /** 最後に読めた時刻（エポックミリ秒） */
  fetchedAt: number | null;
  /** 合言葉を保存して読む。形が違えば理由を返す */
  saveKey: (key: string) => string | null;
  clearKey: () => void;
  reload: () => void;
}

export const useShiftFeed = (): ShiftFeedState => {
  const [feedKey, setFeedKey] = useState(readStoredKey);
  const [feed, setFeed] = useState<ShiftFeed | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  // 古い読み込みの結果で上書きしないよう、何回目の読み込みかを数える
  const requestRef = useRef(0);

  const load = useCallback(async (key: string) => {
    const request = ++requestRef.current;
    if (!key) {
      setFeed(null);
      setError(null);
      setFetchedAt(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const next = await fetchShiftFeed(key);
      if (request !== requestRef.current) return;
      setFeed(next);
      setError(null);
      setFetchedAt(Date.now());
    } catch (err) {
      if (request !== requestRef.current) return;
      setError(err instanceof Error ? err.message : "読めませんでした");
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(feedKey);
    if (!feedKey) return;
    const timer = window.setInterval(
      () => void load(feedKey),
      SHIFT_FEED_REFRESH_MS,
    );
    return () => window.clearInterval(timer);
  }, [feedKey, load]);

  const saveKey = (key: string) => {
    const trimmed = key.trim();
    if (!CAOS_FEED_KEY_PATTERN.test(trimmed)) {
      return "合言葉は英数字 32〜64 文字です";
    }
    writeStoredKey(trimmed);
    if (trimmed === feedKey) void load(trimmed);
    else {
      // 別の合言葉の予定は混ぜない
      setFeed(null);
      setFetchedAt(null);
      setFeedKey(trimmed);
    }
    return null;
  };

  const clearKey = () => {
    writeStoredKey("");
    setFeedKey("");
  };

  return {
    feedKey,
    feed,
    loading,
    error,
    fetchedAt,
    saveKey,
    clearKey,
    reload: () => void load(feedKey),
  };
};
