import type { CaosCard, CaosOrderInput } from "@cafeore/common";

// 抽出を始めていない注文の待ち（ヘッダーの「いちばん古い未割当」「15 分を超えた注文」。入れ忘れ・飛ばしに気づく）。
// 待ちは注文を受けた時刻（注文の createdAt）から数える。

/** 受けてからこの分を超えて、まだ抽出を始めていない注文を「遅れ」として数える */
export const LATE_ORDER_MIN = 15;

/** 待っている注文（注文番号と、受けてからの秒） */
export interface WaitingOrder {
  orderNo: number;
  waitSec: number;
}

// cards のカップの注文を、受けた順（待ちの長い順）に 1 つずつ
const waitingOrders = (
  cards: readonly CaosCard[],
  createdAt: ReadonlyMap<string, Date>,
  nowMs: number,
): WaitingOrder[] => {
  const found = new Map<string, WaitingOrder>();
  for (const cup of cards.flatMap((card) => card.cups)) {
    const at = createdAt.get(cup.orderId);
    if (at && !found.has(cup.orderId))
      found.set(cup.orderId, {
        orderNo: cup.orderNo,
        waitSec: (nowMs - at.getTime()) / 1000,
      });
  }
  return [...found.values()].sort((a, b) => b.waitSec - a.waitSec);
};

/**
 * 抽出を始めていない注文の待ち。orders はカードの注文（受けた時刻を引く）、nowMs は今（実データテスト中は練習の時計）。
 *   - oldestUnassigned：未割当のカップのある注文のうち、いちばん古いもの（無ければ null）
 *   - late：未割当・待機のカップのある注文のうち、受けてから LATE_ORDER_MIN 分を超えたもの（古い順）
 */
export const orderBacklog = (
  cards: readonly CaosCard[],
  orders: readonly CaosOrderInput[],
  nowMs: number,
) => {
  const createdAt = new Map(orders.map((order) => [order.id, order.createdAt]));
  const unstarted = (statuses: CaosCard["status"][]) =>
    waitingOrders(
      cards.filter((card) => statuses.includes(card.status)),
      createdAt,
      nowMs,
    );
  return {
    oldestUnassigned: unstarted(["unassigned"])[0] ?? null,
    late: unstarted(["unassigned", "queued"]).filter(
      (order) => order.waitSec > LATE_ORDER_MIN * 60,
    ),
  };
};
