// CaOS の実データテストのデータ。利用者が画面で選んだ注文 JSON を、ブラウザの中でこの形にする
// （読み込んだデータはサーバーにも配信にも出さない。練習用の盤面に送るのは、ここで作った注文から作る練習の注文だけ）。
//
// 入れる項目は下の toPracticeOrder で決めた分だけ（許可したものだけを写す）。
// 担当者名・指名（assignee）・コメント（comments）・お預かり（received）・Firestore の文書 ID などは写さない。
// 人の名前や文章になりうる項目を、元のデータに足されても入れないため。
//
// 読める形は 2 つ：
//   - sohosai-analysis の YYYY/data/day*.json（Firestore 版の POS。2024・2025 年）：
//       { orders: [{ orderId, createdAt, readyAt, servedAt, total, billingAmount,
//         items: [{ id, name, price, type, assignee }], comments, ... }] }
//   - cafeore-pos（2026 年から）の GET /api/orders の応答をそのまま保存したもの：
//       [{ id, order_id, created_at, ready_at, served_at, billing_amount,
//         menus: [{ id, menu_name, unit_price, assignee, menu: { items: [{ item, quantity }] } }],
//         cups: [{ order_menu_id, item }], comments }]
//     （配列のままでも、{ orders: [...] } でもよい）

/** 実データの注文の品物（1 杯・1 個ずつ）。id は実績データの商品の ID（無いデータもある） */
export interface PracticeDataItem {
  id: string;
  name: string;
  price: number;
  /** 商品の種類（POS の item_type の name と同じ。hot・ice・iceOre・milk・others・limited など） */
  type: string;
}

/** 実データの注文 */
export interface PracticeDataOrder {
  orderId: number;
  createdAt: string;
  readyAt: string | null;
  servedAt: string | null;
  total: number;
  billingAmount: number;
  items: PracticeDataItem[];
}

// 読み込んだ JSON は形が分からないので、ゆるく読む
type Loose = Record<string, unknown>;

const isObject = (value: unknown): value is Loose =>
  typeof value === "object" && value !== null;

const asArray = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];

const field = (value: unknown, key: string): unknown =>
  isObject(value) ? value[key] : undefined;

const isoOrNull = (value: unknown): string | null => {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" && typeof value !== "number") return null;
  const ms = typeof value === "number" ? value : Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
};

const num = (value: unknown): number =>
  Number.isFinite(Number(value)) ? Number(value) : 0;

const text = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

interface RawOrder {
  orderId: number;
  createdAt: string | null;
  readyAt: string | null;
  servedAt: string | null;
  total: number;
  billingAmount: number;
  items: PracticeDataItem[];
}

/** Firestore 版の POS の注文 */
const fromFirestore = (order: Loose): RawOrder => ({
  orderId: num(order.orderId),
  createdAt: isoOrNull(order.createdAt),
  readyAt: isoOrNull(order.readyAt),
  servedAt: isoOrNull(order.servedAt),
  total: num(order.total),
  billingAmount: num(order.billingAmount),
  items: asArray(order.items).map((item) => ({
    id: text(field(item, "id")),
    name: text(field(item, "name")),
    price: num(field(item, "price")),
    type: text(field(item, "type")),
  })),
});

/** cafeore-pos の注文（GET /api/orders）。品物は注文のカップ（無ければメニューの構成）から、値段はメニューの値段を杯数で割る */
const fromCafeorePos = (order: Loose): RawOrder => {
  const items: PracticeDataItem[] = [];
  let total = 0;
  const cups = asArray(order.cups);
  for (const line of asArray(order.menus)) {
    const unitPrice = num(field(line, "unit_price"));
    total += unitPrice;
    const lineCups = cups.filter(
      (cup) => field(cup, "order_menu_id") === field(line, "id"),
    );
    const lineItems =
      lineCups.length > 0
        ? lineCups.map((cup) => field(cup, "item"))
        : asArray(field(field(line, "menu"), "items")).flatMap((entry) =>
            Array.from(
              {
                length: Math.max(0, Math.floor(num(field(entry, "quantity")))),
              },
              () => field(entry, "item"),
            ),
          );
    const price =
      lineItems.length > 0 ? Math.round(unitPrice / lineItems.length) : 0;
    for (const item of lineItems) {
      items.push({
        id: text(field(item, "id")),
        name: text(field(item, "name")),
        price,
        type: text(field(field(item, "item_type"), "name")),
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

/** 1 件の注文を実データテストの形にする。読めない注文は null */
export const toPracticeOrder = (order: unknown): PracticeDataOrder | null => {
  if (!isObject(order)) return null;
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
export const practiceOrdersOf = (json: unknown): unknown[] =>
  Array.isArray(json) ? json : asArray(field(json, "orders"));

/** 重ならないように見分けるキー（day12 と day1・day2 のように、同じ注文が別のファイルにもある） */
const keyOf = (order: unknown) => {
  const id = field(order, "id");
  if (typeof id === "string" && id !== "") return `id:${id}`;
  const createdAt = field(order, "createdAt") ?? field(order, "created_at");
  const orderId = field(order, "orderId") ?? field(order, "order_id");
  return `at:${String(createdAt)}|${String(orderId)}`;
};

/**
 * 複数のファイル（中身の JSON）を 1 つの実データにまとめる。同じ注文は 1 件にし、作った順に並べる。
 * skipped は読めなかった注文の数（作った時刻が無いなど）
 */
export const mergePracticeFiles = (
  jsons: unknown[],
): { orders: PracticeDataOrder[]; skipped: number } => {
  const seen = new Set<string>();
  const orders: PracticeDataOrder[] = [];
  let skipped = 0;
  for (const json of jsons) {
    for (const order of practiceOrdersOf(json)) {
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

const ALLOWED_ORDER_KEYS = new Set([
  "orderId",
  "createdAt",
  "readyAt",
  "servedAt",
  "total",
  "billingAmount",
  "items",
]);
const ALLOWED_ITEM_KEYS = new Set(["id", "name", "price", "type"]);

/** 写してはいけない項目が入っていないか（念のため。見つかったら投げる） */
export const assertNoPersonalFields = (orders: unknown[]) => {
  for (const order of orders) {
    for (const key of Object.keys(isObject(order) ? order : {})) {
      if (!ALLOWED_ORDER_KEYS.has(key))
        throw new Error(`写してはいけない項目があります：${key}`);
    }
    for (const item of asArray(field(order, "items"))) {
      for (const key of Object.keys(isObject(item) ? item : {})) {
        if (!ALLOWED_ITEM_KEYS.has(key))
          throw new Error(`写してはいけない項目があります：items.${key}`);
      }
    }
  }
};
