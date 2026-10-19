import { describe, expect, test } from "vitest";
import { getDiscountOrderStatus } from "../lib/discount-validation";
import type { WithId } from "../lib/typeguard";
import { type Order, OrderEntity } from "./order";

/** 保存した注文（id 付き）。指定しなければ、現金で払った ¥600 の提供済みの注文 */
const saved = (orderId: number, fields: Partial<Order> = {}) =>
  OrderEntity.fromOrder({
    ...OrderEntity.createNew({ orderId }).toOrder(),
    id: `order-${orderId}`,
    billingAmount: 600,
    received: 600,
    paymentMethod: "cash",
    servedAt: new Date("2026-10-17T10:00:00Z"),
    ...fields,
  } as WithId<Order>);

const at = new Date("2026-10-17T11:00:00Z");

const split = (fields: Partial<Order>) =>
  saved(1, {
    paymentMethod: "square",
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
        amount: 400,
        received: 400,
        discount: 0,
        menuIndexes: [],
      },
    ] as Order["payments"],
    ...fields,
  });

describe("[unit] OrderEntity のキャンセル・返金", () => {
  test("キャンセルしても返金していなければ、売上に数え、返金していないことにする", () => {
    const order = saved(1, { cancelledAt: at });
    expect(order.isCancelled()).toBe(true);
    expect(order.isRefunded()).toBe(false);
    expect(order.getSalesAmount()).toBe(600);
    expect(order.getUnrefundedAmounts()).toEqual({ cash: 600 });
  });

  test("現金を返したと記録したら、売上に数えない", () => {
    const order = saved(1, { cashRefundedAt: at });
    expect(order.isCancelled()).toBe(false);
    expect(order.isRefunded()).toBe(true);
    expect(order.getSalesAmount()).toBe(0);
    expect(order.getUnrefundedAmounts()).toEqual({});
  });

  test("Square は返金を受け付けた（結果待ち・返金済み）ら返金したことにし、失敗なら返していないことにする", () => {
    for (const status of ["pending", "refunded"] as const) {
      const order = saved(1, {
        paymentMethod: "square",
        squareRefundStatus: status,
      });
      expect(order.isRefunded()).toBe(true);
      expect(order.getSalesAmount()).toBe(0);
    }
    const failed = saved(1, {
      paymentMethod: "square",
      squareRefundStatus: "failed",
    });
    expect(failed.isRefunded()).toBe(false);
    expect(failed.getUnrefundedAmounts()).toEqual({ square: 600 });
  });

  test("分けて会計した注文は、支払いごとに返金を見る", () => {
    expect(split({}).getUnrefundedAmounts()).toEqual({
      cash: 200,
      square: 400,
    });
    const cashBack = split({ cashRefundedAt: at });
    expect(cashBack.isRefunded()).toBe(true);
    expect(cashBack.getSalesAmount()).toBe(400);
    expect(cashBack.getUnrefundedAmounts()).toEqual({ square: 400 });
  });

  test("toOrder・fromOrder でキャンセル・返金の時刻を保つ", () => {
    const order = saved(1, { cancelledAt: at, cashRefundedAt: at });
    const copy = order.clone();
    expect(copy.cancelledAt).toEqual(at);
    expect(copy.cashRefundedAt).toEqual(at);
  });
});

describe("[unit] getDiscountOrderStatus のキャンセル・返金", () => {
  test("返金した注文の番号は使えない", () => {
    expect(getDiscountOrderStatus(1, [saved(1, { cashRefundedAt: at })])).toBe(
      "refunded",
    );
  });

  test("キャンセルしても返金していなければ、提供していなくても使える", () => {
    expect(
      getDiscountOrderStatus(1, [
        saved(1, { cancelledAt: at, servedAt: null }),
      ]),
    ).toBe("available");
    expect(getDiscountOrderStatus(1, [saved(1, { servedAt: null })])).toBe(
      "unserved",
    );
  });

  test("その番号を使った注文を返金したら、使っていないことにする", () => {
    const used = (fields: Partial<Order>) =>
      saved(2, { discountOrderId: 1, ...fields });
    expect(getDiscountOrderStatus(1, [saved(1), used({})])).toBe(
      "already_used",
    );
    expect(
      getDiscountOrderStatus(1, [saved(1), used({ cancelledAt: at })]),
    ).toBe("already_used");
    expect(
      getDiscountOrderStatus(1, [
        saved(1),
        used({ cancelledAt: at, cashRefundedAt: at }),
      ]),
    ).toBe("available");
  });
});

describe("[unit] 分けた注文の売上・返金", () => {
  // No.1 が支払い（¥1,000）をまとめて持ち、No.2（¥400）を分けた
  const parent = (fields: Partial<Order> = {}) =>
    saved(1, {
      billingAmount: 600,
      received: 1000,
      payments: [
        {
          method: "cash",
          amount: 1000,
          received: 1000,
          discount: 0,
          menuIndexes: [],
        },
      ],
      ...fields,
    });
  const child = saved(2, {
    billingAmount: 400,
    received: 0,
    splitParentId: "order-1",
  });

  test("売上と返金するお金は 1 つ目の注文で数え、2 つ目以降は数えない", () => {
    expect(parent().getSalesAmount()).toBe(1000);
    expect(child.getSalesAmount()).toBe(0);
    expect(child.getUnrefundedAmounts()).toEqual({});
    expect(child.isRefunded()).toBe(false);
  });

  test("引換券は 1 つ目の注文を返金していれば、2 つ目以降の番号も使えない", () => {
    expect(getDiscountOrderStatus(2, [parent(), child])).toBe("available");
    expect(
      getDiscountOrderStatus(2, [parent({ cashRefundedAt: at }), child]),
    ).toBe("refunded");
    // 2 つ目以降で使った番号も、1 つ目を返金したら使っていないことにする
    const used = saved(2, {
      discountOrderId: 5,
      received: 0,
      splitParentId: "order-1",
    });
    expect(getDiscountOrderStatus(5, [saved(5), parent(), used])).toBe(
      "already_used",
    );
    expect(
      getDiscountOrderStatus(5, [
        saved(5),
        parent({ cashRefundedAt: at }),
        used,
      ]),
    ).toBe("available");
  });
});
