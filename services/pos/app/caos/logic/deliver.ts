import type { CaosDeliverCall, CaosDeliveredOrder } from "@cafeore/common";
import { orderNoLabel } from "./cards";

// ドリップ完了の報告の画面（/master-sheet/deliver）で、報告したあとに出す知らせ。
// 注文ごとに、サーバーがどうしたか（呼び出した・提供で仕上げる・ほかの杯を待つ・もう呼び出し中）を 1 行ずつ出す。

/** 知らせの重さ。呼び出したら good、提供に手を頼むなら ask、何もしないなら info */
export type DeliverTone = "good" | "ask" | "info";

const CALL_TEXT: Record<
  CaosDeliverCall,
  { tone: DeliverTone; text: string; hint: string }
> = {
  called: {
    tone: "good",
    text: "を呼び出しました",
    hint: "カップを受け取り口に置いてください",
  },
  finishing: {
    tone: "ask",
    text: "は提供で仕上げます",
    hint: "提供に渡してください（ミルクなどを入れてから呼び出します）",
  },
  waiting: {
    tone: "info",
    text: "はほかの杯を待っています",
    hint: "残りの杯が届いたら呼び出します",
  },
  already: {
    tone: "info",
    text: "はもう呼び出し中か、届け済みです",
    hint: "カップを提供に渡してください",
  },
};

/** 報告の応答（注文ごと）を、知らせの行にする。注文番号は CaOS と同じ 3 桁 */
export const deliverNotices = (orders: readonly CaosDeliveredOrder[]) =>
  orders.map((order) => ({
    key: order.id,
    label: `#${orderNoLabel(order.order_id)}`,
    ...CALL_TEXT[order.call],
  }));

/** 知らせ全体の重さ。どれかを提供に頼むなら ask、どれかを呼び出したなら good */
export const deliverTone = (
  notices: readonly { tone: DeliverTone }[],
): DeliverTone =>
  notices.some(({ tone }) => tone === "ask")
    ? "ask"
    : notices.some(({ tone }) => tone === "good")
      ? "good"
      : "info";
