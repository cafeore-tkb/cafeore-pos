import { expect, test } from "vitest";
import {
  assertNoPersonalFields,
  mergePracticeFiles,
  toPracticeOrder,
} from "./caosPracticeData";

// 作りものの注文（本物のデータは入れない）
const firestoreOrder = {
  id: "08KglT5FsR3mVzq20x3r",
  orderId: 775,
  createdAt: "2025-11-03T05:16:14.100Z",
  readyAt: "2025-11-03T05:23:28.040Z",
  servedAt: null,
  items: [
    {
      id: "08_special_mocha_blend",
      name: "も花も香ブレンド",
      price: 500,
      type: "hot",
      assignee: "1st:りょん",
    },
  ],
  total: 500,
  comments: [
    {
      author: "serve",
      text: "ゆかりきてないです",
      createdAt: "2025-11-03T05:17:00.000Z",
    },
  ],
  billingAmount: 500,
  received: 1000,
  discount: 0,
};

test("unit: Firestore 版の注文から、許可した項目だけを写す（指名とコメントは落とす）", () => {
  expect(toPracticeOrder(firestoreOrder)).toStrictEqual({
    orderId: 775,
    createdAt: "2025-11-03T05:16:14.100Z",
    readyAt: "2025-11-03T05:23:28.040Z",
    servedAt: null,
    total: 500,
    billingAmount: 500,
    items: [
      {
        id: "08_special_mocha_blend",
        name: "も花も香ブレンド",
        price: 500,
        type: "hot",
      },
    ],
  });
  const json = JSON.stringify(toPracticeOrder(firestoreOrder));
  expect(json).not.toContain("りょん");
  expect(json).not.toContain("ゆかりきてない");
});

test("unit: cafeore-pos の注文（GET /api/orders）も読める", () => {
  const item = (id: string, name: string, type: string) => ({
    id,
    name,
    abbr: name,
    item_type: { id: `t-${type}`, name: type },
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
        assignee: "山田",
        menu: { items: [] },
      },
      {
        id: "m2",
        menu_name: "トート",
        unit_price: 400,
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
    comments: [{ author: "cashier", text: "山田さん指名" }],
  };
  expect(toPracticeOrder(order)).toStrictEqual({
    orderId: 12,
    createdAt: "2026-11-01T01:00:00.000Z",
    readyAt: null,
    servedAt: null,
    total: 900,
    billingAmount: 900,
    items: [
      { id: "champ", name: "優勝ブレンド", price: 500, type: "hot" },
      { id: "tote", name: "トート", price: 400, type: "others" },
    ],
  });
  // 応答の配列をそのまま保存したファイルも読める
  const { orders } = mergePracticeFiles([[order]]);
  expect(orders.map((converted) => converted.orderId)).toStrictEqual([12]);
  expect(JSON.stringify(orders)).not.toContain("山田");
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
  assertNoPersonalFields(orders);
  expect(() =>
    assertNoPersonalFields([{ ...orders[0], comments: [] }]),
  ).toThrow();
});

test("unit: 注文の無いファイルや形の違うファイルは 0 件", () => {
  expect(mergePracticeFiles([{}, null, "x", { orders: "x" }])).toStrictEqual({
    orders: [],
    skipped: 0,
  });
  expect(toPracticeOrder({ name: "x" })).toBeNull();
});
