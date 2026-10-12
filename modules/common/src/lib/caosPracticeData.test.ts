import { expect, test } from "vitest";
import {
  assertAllowedFields,
  mergePracticeFiles,
  readPracticeTexts,
  toPracticeOrder,
} from "./caosPracticeData";

// 作りものの注文（本物のデータは入れない）
const firestoreOrder = {
  id: "firestore-doc-a",
  orderId: 775,
  createdAt: "2025-11-03T05:16:14.100Z",
  readyAt: "2025-11-03T05:23:28.000Z",
  servedAt: null,
  items: [
    {
      id: "special_blend",
      name: "テストブレンド",
      price: 500,
      type: "hot",
      assignee: "1st:テスト担当",
    },
  ],
  total: 500,
  comments: [
    {
      author: "serve",
      text: "テストのコメントです",
      createdAt: "2025-11-03T05:17:00.000Z",
    },
  ],
  billingAmount: 500,
  received: 1000,
  discount: 0,
};

test("unit: Firestore 版の注文から、許可した項目だけを写す（指名は番号にし、名前とコメントは落とす）", () => {
  expect(toPracticeOrder(firestoreOrder)).toStrictEqual({
    orderId: 775,
    createdAt: "2025-11-03T05:16:14.100Z",
    readyAt: "2025-11-03T05:23:28.000Z",
    servedAt: null,
    total: 500,
    billingAmount: 500,
    items: [
      {
        id: "special_blend",
        name: "テストブレンド",
        price: 500,
        type: "hot",
        dripper: 1,
      },
    ],
  });
});

test("unit: Firestore 版の指名（自由記述）は、番号があれば番号に、名前だけなら自由記述のまま", () => {
  const nominationOf = (assignee: unknown) => {
    const order = toPracticeOrder({
      ...firestoreOrder,
      items: [{ ...firestoreOrder.items[0], assignee }],
    });
    const { dripper, assignee: free } = order?.items[0] ?? {};
    return [dripper, free];
  };
  expect(
    ["1st", " 2nd 架空さん", "3-rd", "4th架空", "5", "１ｓｔ", "架空 6th"].map(
      nominationOf,
    ),
  ).toStrictEqual([
    [1, undefined],
    [2, undefined],
    [3, undefined],
    [4, undefined],
    [5, undefined],
    [1, undefined],
    [6, undefined],
  ]);
  // 番号の無いもの・番号が 2 つあるものは自由記述（本番の番号の無い古い明細と同じく指名なし）。7th・21st は番号にしない
  expect(
    ["架空さん", "1st 2nd", "7th", "21st"].map(nominationOf),
  ).toStrictEqual([
    [undefined, "架空さん"],
    [undefined, "1st 2nd"],
    [undefined, "7th"],
    [undefined, "21st"],
  ]);
  expect([null, "", "  ", 3].map(nominationOf)).toStrictEqual([
    [undefined, undefined],
    [undefined, undefined],
    [undefined, undefined],
    [undefined, undefined],
  ]);
});

test("unit: cafeore-pos の注文（GET /api/orders）も読める", () => {
  const item = (id: string, name: string, type: string) => ({
    id,
    name,
    abbr: `${name.slice(0, 2)}`,
    item_type: {
      id: `t-${type}`,
      name: type,
      display_name: `表示-${type}`,
      makes_cup: type !== "others",
      needs_brew: type !== "others",
      senior_only: false,
    },
  });
  const order = {
    id: "0b6c...",
    order_id: 12,
    created_at: "2026-11-01T01:00:00Z",
    ready_at: null,
    served_at: null,
    billing_amount: 900,
    received: 1000,
    menus: [
      {
        id: "m1",
        menu_name: "優勝",
        unit_price: 500,
        dripper: 2,
        assignee: "テスト担当",
        menu: { items: [] },
      },
      {
        id: "m2",
        menu_name: "トート",
        unit_price: 400,
        dripper: 9,
        assignee: null,
        menu: {
          items: [{ item: item("tote", "トート", "others"), quantity: 1 }],
        },
      },
    ],
    cups: [
      {
        id: "c1",
        order_menu_id: "m1",
        item: item("champ", "優勝ブレンド", "hot"),
      },
    ],
    comments: [{ author: "cashier", text: "テスト担当さん指名" }],
  };
  expect(toPracticeOrder(order)).toStrictEqual({
    orderId: 12,
    createdAt: "2026-11-01T01:00:00.000Z",
    readyAt: null,
    servedAt: null,
    total: 900,
    billingAmount: 900,
    items: [
      {
        id: "champ",
        name: "優勝ブレンド",
        abbr: "優勝",
        price: 500,
        type: "hot",
        itemType: {
          display_name: "表示-hot",
          makes_cup: true,
          needs_brew: true,
          senior_only: false,
        },
        dripper: 2,
      },
      {
        id: "tote",
        name: "トート",
        abbr: "トー",
        price: 400,
        type: "others",
        itemType: {
          display_name: "表示-others",
          makes_cup: false,
          needs_brew: false,
          senior_only: false,
        },
      },
    ],
  });
  // 応答の配列をそのまま保存したファイルも読める
  const { orders } = mergePracticeFiles([[order]]);
  expect(orders.map((converted) => converted.orderId)).toStrictEqual([12]);
});

test("unit: 同じ注文が別のファイルにあっても 1 件にし、作った順に並べる", () => {
  const later = {
    ...firestoreOrder,
    id: "b",
    orderId: 776,
    createdAt: "2025-11-03T06:00:00.000Z",
  };
  const { orders, skipped } = mergePracticeFiles([
    { orders: [later, firestoreOrder] },
    { orders: [firestoreOrder, { id: "c", orderId: 1 }] },
  ]);
  expect(orders.map((order) => order.orderId)).toStrictEqual([775, 776]);
  expect(skipped).toBe(1);
  assertAllowedFields(orders);
  expect(() => assertAllowedFields([{ ...orders[0], comments: [] }])).toThrow();
  expect(() =>
    assertAllowedFields([
      { ...orders[0], items: [{ ...orders[0].items[0], staff: "x" }] },
    ]),
  ).toThrow();
});

test("unit: 注文の無いファイルや形の違うファイルは 0 件", () => {
  expect(mergePracticeFiles([{}, null, "x", { orders: "x" }])).toStrictEqual({
    orders: [],
    skipped: 0,
  });
  expect(toPracticeOrder({ name: "x" })).toBeNull();
});

test("unit: 選んだファイルの中身を読み、読めないファイルは理由をつけて返す", () => {
  const { data, problems } = readPracticeTexts([
    { name: "day1.json", text: JSON.stringify({ orders: [firestoreOrder] }) },
    { name: "day12.json", text: JSON.stringify({ orders: [firestoreOrder] }) },
    { name: "empty.json", text: "  " },
    { name: "broken.json", text: "{" },
    { name: "none.json", text: JSON.stringify({ orders: [] }) },
  ]);
  expect(data?.label).toBe("2025年の実績");
  expect(data?.files).toStrictEqual(["day1.json", "day12.json"]);
  expect(data?.orders.map((order) => order.orderId)).toStrictEqual([775]);
  expect(problems).toStrictEqual([
    "empty.json（空のファイル）",
    "broken.json（JSON として読めません）",
    "none.json（注文がありません）",
  ]);
  expect(JSON.stringify(data)).not.toContain("テスト担当");
  expect(JSON.stringify(data)).not.toContain("テストのコメント");
  expect(readPracticeTexts([{ name: "x.json", text: "[]" }]).data).toBeNull();
});
