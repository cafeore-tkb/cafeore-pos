import { OrderEntity } from "@cafeore/common";
import { describe, expect, test } from "vitest";
import { snapshotAnalysisOrders } from "./snapshotComparison";
const snapshot = () => ({
  ...OrderEntity.createNew({ orderId: 12 }).toOrder(),
  createdAt: new Date("2024-10-19T10:00:00+09:00"),
  billingAmount: 1000,
  menus: [
    {
      id: "00000000-0000-4000-8000-000000000001",
      name: "セット",
      abbr: "セ",
      price: 1000,
      key: "s",
      priority: 0,
      assignee: null,
      dripper: null,
      items: [
        {
          quantity: 2,
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
            },
          },
        },
      ],
    },
  ],
});
describe("unit snapshot comparison", () => {
  test("2025以外の旧注文JSONでも数量を保持し杯を展開する", () => {
    const result = snapshotAnalysisOrders(
      JSON.stringify({ orders: [snapshot()] }),
    );
    expect(result[0].created).toBe(new Date(snapshot().createdAt).getTime());
    expect(result[0].cups).toHaveLength(2);
    expect(result[0].revenue).toBe(1000);
    expect(result[0].cups.every((c) => c.orderTiming)).toBe(true);
  });
  test("2025形式を受け付け、グッズを杯に加えない", () => {
    const result = snapshotAnalysisOrders(
      JSON.stringify([
        {
          orderId: 1,
          createdAt: "2025-11-02T10:00:00+09:00",
          billingAmount: 600,
          items: [
            { name: "牛乳", type: "milk" },
            { name: "グッズ", type: "others" },
          ],
        },
      ]),
    );
    expect(result[0].cups.map((c) => c.product)).toEqual(["牛乳"]);
  });
  test("壊れた日時・数量や空データは0件に置換せずエラー", () => {
    expect(() =>
      snapshotAnalysisOrders(
        JSON.stringify({ orders: [{ ...snapshot(), createdAt: "broken" }] }),
      ),
    ).toThrow();
    expect(() => snapshotAnalysisOrders('{"orders":[]}')).toThrow();
    expect(() => snapshotAnalysisOrders('{"orders":[{}]}')).toThrow();
  });
});
