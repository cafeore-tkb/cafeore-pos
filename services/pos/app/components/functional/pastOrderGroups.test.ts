import {
  type ItemType,
  MenuEntity,
  type Order,
  OrderEntity,
  type WithId,
} from "@cafeore/common";
import { describe, expect, test } from "vitest";
import { groupPastOrders } from "./pastOrderGroups";

const hot: ItemType = {
  id: "hot",
  name: "hot",
  display_name: "hot",
  makes_cup: true,
  needs_brew: true,
  senior_only: false,
  iced_brew: false,
};

const blend = MenuEntity.fromMenu({
  id: "blend",
  name: "ブレンド",
  abbr: "ブ",
  price: 500,
  key: "b",
  items: [
    {
      item: { id: "blend", name: "ブレンド", abbr: "ブ", item_type: hot },
      quantity: 1,
    },
  ],
  assignee: null,
});

const at = (minute: number) => new Date(`2026-10-19T10:${minute}:00Z`);

/** 保存した注文（ブレンド count 杯） */
const saved = (
  orderId: number,
  count: number,
  fields: Partial<Order> = {},
): WithId<OrderEntity> =>
  OrderEntity.fromOrder({
    ...OrderEntity.createNew({ orderId }).toOrder(),
    id: `order-${orderId}`,
    menus: Array.from({ length: count }, () => blend.toMenu()),
    paymentMethod: "cash",
    ...fields,
  } as WithId<Order>);

describe("[unit] groupPastOrders", () => {
  test("分けた注文は 1 つ目の注文にまとめ、商品・金額・割引を足す", () => {
    const first = saved(124, 2, {
      received: 2000,
      payments: [
        {
          method: "cash",
          amount: 1400,
          received: 2000,
          discount: 100,
          menuIndexes: [0, 1],
        },
      ],
      discountOrderCups: 1,
      readyAt: at(10),
      servedAt: at(12),
    });
    const second = saved(125, 1, {
      received: 0,
      splitParentId: "order-124",
      readyAt: at(11),
      servedAt: null,
    });
    const other = saved(126, 1, { received: 500 });
    const groups = groupPastOrders([other, second, first]);

    expect(groups.map((group) => group.orderIds)).toEqual([[126], [124, 125]]);
    expect(groups[0].order).toBe(other);
    const { order, orders } = groups[1];
    expect(orders).toEqual([first, second]);
    expect(order.id).toBe("order-124");
    expect(order.menus).toHaveLength(3);
    expect(order.discount).toBe(100);
    expect(order.billingAmount).toBe(1400);
    // お釣りは全額で数える
    expect(order.getCharge()).toBe(600);
    // 売上・返金は 1 つ目の注文の支払いで数える
    expect(order.getSalesAmount()).toBe(1400);
    // 全部提供するまで提供済みにしない
    expect(order.readyAt).toEqual(at(11));
    expect(order.servedAt).toBeNull();
  });

  test("1 つ目の注文が無い分けた注文は、それだけで出す", () => {
    const orphan = saved(125, 1, { splitParentId: "order-124" });
    expect(groupPastOrders([orphan]).map((group) => group.order)).toEqual([
      orphan,
    ]);
  });
});
