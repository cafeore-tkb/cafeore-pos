import type { CaosPracticeOrderInput } from "@cafeore/common";

// 実データテストのデータ。ビルドのときに private の sohosai-analysis から作り、配信に入れてある
// （scripts/caos-practice-data/build.mjs。担当者名・指名・コメントは入れていない）。
// このリポジトリには入っていないので、作っていないビルドでは読めない（そのときは「データがありません」）。

/** 実データの注文の品物（1 杯・1 個ずつ）。id は実績データの商品の ID（無いデータもある） */
export interface PracticeDataItem {
  id?: string;
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

/** 実データの一覧の 1 行（年ごと） */
export interface PracticeDatasetEntry {
  id: string;
  label: string;
  file: string;
  orders: number;
  firstAt: string;
  lastAt: string;
}

export interface PracticeDataset {
  id: string;
  label: string;
  orders: PracticeDataOrder[];
}

const base = () =>
  `${import.meta.env.BASE_URL.replace(/\/$/, "")}/caos-practice`;

const readJson = async <T>(path: string): Promise<T | null> => {
  try {
    const response = await fetch(`${base()}/${path}`, { cache: "no-cache" });
    if (!response.ok) return null;
    // データを作っていないビルドでは、開発用のサーバーが index.html を返すことがある
    if (!(response.headers.get("content-type") || "").includes("json"))
      return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
};

/** 実データの一覧。データが無いビルドでは空 */
export const loadPracticeIndex = async (): Promise<PracticeDatasetEntry[]> => {
  const index = await readJson<{ datasets?: PracticeDatasetEntry[] }>(
    "index.json",
  );
  return Array.isArray(index?.datasets) ? index.datasets : [];
};

/** 1 年分の実データ。読めなければ null */
export const loadPracticeDataset = async (
  entry: PracticeDatasetEntry,
): Promise<PracticeDataset | null> => {
  const dataset = await readJson<PracticeDataset>(entry.file);
  return dataset && Array.isArray(dataset.orders) ? dataset : null;
};

const createdMs = (order: PracticeDataOrder) =>
  new Date(order.createdAt).getTime();

/** 時間帯 [startMs, endMs) の注文（作った順） */
export const ordersInWindow = (
  orders: PracticeDataOrder[],
  startMs: number,
  endMs: number,
) =>
  orders
    .filter((order) => createdMs(order) >= startMs && createdMs(order) < endMs)
    .sort((a, b) => createdMs(a) - createdMs(b));

/**
 * 実データの注文を、練習用の盤面に送る形にする。同じ商品（ID、無ければ名前）は 1 行にまとめて杯数にする。
 * どれを抽出するか・何杯ずつのカードにするかはサーバーの盤面のルールで決まる（ここでは分けない）
 */
export const toPracticeOrderInput = (
  order: PracticeDataOrder,
): CaosPracticeOrderInput => {
  const lines = new Map<string, CaosPracticeOrderInput["lines"][number]>();
  for (const item of order.items) {
    const key = item.id || item.name;
    const line = lines.get(key);
    if (line) {
      line.quantity += 1;
      continue;
    }
    lines.set(key, {
      item_key: key,
      name: item.name,
      type: item.type,
      price: item.price,
      quantity: 1,
    });
  }
  return {
    order_no: order.orderId,
    created_at: order.createdAt,
    billing_amount: order.billingAmount,
    lines: Array.from(lines.values()),
  };
};
