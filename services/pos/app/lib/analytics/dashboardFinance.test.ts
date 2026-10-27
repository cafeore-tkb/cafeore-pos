import { type Order, OrderEntity } from "@cafeore/common";
import { describe, expect, test } from "vitest";
import { dashboardFinance } from "./dashboardFinance";
const now = Date.parse("2026-10-19T15:00:00+09:00");
const order = (fields: Partial<Order> = {}) =>
  OrderEntity.fromOrder({
    ...OrderEntity.createNew({ orderId: 1 }).toOrder(),
    id: "saved-order",
    createdAt: new Date("2026-10-19T10:00:00+09:00"),
    billingAmount: 1000,
    menus: [
      {
        id: "00000000-0000-4000-8000-000000000001",
        name: "ブレンド",
        abbr: "ブ",
        price: fields.billingAmount ?? 1000,
        key: "b",
        priority: 0,
        assignee: null,
        dripper: null,
        items: [
          {
            quantity: 1,
            item: {
              id: "00000000-0000-4000-8000-000000000002",
              name: "豆",
              abbr: "豆",
              item_type: {
                name: "hot",
                display_name: "ホット",
                makes_cup: true,
                needs_brew: true,
                senior_only: false,
                iced_brew: false,
                serve_with_snack: false,
              },
            },
          },
        ],
      },
    ],
    ...fields,
  });
const finance = (orders: OrderEntity[]) =>
  dashboardFinance(orders, now, now, "2026-10-19");
describe("unit dashboard finance", () => {
  test("一部支払いを売上と混ぜず、差額を残す", () => {
    const f = finance([
      order({
        payments: [
          {
            method: "cash",
            amount: 200,
            received: 200,
            discount: 0,
            menuIndexes: [],
          },
          {
            method: "square",
            amount: 300,
            received: 300,
            discount: 0,
            menuIndexes: [],
            squarePaymentType: "QR_CODE",
          },
        ],
      }),
    ]);
    expect(f).toMatchObject({
      billing: 1000,
      paymentTotal: 500,
      cash: 200,
      square: 300,
      difference: 500,
      average: 1000,
    });
    expect(f.squareDetails).toEqual([
      { type: "QR_CODE", amount: 300, label: "QRコード" },
    ]);
  });
  test("一括会計は方法を使い、未記録を現金にしない", () => {
    expect(
      finance([order({ paymentMethod: "square" }), order()]),
    ).toMatchObject({
      square: 1000,
      cash: 0,
      billing: 2000,
      paymentTotal: 1000,
      unclassified: 1000,
      lumpSum: 1000,
      difference: 1000,
    });
  });
  test("過払いと取消、カットオフちょうどの取消", () => {
    const payments: Order["payments"] = [
      {
        method: "cash",
        amount: 1200,
        received: 1200,
        discount: 0,
        menuIndexes: [],
      },
    ];
    expect(
      finance([
        order({ payments }),
        order({ cancelledAt: new Date(now - 1), paymentMethod: "square" }),
      ]),
    ).toMatchObject({ difference: -200, cancelled: 1, billing: 1000 });
    expect(
      finance([order({ cancelledAt: new Date(now), paymentMethod: "cash" })])
        .billing,
    ).toBe(1000);
  });
  test("0円注文があってもピークを作らず、ゼロの時間枠を残す", () => {
    const f = finance([order({ billingAmount: 0, paymentMethod: "cash" })]);
    expect(f.peak).toBeNull();
    expect(f.hourly).toHaveLength(16);
    expect(f.hourly[10].orders).toBe(1);
    expect(f.hourly[9].revenue).toBe(0);
    expect(finance([]).peak).toBeNull();
  });
  test("期間端の一部だけの時間帯とゼロ売上の枠を残す", () => {
    const window = {
      start: Date.parse("2026-10-19T10:15:00+09:00"),
      end: Date.parse("2026-10-19T12:05:00+09:00"),
    };
    const f = dashboardFinance([], window.end, now, "2026-10-19", window);
    expect(f.hourly.map((h) => h.label)).toEqual(["10:00", "11:00", "12:00"]);
    expect(f.hourly.every((h) => h.revenue === 0)).toBe(true);
  });
});
