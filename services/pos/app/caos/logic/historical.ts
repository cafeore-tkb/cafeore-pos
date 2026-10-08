import {
  type CaosPracticeOrder,
  type ItemType,
  type PracticeDataOrder,
  cupNeedsBrew,
  toCaosPracticeOrder,
} from "@cafeore/common";

// 実データテスト（練習）。実データの注文を練習の盤面の注文（本番と同じ形の注文とカップ。@cafeore/common の caosPractice）にし、
// カードは本番と同じ buildCaosCards で組み立てる（hooks/useTestPlay.ts）。豆や抽出が要るかを商品の名前で決めない。

const createdMs = (order: { createdAt: string }) =>
  new Date(order.createdAt).getTime();

/**
 * 実データの注文（時刻の順）を練習の盤面の注文にする。商品の種類は POS の商品の種類（itemTypes。DB）から名前で引き、
 * 表示名と ID（色の設定を引く）を付ける。POS に無い種類は名前のまま
 */
export const toPracticeOrders = (
  orders: PracticeDataOrder[],
  itemTypes: readonly ItemType[],
): CaosPracticeOrder[] => {
  const typeOf = new Map(itemTypes.map((type) => [type.name, type]));
  return orders.map((order, index) => {
    const practice = toCaosPracticeOrder(order, index);
    return {
      ...practice,
      cups: practice.cups.map((cup) => {
        const type = typeOf.get(cup.item.item_type.name);
        return type ? { ...cup, item: { ...cup.item, item_type: type } } : cup;
      }),
    };
  });
};

/** 時刻（nowMs）までに届いた注文の数（注文は時刻の順なので、先頭からこの数だけが盤面に出る） */
export const arrivedCount = (
  orders: readonly { createdAt: Date }[],
  nowMs: number,
) => {
  const index = orders.findIndex((order) => order.createdAt.getTime() > nowMs);
  return index < 0 ? orders.length : index;
};

/**
 * 実績に出す、届いた注文。提供時間は練習の結果（抽出の要るカップが全部準備完了になった時刻）。
 * orders と practiceOrders は同じ並び
 */
export const practiceSalesOrders = (
  orders: PracticeDataOrder[],
  practiceOrders: readonly CaosPracticeOrder[],
  count: number,
): PracticeDataOrder[] =>
  orders.slice(0, count).map((order, index) => {
    const brewCups = practiceOrders[index].cups.filter(cupNeedsBrew);
    const ready = brewCups.every((cup) => cup.readyAt !== null);
    const readyMs = Math.max(
      ...brewCups.map((cup) => cup.readyAt?.getTime() ?? 0),
    );
    return {
      ...order,
      readyAt:
        brewCups.length > 0 && ready ? new Date(readyMs).toISOString() : null,
      servedAt: null,
    };
  });

/** startMs から endMs までの注文を時刻の順に */
export const ordersInPeriod = (
  orders: PracticeDataOrder[],
  startMs: number,
  endMs: number,
) =>
  orders
    .filter((order) => createdMs(order) >= startMs && createdMs(order) < endMs)
    .sort((a, b) => createdMs(a) - createdMs(b) || a.orderId - b.orderId);

/** テストの残り（「12分」） */
export const testPlayRemainingLabel = (session: {
  endMs: number;
  currentMs: number;
}) =>
  `${Math.max(0, Math.ceil((session.endMs - session.currentMs) / 60_000))}分`;

const SLOT_MS = 30 * 60_000;

/**
 * テストを始められる時刻（30 分ごと）。注文のある日ごとに、最初の注文の 30 分区切りから、
 * 時間帯（durationMinutes 分）に注文がある時刻だけ
 */
export const testPlaySlots = (
  orders: PracticeDataOrder[],
  durationMinutes: number,
) => {
  const durationMs = durationMinutes * 60_000;
  const days = new Map<string, number[]>();
  for (const order of orders) {
    const date = new Date(order.createdAt);
    const dayKey = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    days.set(dayKey, [...(days.get(dayKey) ?? []), date.getTime()]);
  }
  return Array.from(days.values())
    .sort((a, b) => Math.min(...a) - Math.min(...b))
    .flatMap((timestamps) => {
      const first = new Date(Math.min(...timestamps));
      first.setMinutes(first.getMinutes() < 30 ? 0 : 30, 0, 0);
      const last = Math.max(...timestamps);
      const slots: number[] = [];
      for (
        let cursor = first.getTime();
        cursor + durationMs <= last + SLOT_MS;
        cursor += SLOT_MS
      ) {
        if (ordersInPeriod(orders, cursor, cursor + durationMs).length > 0)
          slots.push(cursor);
      }
      return slots;
    });
};
