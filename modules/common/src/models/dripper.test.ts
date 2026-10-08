import { describe, expect, test } from "vitest";
import {
  assignmentDisplay,
  assignmentLabelText,
  dripperLabel,
  dripperSchema,
} from "./dripper";
import { cashierStateWireSchema } from "./global";
import { MenuEntity } from "./menu";

const menu = () =>
  MenuEntity.fromMenu({
    id: "00000000-0000-4000-8000-000000000001",
    name: "ブレンド",
    abbr: "ブ",
    price: 500,
    key: "q",
    assignee: null,
    items: [
      {
        item: {
          id: "00000000-0000-4000-8000-000000000002",
          name: "ブレンド",
          abbr: "ブ",
          item_type: {
            name: "hot",
            display_name: "ホット",
            makes_cup: true,
            needs_brew: true,
            senior_only: false,
            iced_brew: false,
          },
        },
        quantity: 1,
      },
    ],
  });

describe("[unit] dripper", () => {
  test("番号は 1st〜6th と出す", () => {
    expect([1, 2, 3, 4, 5, 6].map(dripperLabel)).toEqual([
      "1st",
      "2nd",
      "3rd",
      "4th",
      "5th",
      "6th",
    ]);
  });

  test("番号は 1〜6 の整数だけ", () => {
    expect(dripperSchema.safeParse(1).success).toBe(true);
    expect(dripperSchema.safeParse(6).success).toBe(true);
    expect(dripperSchema.safeParse(0).success).toBe(false);
    expect(dripperSchema.safeParse(7).success).toBe(false);
    expect(dripperSchema.safeParse(1.5).success).toBe(false);
  });

  test("ラベルは自由記述があればその文、無ければ番号", () => {
    expect(assignmentLabelText({ dripper: 2, assignee: null })).toBe("2nd");
    expect(assignmentLabelText({ dripper: 2, assignee: "山田" })).toBe("山田");
    expect(assignmentLabelText({ dripper: null, assignee: null })).toBeNull();
  });

  test("内部の表示は番号。番号より前の注文は自由記述", () => {
    expect(assignmentDisplay({ dripper: 3, assignee: "山田" })).toBe("3rd");
    expect(assignmentDisplay({ dripper: null, assignee: "1st" })).toBe("1st");
    expect(assignmentDisplay({ dripper: null, assignee: null })).toBeNull();
  });

  test("指名は番号が必須で、番号を外すと自由記述も消える", () => {
    const m = menu();
    expect(m.dripper).toBeNull();
    m.assign(5, "  山田 ");
    expect([m.dripper, m.assignee]).toEqual([5, "山田"]);
    m.assign(5, "   ");
    expect([m.dripper, m.assignee]).toEqual([5, null]);
    m.assign(null, "山田");
    expect([m.dripper, m.assignee]).toEqual([null, null]);
  });

  test("番号は複製や toMenu でも残る", () => {
    const m = menu();
    m.assign(6, "山田");
    expect(m.clone().toMenu()).toMatchObject({ dripper: 6, assignee: "山田" });
  });

  test("番号より前のレジの状態（dripper が無い）も読める", () => {
    const parsed = cashierStateWireSchema.parse({
      id: "cashier-state",
      submittedOrderId: null,
      edittingOrder: {
        orderId: 1,
        createdAt: "2026-09-11T00:00:00.000Z",
        readyAt: null,
        servedAt: null,
        menus: [{ ...menu().toMenu(), dripper: undefined, assignee: "1st" }],
        total: 500,
        comments: [],
        billingAmount: 500,
        received: 0,
        discountOrderId: null,
        discountOrderCups: 0,
        DISCOUNT_PER_CUP: 100,
        discount: 0,
        estimateTime: 0,
      },
    });
    expect(parsed.edittingOrder.menus[0]).toMatchObject({
      dripper: null,
      assignee: "1st",
    });
  });
});
