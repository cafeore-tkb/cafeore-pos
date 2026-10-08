import {
  type OrderEntity,
  type WithId,
  claimEmergencyLabel,
  pendingEmergencyLabels,
  releaseEmergencyLabel,
} from "@cafeore/common";
import { useEffect, useRef, useState } from "react";
import type { usePrinter } from "./print-util";

// 失敗したカップを試し直すまでの間（プリンターが止まっているときに、印を付けては戻すのを繰り返さない）。
// この間ごとに、注文が変わらなくても見直す
const RETRY_MS = 15_000;

/**
 * 緊急のシールを印刷する（プリンターにつないだレジの画面で使う）。
 *
 * 共有の WebSocket で受けた注文の中に、緊急にしてあって緊急のシールをまだ印刷していない（emergency_printed_at が空の）
 * カップを見つけたら、先に API で emergency_printed_at を「まだ空なら付ける」で付け、付けられたときだけ印刷する。
 *   - 2 重に印刷しない：付けられるのはどれか 1 つのレジ（タブ）だけ。付けたら注文が配られ、ほかの画面はもう印刷しない
 *   - 印刷に失敗したら emergency_printed_at を空に戻す（次の更新か RETRY_MS 後に、どれかのレジが試し直す）
 *   - つなぎ直したときも全部の注文を受け直すので取りこぼさない（印刷したカップは印が付いているので印刷しない）
 * プリンターにつながっていないレジは何もしない（印を付けない）。
 */
export const useEmergencyLabels = (
  orders: WithId<OrderEntity>[] | undefined,
  printer: ReturnType<typeof usePrinter>,
) => {
  // このタブで扱っている最中のカップ
  const busyRef = useRef(new Set<string>());
  // 印刷に失敗した時刻（カップごと）
  const failedRef = useRef(new Map<string, number>());
  const printerRef = useRef(printer);
  printerRef.current = printer;
  const [tick, setTick] = useState(0);
  const connected = printer.status === "connected";

  useEffect(() => {
    const timer = window.setInterval(() => setTick((t) => t + 1), RETRY_MS);
    return () => window.clearInterval(timer);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: tick は試し直しの合図
  useEffect(() => {
    if (!orders || !connected) return;
    for (const { order, cupId } of pendingEmergencyLabels(orders)) {
      if (busyRef.current.has(cupId)) continue;
      const failedAt = failedRef.current.get(cupId);
      if (failedAt !== undefined && Date.now() - failedAt < RETRY_MS) continue;
      busyRef.current.add(cupId);
      void (async () => {
        let printedAt: Date | null = null;
        try {
          printedAt = await claimEmergencyLabel(order.id, cupId);
          // ほかのレジが先に付けた・もう印刷した
          if (!printedAt) return;
          const ok = await printerRef.current.printEmergencyLabel(order, cupId);
          if (ok) {
            failedRef.current.delete(cupId);
            return;
          }
          failedRef.current.set(cupId, Date.now());
          await releaseEmergencyLabel(order.id, cupId, printedAt);
        } catch (e) {
          console.error("緊急のシールを印刷できませんでした", e);
          failedRef.current.set(cupId, Date.now());
          if (printedAt) {
            await releaseEmergencyLabel(order.id, cupId, printedAt).catch(
              () => undefined,
            );
          }
        } finally {
          busyRef.current.delete(cupId);
        }
      })();
    }
  }, [orders, connected, tick]);
};
