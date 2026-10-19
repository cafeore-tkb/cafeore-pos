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
