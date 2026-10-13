import { type CaosOrderInput, buildCaosCards } from "./caos-board";
import { jstDate } from "./jst";

// 呼び出し画面（お客さんに見せる画面）に出す注文の分け方。DB や画面を使わない純粋な関数だけを置く。
//
//   - お呼び出し中：準備完了で、まだ提供していない注文（注文の readyAt・servedAt）
//   - ドリップ中：準備完了でない注文のうち、カップのどれかを CaOS で淹れ始めた注文
//   - 準備中：それ以外のまだ提供していない注文
//
// ドリップ中かは CaOS のカードの状態（buildCaosCards）で決め、カップの列を自前では読まない。
// 抽出中のカードに加えて終わったカードも数えるのは、2 杯目を待つ間などに「準備中」へ戻して見せないため。
// 番号の下に出すドリッパーは、いま抽出中のカードのものだけ（終わったドリッパーは次の注文を淹れているので出さない）。
// 抽出中のカード（brewing）は、ドリップの案内（「N番のお客様、ファーストにてドリップいたします。」）に使う。

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

/** 抽出中のカード（ドリップの案内に使う） */
export interface CallScreenBrewing {
  /** カードとドリッパーで決まる印。同じカードを別のドリッパーに移して淹れ始めたら変わる */
  key: string;
  dripper: number;
  /** カードで淹れている注文（番号の小さい順。統合したカードは 2 つありうる）。id は注文の ID、orderId は注文番号 */
  orders: { id: string; orderId: number }[];
}

export interface CallScreenOrders {
  /** 注文番号。呼び出した時刻の新しい順（新しいものほど大きく出す） */
  calling: number[];
  /** 抽出中のドリッパーの番号の順。ドリッパーごとの位置が動かないので見つけやすい。抽出中の無い注文は最後 */
  dripping: CallScreenDripping[];
  /** 注文番号。注文した順（淹れる順） */
  preparing: number[];
  /** 準備完了でない注文の、抽出中のカード。緊急（入れ直し）のカードは含めない */
  brewing: CallScreenBrewing[];
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
  const brewingCards: CallScreenBrewing[] = [];
  for (const card of buildCaosCards(notReady)) {
    if (card.status !== "brewing" && card.status !== "done") continue;
    if (card.status === "brewing" && card.dripper !== null && !card.emergency) {
      const cardOrders = new Map(
        card.cups.map((cup) => [cup.orderId, cup.orderNo] as const),
      );
      brewingCards.push({
        key: `${card.key}@${card.dripper}`,
        dripper: card.dripper,
        orders: [...cardOrders]
          .map(([id, orderId]) => ({ id, orderId }))
          .sort((a, b) => a.orderId - b.orderId),
      });
    }
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

  return { calling, dripping, preparing, brewing: brewingCards };
};

/**
 * 呼び出す注文より先に注文した（作成時刻が早い）注文が、まだ待っているか。
 * 呼び出しの音声で「順番が前後いたします。」を冒頭に付けるかに使う。
 *
 * 待っているのは、準備完了でも提供済みでもない注文。同じ日（日本時間）の注文だけを見る
 * （前の日に提供済みにし忘れた注文があっても、毎回断らないように）。
 * 番号は日をまたぐと同じものが出うるので、呼び出す注文は呼び出し中（準備完了・未提供）のうち
 * その番号でいちばん新しいものにする。見つからなければ false
 */
export const isCallOutOfOrder = (
  orders: readonly CallScreenOrderInput[],
  orderNo: number,
): boolean => {
  const called = orders
    .filter(
      (order) =>
        order.orderId === orderNo &&
        order.readyAt !== null &&
        order.servedAt === null,
    )
    .reduce<CallScreenOrderInput | null>(
      (latest, order) =>
        latest === null || order.createdAt > latest.createdAt ? order : latest,
      null,
    );
  if (called === null) return false;

  const day = jstDate(called.createdAt.getTime());
  return orders.some(
    (order) =>
      order !== called &&
      order.readyAt === null &&
      order.servedAt === null &&
      order.createdAt < called.createdAt &&
      jstDate(order.createdAt.getTime()) === day,
  );
};

/** 「よろしければぜひ、お近くでご覧ください。」を付けたあと、付けずに済ませる間（立て続けの案内では省く） */
export const DRIP_INVITE_INTERVAL_MS = 60_000;

/**
 * 淹れ始めたカードで流すドリップの案内。流さなくてよければ null。
 *
 *   - 案内は 1 つの注文につき最初の 1 回だけ（2 杯を続けて・別のドリッパーで淹れても、2 回目からは流さない）。
 *     統合したカードで片方の注文はもう案内していれば、まだの注文の番号だけを読む
 *   - 「よろしければぜひ、お近くでご覧ください。」（invite）は、前にそれを付けた案内から 1 分以内なら省く。
 *     省いた案内からではなく付けた案内から数えるので、続いている間も 1 分に 1 回は付く
 *
 * announcedOrderIds はもう案内した注文の ID、lastInviteAtMs は最後に invite を付けた時刻（まだなら null）
 */
export const planDripAnnouncement = (
  card: CallScreenBrewing,
  announcedOrderIds: ReadonlySet<string>,
  lastInviteAtMs: number | null,
  nowMs: number,
): { orders: CallScreenBrewing["orders"]; invite: boolean } | null => {
  const orders = card.orders.filter(
    (order) => !announcedOrderIds.has(order.id),
  );
  if (orders.length === 0) return null;
  const invite =
    lastInviteAtMs === null ||
    nowMs - lastInviteAtMs >= DRIP_INVITE_INTERVAL_MS;
  return { orders, invite };
};
