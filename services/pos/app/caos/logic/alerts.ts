import type { CaosCard } from "@cafeore/common";

// 入れ忘れ・「次へ」の押し忘れ・割り当て忘れに気づくための知らせ。しきい値はここだけで決める。

/** 予定の抽出時間をこれだけ（秒）過ぎても「次へ」が押されていない抽出は、入れ忘れか押し忘れかもしれない（列の番号を点滅させ、音で知らせる。logic/queue の laneStatus） */
export const FORGOTTEN_BREW_SEC = 120;

/** 受けてからこれだけ（秒）たっても未割当のカードに、待っている時間の札を付ける */
const LONG_WAIT_SEC = 300;

/** 長く待っている未割当のカードなら、受けてから（入れ直しは入れ直してから）の分。ほかは null。統合したカードはいちばん早いカップから数える（入れ直しは入れ直しどうしでしか統合しないので、注文と入れ直しの時刻は混ざらない） */
export const longWaitMinutes = (card: CaosCard, nowMs: number) => {
  if (card.status !== "unassigned") return null;
  const orderedMs = Math.min(
    ...card.cups.map((cup) => cup.orderedAt.getTime()),
  );
  const waitedSec = (nowMs - orderedMs) / 1000;
  return waitedSec >= LONG_WAIT_SEC ? Math.floor(waitedSec / 60) : null;
};

/** 受けてからこれだけ（秒）を超えて、まだ抽出を始めていない（未割当・待機の）注文を、ヘッダーで「15分超 N件」と数える */
export const LATE_ORDER_SEC = 15 * 60;

/** 待っている注文（注文番号と、受けてからの秒。late は LATE_ORDER_SEC を超えた） */
export interface WaitingOrder {
  orderNo: number;
  waitSec: number;
  late: boolean;
}

// cards のカップの注文を、待ちの長い順に 1 つずつ（受けた時刻はカップの orderedAt。入れ直しは入れ直した時刻）
const waitingOrders = (cards: readonly CaosCard[], nowMs: number) => {
  const found = new Map<string, WaitingOrder>();
  for (const cup of cards.flatMap((card) => card.cups)) {
    const waitSec = (nowMs - cup.orderedAt.getTime()) / 1000;
    const seen = found.get(cup.orderId);
    if (!seen || waitSec > seen.waitSec)
      found.set(cup.orderId, {
        orderNo: cup.orderNo,
        waitSec,
        late: waitSec > LATE_ORDER_SEC,
      });
  }
  return [...found.values()].sort((a, b) => b.waitSec - a.waitSec);
};

/**
 * 抽出を始めていない注文の待ち（ヘッダー。飛ばした注文・入れ忘れに気づく）。nowMs は今（実データテスト中は練習の時計）。
 *   - oldestUnassigned：未割当のカップのある注文のうち、いちばん長く待っているもの（無ければ null）
 *   - late：未割当・待機のカップのある注文のうち、受けてから LATE_ORDER_SEC を超えたもの（長く待っている順）
 */
export const orderBacklog = (cards: readonly CaosCard[], nowMs: number) => {
  const unstarted = (statuses: CaosCard["status"][]) =>
    waitingOrders(
      cards.filter((card) => statuses.includes(card.status)),
      nowMs,
    );
  const unassigned = unstarted(["unassigned"]);
  return {
    smallestUnassigned: unassigned.length
      ? Math.min(...unassigned.map((order) => order.orderNo))
      : null,
    oldestUnassigned: unstarted(["unassigned"])[0] ?? null,
    late: unstarted(["unassigned", "queued"]).filter((order) => order.late),
  };
};
