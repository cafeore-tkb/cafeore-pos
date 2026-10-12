// CaOS の実データテストのデータ。利用者が画面で選んだ注文 JSON を、ブラウザの中でこの形にする
// （読み込んだデータはサーバーにも配信にも出さない。リポジトリにも入れない）。
//
// 入れる項目は下の toPracticeOrder で決めた分だけ（許可したものだけを写す）。
// 指名は、練習の盤面で本番と同じ指名の表示・決まりを出すために写す（ブラウザの中だけなので）。写すのは指名の番号（dripper）と、
// 番号の無い指名の自由記述（assignee。本番と同じく、番号の無い自由記述だけの指名は札に出すだけで指名なし）だけ。
// ほかの担当者名・コメント（comments）・お預かり（received）・Firestore の文書 ID などは写さない。
//
// 読める形は 2 つ：
//   - sohosai-analysis の YYYY/data/day*.json（Firestore 版の POS。2024・2025 年）：
//       { orders: [{ orderId, createdAt, readyAt, servedAt, total, billingAmount,
//         items: [{ id, name, price, type, assignee }], comments, ... }] }
//     （assignee は自由記述。「1st」「1st 名前」「1」のように番号があればその番号、名前だけなら番号の無い自由記述）
//   - cafeore-pos（2026 年から）の GET /api/orders の応答をそのまま保存したもの：
//       [{ id, order_id, created_at, ready_at, served_at, billing_amount,
//         menus: [{ id, menu_name, unit_price, dripper, assignee, menu: { items: [{ item, quantity }] } }],
//         cups: [{ order_menu_id, item }], comments }]
//     （配列のままでも、{ orders: [...] } でもよい）

import { DRIPPER_NUMBERS, dripperLabel } from "../models/dripper";
import { jstDate } from "./jst";

/** 実データの注文の品物（1 杯・1 個ずつ）。id は実績データの商品の ID（無いデータもある） */
export interface PracticeDataItem {
  id: string;
  name: string;
  /** 商品の略称（cafeore-pos の注文にだけある） */
  abbr?: string;
  price: number;
  /** 商品の種類の名前（POS の item_type の name と同じ。2024・2025 年は hot・ice・iceOre・milk・others）。無いデータは "" */
  type: string;
  /** 注文したときの商品の種類の設定（cafeore-pos の注文にだけある） */
  itemType?: PracticeDataItemType;
  /** 指名のドリッパーの番号（1〜6）。指名なし・番号の無い自由記述だけの指名は無し */
  dripper?: number;
  /** 番号の無い指名の自由記述（番号があれば無し） */
  assignee?: string;
}

/** 商品の種類の設定（POS の item_type の表示名と、カップを作る・抽出が要る・限定） */
export interface PracticeDataItemType {
  display_name: string;
  makes_cup: boolean;
  needs_brew: boolean;
  senior_only: boolean;
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

const bool = (value: unknown, fallback: boolean): boolean =>
  typeof value === "boolean" ? value : fallback;

/** 自由記述の中のドリッパーの番号（「1st」「2-nd」「1」。全角も）。無い・2 つ以上あれば null */
const dripperInText = (value: string): number | null => {
  const normalized = value
    .normalize("NFKC")
    .toLowerCase()
    .trim()
    .replace(/(\d)[\s:-]+(?=[a-z])/g, "$1");
  const found = DRIPPER_NUMBERS.filter(
    (n) =>
      normalized === String(n) ||
      new RegExp(`(^|\\D)${dripperLabel(n)}`).test(normalized),
  );
  return found.length === 1 ? found[0] : null;
};

/**
 * 品物の指名（本番の明細の dripper・assignee）。番号は dripper（1〜6）か、無ければ自由記述の中の番号。
 * 自由記述は番号の無いときだけ写す（本番も番号があれば番号を出す）
 */
const nominationOf = (
  dripper: unknown,
  assignee: unknown,
): Pick<PracticeDataItem, "dripper" | "assignee"> => {
  const free = text(assignee);
  const number =
    typeof dripper === "number" && DRIPPER_NUMBERS.includes(dripper)
      ? dripper
      : dripperInText(free);
  if (number !== null) return { dripper: number };
  return free ? { assignee: free } : {};
};

/** cafeore-pos の注文の品物の種類の設定。無ければ undefined */
const itemTypeOf = (type: unknown): PracticeDataItemType | undefined => {
  if (!isObject(type)) return undefined;
  if (
    typeof type.makes_cup !== "boolean" &&
    typeof type.needs_brew !== "boolean" &&
    typeof type.senior_only !== "boolean"
  )
    return undefined;
  return {
    display_name: text(type.display_name),
    makes_cup: bool(type.makes_cup, true),
    needs_brew: bool(type.needs_brew, true),
    senior_only: bool(type.senior_only, false),
  };
};

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
    ...nominationOf(undefined, field(item, "assignee")),
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
    const nomination = nominationOf(
      field(line, "dripper"),
      field(line, "assignee"),
    );
    for (const item of lineItems) {
      const abbr = text(field(item, "abbr"));
      const itemType = itemTypeOf(field(item, "item_type"));
      items.push({
        id: text(field(item, "id")),
        name: text(field(item, "name")),
        ...(abbr ? { abbr } : {}),
        price,
        type: text(field(field(item, "item_type"), "name")),
        ...(itemType ? { itemType } : {}),
        ...nomination,
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
        ...(item.abbr ? { abbr: item.abbr } : {}),
        price: item.price,
        type: item.type,
        ...(item.itemType
          ? {
              itemType: {
                display_name: item.itemType.display_name,
                makes_cup: item.itemType.makes_cup,
                needs_brew: item.itemType.needs_brew,
                senior_only: item.itemType.senior_only,
              },
            }
          : {}),
        ...(item.dripper !== undefined ? { dripper: item.dripper } : {}),
        ...(item.assignee ? { assignee: item.assignee } : {}),
      })),
  };
};

/** 注文 JSON（{ orders: [...] } か配列）から注文の配列を取り出す */
const practiceOrdersOf = (json: unknown): unknown[] =>
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
const ALLOWED_ITEM_KEYS = new Set([
  "id",
  "name",
  "abbr",
  "price",
  "type",
  "itemType",
  "dripper",
  "assignee",
]);
const ALLOWED_ITEM_TYPE_KEYS = new Set([
  "display_name",
  "makes_cup",
  "needs_brew",
  "senior_only",
]);

/** 許可した項目のほかに入っていないか（念のため。見つかったら投げる） */
export const assertAllowedFields = (orders: unknown[]) => {
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
      const itemType = field(item, "itemType");
      for (const key of Object.keys(isObject(itemType) ? itemType : {})) {
        if (!ALLOWED_ITEM_TYPE_KEYS.has(key))
          throw new Error(
            `写してはいけない項目があります：items.itemType.${key}`,
          );
      }
    }
  }
};

/** 読み込んだ実データ（許可した項目だけを写した後） */
export interface PracticeDataset {
  /** どのデータか（例「2025年の実績」）。画面の表示に使う */
  label: string;
  /** 読み込んだファイルの名前（表示用） */
  files: string[];
  orders: PracticeDataOrder[];
  /** 読めなかった注文の数 */
  skipped: number;
}

/** 選んだファイルの名前と中身（文字列） */
export interface PracticeFileText {
  name: string;
  text: string;
}

const labelOf = (orders: PracticeDataOrder[]) => {
  const years = Array.from(
    new Set(
      orders.map((order) => jstDate(Date.parse(order.createdAt)).slice(0, 4)),
    ),
  ).sort();
  return `${years.join("・")}年の実績`;
};

/**
 * 選んだファイル（day1・day2・day12 など）の中身を読み、同じ注文は 1 件にまとめる。
 * problems は読めなかったファイル（中身が JSON でない・空・注文が無い）。1 件も読めなければ data は null
 */
export const readPracticeTexts = (
  files: PracticeFileText[],
): { data: PracticeDataset | null; problems: string[] } => {
  const jsons: unknown[] = [];
  const names: string[] = [];
  const problems: string[] = [];
  for (const file of files) {
    if (file.text.trim() === "") {
      problems.push(`${file.name}（空のファイル）`);
      continue;
    }
    let json: unknown;
    try {
      json = JSON.parse(file.text);
    } catch {
      problems.push(`${file.name}（JSON として読めません）`);
      continue;
    }
    if (mergePracticeFiles([json]).orders.length === 0) {
      problems.push(`${file.name}（注文がありません）`);
      continue;
    }
    jsons.push(json);
    names.push(file.name);
  }
  const { orders, skipped } = mergePracticeFiles(jsons);
  if (orders.length === 0) return { data: null, problems };
  // 念のため：写してはいけない項目が入っていたら使わない
  assertAllowedFields(orders);
  return {
    data: { label: labelOf(orders), files: names, orders, skipped },
    problems,
  };
};
