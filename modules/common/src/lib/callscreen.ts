import { type CaosOrderInput, buildCaosCards } from "./caos-board";

// 呼び出し画面（お客さんに見せる画面）に出す注文の分け方。DB や画面を使わない純粋な関数だけを置く。
//
//   - お呼び出し中：準備完了で、まだ提供していない注文（注文の readyAt・servedAt）
//   - ドリップ中：準備完了でない注文のうち、カップのどれかを CaOS で淹れ始めた注文
//   - 準備中：それ以外のまだ提供していない注文
//
// ドリップ中かは CaOS のカードの状態（buildCaosCards）で決め、カップの列を自前では読まない。
// 抽出中のカードに加えて終わったカードも数えるのは、2 杯目を待つ間などに「準備中」へ戻して見せないため。
// 番号の下に出すドリッパーは、いま抽出中のカードのものだけ（終わったドリッパーは次の注文を淹れているので出さない）。

/** 呼び出し画面が使う注文（OrderEntity をそのまま渡せる） */
export interface CallScreenOrderInput extends CaosOrderInput {
  readyAt: Date | null;
  servedAt: Date | null;
}

export interface CallScreenDripping {
  orderId: number;
  /** いま抽出中のドリッパーの番号（小さい順）。淹れ終えて準備完了を待っている注文は空 */
  drippers: number[];
}

export interface CallScreenOrders {
  /** 注文番号。呼び出した時刻の新しい順（新しいものほど大きく出す） */
  calling: number[];
  /** 抽出中のドリッパーの番号の順。ドリッパーごとの位置が動かないので見つけやすい。抽出中の無い注文は最後 */
  dripping: CallScreenDripping[];
  /** 注文番号。注文した順（淹れる順） */
  preparing: number[];
}

/**
 * まだ提供していない注文を、お呼び出し中・ドリップ中・準備中に分ける
 */
export const splitCallScreenOrders = (
  orders: readonly CallScreenOrderInput[],
): CallScreenOrders => {
  const unserved = orders.filter((order) => order.servedAt === null);
  const notReady = unserved.filter((order) => order.readyAt === null);

  // 注文（id）ごとの、淹れ始めたか・抽出中のドリッパー
  const started = new Set<string>();
  const brewing = new Map<string, Set<number>>();
  for (const card of buildCaosCards(notReady)) {
    if (card.status !== "brewing" && card.status !== "done") continue;
    for (const cup of card.cups) {
      started.add(cup.orderId);
      if (card.status === "brewing" && card.dripper !== null) {
        const drippers = brewing.get(cup.orderId) ?? new Set();
        drippers.add(card.dripper);
        brewing.set(cup.orderId, drippers);
      }
    }
  }

  const calling = unserved
    .filter((order) => order.readyAt !== null)
    .sort(
      (a, b) =>
        (b.readyAt?.getTime() ?? 0) - (a.readyAt?.getTime() ?? 0) ||
        b.orderId - a.orderId,
    )
    .map((order) => order.orderId);

  const firstDripper = (item: CallScreenDripping) =>
    item.drippers[0] ?? Number.POSITIVE_INFINITY;
  const dripping = notReady
    .filter((order) => started.has(order.id))
    .map((order) => ({
      orderId: order.orderId,
      drippers: [...(brewing.get(order.id) ?? [])].sort((a, b) => a - b),
    }))
    .sort((a, b) => firstDripper(a) - firstDripper(b) || a.orderId - b.orderId);

  const preparing = notReady
    .filter((order) => !started.has(order.id))
    .sort(
      (a, b) =>
        a.createdAt.getTime() - b.createdAt.getTime() || a.orderId - b.orderId,
    )
    .map((order) => order.orderId);

  return { calling, dripping, preparing };
};
