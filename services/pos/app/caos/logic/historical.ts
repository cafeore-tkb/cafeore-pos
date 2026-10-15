import {
  type CaosPracticeOrder,
  type ItemType,
  type PracticeDataOrder,
  cupNeedsBrew,
  jstDate,
  toCaosPracticeOrder,
} from "@cafeore/common";

// 実データテスト（練習）。実データの注文を練習の盤面の注文（本番と同じ形の注文とカップ。@cafeore/common の caosPractice）にし、
// カードは本番と同じ buildCaosCards で組み立てる（hooks/useTestPlay.ts）。豆や抽出が要るかを商品の名前で決めない。

const createdMs = (order: { createdAt: string }) =>
  new Date(order.createdAt).getTime();

/**
 * 実データの品物に、商品の種類の設定（itemType：カップを作る・抽出が要る・上級生のみ）を付ける。
 * 注文したときの設定があればそれ、無ければ POS の今の商品の種類（itemTypes。DB）から名前で引く。
 * どちらにも無い品物は付けない（練習ではカップにせず、実績の杯数にも数えない）
 */
export const withPracticeItemTypes = (
  orders: PracticeDataOrder[],
  itemTypes: readonly ItemType[],
): PracticeDataOrder[] => {
  const typeOf = new Map(itemTypes.map((type) => [type.name, type]));
  return orders.map((order) => ({
    ...order,
    items: order.items.map((item) => {
      const type = typeOf.get(item.type);
      if (item.itemType || !type) return item;
      return {
        ...item,
        itemType: {
          display_name: type.display_name,
          makes_cup: type.makes_cup,
          needs_brew: type.needs_brew,
          senior_only: type.senior_only,
        },
      };
    }),
  }));
};

/**
 * 実データの注文（時刻の順。withPracticeItemTypes で種類の設定を付けたもの）を練習の盤面の注文にする。
 * POS の商品の種類（itemTypes。DB）に同じ名前の種類があれば、ID（色の設定を引く）とアイスかを付ける
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
        if (!type) return cup;
        const item_type = {
          ...cup.item.item_type,
          id: type.id,
          iced_brew: type.iced_brew,
        };
        return { ...cup, item: { ...cup.item, item_type } };
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
 * 実績に出す、届いた注文。提供時間は練習の結果（抽出の要るカップが全部抽出を終えた時刻。練習には提供の画面が無いので、準備完了の代わりに使う）。
 * orders と practiceOrders は同じ並び
 */
export const practiceSalesOrders = (
  orders: PracticeDataOrder[],
  practiceOrders: readonly CaosPracticeOrder[],
  count: number,
): PracticeDataOrder[] =>
  orders.slice(0, count).map((order, index) => {
    const brewCups = practiceOrders[index].cups.filter(cupNeedsBrew);
    const ready = brewCups.every((cup) => cup.brewFinishedAt !== null);
    const readyMs = Math.max(
      ...brewCups.map((cup) => cup.brewFinishedAt?.getTime() ?? 0),
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
 * テストを始められる時刻（30 分ごと）。注文のある日（日本時間）ごとに、最初の注文の 30 分区切りから、
 * 時間帯（durationMinutes 分）に注文がある時刻だけ
 */
export const testPlaySlots = (
  orders: PracticeDataOrder[],
  durationMinutes: number,
) => {
  const durationMs = durationMinutes * 60_000;
  const days = new Map<string, number[]>();
  for (const order of orders) {
    const ms = createdMs(order);
    const day = jstDate(ms);
    days.set(day, [...(days.get(day) ?? []), ms]);
  }
  return Array.from(days.values())
    .sort((a, b) => Math.min(...a) - Math.min(...b))
    .flatMap((timestamps) => {
      // 日本時間は時差が整数の時間なので、エポックのミリ秒で 30 分に切り捨てれば日本時間の 30 分区切り
      const first = Math.floor(Math.min(...timestamps) / SLOT_MS) * SLOT_MS;
      const last = Math.max(...timestamps);
      const slots: number[] = [];
      for (
        let cursor = first;
        cursor + durationMs <= last + SLOT_MS;
        cursor += SLOT_MS
      ) {
        if (ordersInPeriod(orders, cursor, cursor + durationMs).length > 0)
          slots.push(cursor);
      }
      return slots;
    });
};
