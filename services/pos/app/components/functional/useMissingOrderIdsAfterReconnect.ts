import {
  type OrderEntity,
  type WithId,
  orderRepository,
} from "@cafeore/common";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type OrderIdRange, missingOrderIdRanges } from "./missingOrderIds";
import { waitUntilUnsentOrdersSaved } from "./saveOrderInBackground";

// 切れたときに届いていた注文の最大番号。切れている間に読み込み直しても、つながってから抜けを調べられるよう端末に残す
const OFFLINE_FROM_KEY = "cashier-offline-from";

// 注文を読めなかったら、少し待って読み直す
const RETRY_MS = 5_000;

const readOfflineFrom = (): number | null => {
  try {
    const value = localStorage.getItem(OFFLINE_FROM_KEY);
    const from = Number(value);
    return value !== null && Number.isSafeInteger(from) && from >= 0
      ? from
      : null;
  } catch (error) {
    console.error(error);
    return null;
  }
};

const writeOfflineFrom = (from: number | null) => {
  try {
    if (from === null) {
      localStorage.removeItem(OFFLINE_FROM_KEY);
    } else {
      localStorage.setItem(OFFLINE_FROM_KEY, String(from));
    }
  } catch (error) {
    console.error(error);
  }
};

/** 調べた範囲（from より後、to まで）と、調べたときに保存されていた注文の番号 */
type MissingCheck = { from: number; to: number; saved: readonly number[] };

/**
 * オンラインに戻ったあと、注文の無い番号（抜け）を求める。
 * 溜めた注文が全部保存できてから、切れたときに届いていた注文の最大番号より後を、保存されている注文で調べる
 *
 * 案内している間にほかのレジが溜めた注文を送ってきたら、その番号は抜けから外す（orders で見る）。
 * 開いたときからつながっていなければ、切れる前の番号が分からないので調べない
 * @param online 今すぐ保存できるか
 * @param orders 届いている注文（まだ届いていなければ undefined）
 * @returns 抜けた番号（無ければ空）と、案内を閉じる関数
 */
export const useMissingOrderIdsAfterReconnect = (
  online: boolean,
  orders: readonly WithId<OrderEntity>[] | undefined,
) => {
  const [check, setCheck] = useState<MissingCheck | null>(null);
  const latestRef = useRef<number | null>(null);
  latestRef.current =
    orders?.reduce((acc, order) => Math.max(acc, order.orderId), 0) ?? null;
  const wasOnlineRef = useRef(online);

  useEffect(() => {
    const wasOnline = wasOnlineRef.current;
    wasOnlineRef.current = online;
    if (!online) {
      // 何度切れても、まだ調べていなければ最初に切れたときの番号から調べる
      if (
        wasOnline &&
        latestRef.current !== null &&
        readOfflineFrom() === null
      ) {
        writeOfflineFrom(latestRef.current);
      }
      return;
    }
    const from = readOfflineFrom();
    if (from === null) return;
    const controller = new AbortController();
    const { signal } = controller;
    const run = async () => {
      await waitUntilUnsentOrdersSaved(signal);
      while (!signal.aborted) {
        try {
          const saved = (await orderRepository.findAll()).map(
            (order) => order.orderId,
          );
          if (signal.aborted) return;
          writeOfflineFrom(null);
          const to = saved.reduce((acc, id) => Math.max(acc, id), from);
          if (missingOrderIdRanges(saved, from, to).length > 0) {
            setCheck({ from, to, saved });
          }
          return;
        } catch (error) {
          console.error(error);
          await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
        }
      }
    };
    void run();
    return () => controller.abort();
  }, [online]);

  const ranges = useMemo<OrderIdRange[]>(
    () =>
      check === null
        ? []
        : missingOrderIdRanges(
            [...check.saved, ...(orders ?? []).map((order) => order.orderId)],
            check.from,
            check.to,
          ),
    [check, orders],
  );
  const dismiss = useCallback(() => setCheck(null), []);

  return { ranges, dismiss };
};
