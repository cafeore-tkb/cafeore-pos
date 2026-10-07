// sohosai-analysis の注文 JSON を、CaOS の実データテストのデータ（ビルドに入れる形）にする。
//
// 入れる項目は下の toPracticeOrder で決めた分だけ（許可したものだけを写す）。
// 担当者名・指名（assignee）・コメント（comments）・お預かり（received）・Firestore の文書 ID などは写さない。
// 人の名前や文章になりうる項目を、元のデータに足されても入れないため。
//
// 読める形は 2 つ：
//   - Firestore 版の POS（2024・2025 年）：{ orders: [{ orderId, createdAt, readyAt, servedAt, total, billingAmount,
//       items: [{ id, name, price, type, assignee }], comments, ... }] }
//   - cafeore-pos（2026 年から）の GET /api/orders の応答：[{ id, order_id, created_at, ready_at, served_at, billing_amount,
//       menus: [{ id, menu_name, unit_price, assignee, menu: { items: [{ item, quantity }] } }], cups: [{ order_menu_id, item }], comments }]
//     （配列のままでも、{ orders: [...] } でもよい）

/** @typedef {{ id: string, name: string, price: number, type: string }} PracticeItem */
/**
 * @typedef {{ orderId: number, createdAt: string, readyAt: string | null, servedAt: string | null,
 *   total: number, billingAmount: number, items: PracticeItem[] }} PracticeOrder
 */

const isoOrNull = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
};

const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);

const text = (value) => (typeof value === "string" ? value.trim() : "");

/** Firestore 版の POS の注文 */
const fromFirestore = (order) => ({
  orderId: num(order.orderId),
  createdAt: isoOrNull(order.createdAt),
  readyAt: isoOrNull(order.readyAt),
  servedAt: isoOrNull(order.servedAt),
  total: num(order.total),
  billingAmount: num(order.billingAmount),
  items: (Array.isArray(order.items) ? order.items : []).map((item) => ({
    id: text(item?.id),
    name: text(item?.name),
    price: num(item?.price),
    type: text(item?.type),
  })),
});

/** cafeore-pos の注文（GET /api/orders）。品物は注文のカップ（無ければメニューの構成）から、値段はメニューの値段を杯数で割る */
const fromCafeorePos = (order) => {
  const items = [];
  let total = 0;
  for (const line of Array.isArray(order.menus) ? order.menus : []) {
    const unitPrice = num(line?.unit_price);
    total += unitPrice;
    const cups = (Array.isArray(order.cups) ? order.cups : []).filter(
      (cup) => cup?.order_menu_id === line?.id,
    );
    const lineItems =
      cups.length > 0
        ? cups.map((cup) => cup.item)
        : (Array.isArray(line?.menu?.items) ? line.menu.items : []).flatMap(
            (entry) =>
              Array.from({ length: num(entry?.quantity) }, () => entry.item),
          );
    const price =
      lineItems.length > 0 ? Math.round(unitPrice / lineItems.length) : 0;
    for (const item of lineItems) {
      items.push({
        id: text(item?.id),
        name: text(item?.name),
        price,
        type: text(item?.item_type?.name),
      });
    }
  }
  return {
    orderId: num(order.order_id),
    createdAt: isoOrNull(order.created_at),
    readyAt: isoOrNull(order.ready_at),
    servedAt: isoOrNull(order.served_at),
    total,
    billingAmount: num(order.billing_amount),
    items,
  };
};

/**
 * 1 件の注文を実データテストの形にする。読めない注文は null。
 * @returns {PracticeOrder | null}
 */
export const toPracticeOrder = (order) => {
  if (!order || typeof order !== "object") return null;
  const raw =
    "orderId" in order
      ? fromFirestore(order)
      : "order_id" in order
        ? fromCafeorePos(order)
        : null;
  if (!raw || raw.createdAt === null) return null;
  // 許可した項目だけを、この順で写す
  return {
    orderId: raw.orderId,
    createdAt: raw.createdAt,
    readyAt: raw.readyAt,
    servedAt: raw.servedAt,
    total: raw.total,
    billingAmount: raw.billingAmount,
    items: raw.items
      .filter((item) => item.name !== "")
      .map((item) => ({
        id: item.id,
        name: item.name,
        price: item.price,
        type: item.type,
      })),
  };
};

/** 注文 JSON（{ orders: [...] } か配列）から注文の配列を取り出す */
export const ordersOf = (json) =>
  Array.isArray(json) ? json : Array.isArray(json?.orders) ? json.orders : [];

/** 重ならないように見分けるキー（day12 と day1・day2 のように、同じ注文が別のファイルにもある） */
const keyOf = (order) =>
  typeof order?.id === "string" && order.id !== ""
    ? `id:${order.id}`
    : `at:${order?.createdAt ?? order?.created_at}|${order?.orderId ?? order?.order_id}`;

/**
 * 1 年分のファイル（中身の JSON）を 1 つの実データにまとめる。同じ注文は 1 件にし、作った順に並べる。
 * @param {unknown[]} jsons
 * @returns {{ orders: PracticeOrder[], skipped: number }}
 */
export const mergeYear = (jsons) => {
  const seen = new Set();
  const orders = [];
  let skipped = 0;
  for (const json of jsons) {
    for (const order of ordersOf(json)) {
      const key = keyOf(order);
      if (seen.has(key)) continue;
      seen.add(key);
      const converted = toPracticeOrder(order);
      if (converted) orders.push(converted);
      else skipped += 1;
    }
  }
  orders.sort(
    (a, b) =>
      Date.parse(a.createdAt) - Date.parse(b.createdAt) ||
      a.orderId - b.orderId,
  );
  return { orders, skipped };
};

/** 出力に、写してはいけない項目が入っていないか（念のため。見つかったら投げる） */
export const assertNoPersonalFields = (orders) => {
  const allowedOrder = new Set([
    "orderId",
    "createdAt",
    "readyAt",
    "servedAt",
    "total",
    "billingAmount",
    "items",
  ]);
  const allowedItem = new Set(["id", "name", "price", "type"]);
  for (const order of orders) {
    for (const key of Object.keys(order)) {
      if (!allowedOrder.has(key))
        throw new Error(`写してはいけない項目があります：${key}`);
    }
    for (const item of order.items) {
      for (const key of Object.keys(item)) {
        if (!allowedItem.has(key))
          throw new Error(`写してはいけない項目があります：items.${key}`);
      }
    }
  }
};
