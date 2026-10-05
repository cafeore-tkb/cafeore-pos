import { describe, expect, test } from "vitest";
import {
  type OrderResponse,
  orderEntityToCreateRequest,
  orderToUpdateRequest,
  responseToOrderEntity,
} from "./converter";

const response: OrderResponse = {
  id: "00000000-0000-4000-8000-000000000001",
  order_id: 1,
  created_at: "2026-09-11T00:00:00Z",
  billing_amount: 500,
  received: 1000,
  menus: [
    {
      id: "00000000-0000-4000-8000-000000000002",
      menu_name: "注文時のセット名",
      unit_price: 500,
      assignee: null,
      menu: {
        id: "00000000-0000-4000-8000-000000000003",
        name: "変更後のセット名",
        price: 800,
        abbr: "セット",
        key: "s",
        items: [
          {
            quantity: 2,
            item: {
              id: "00000000-0000-4000-8000-000000000004",
              name: "コーヒー",
              abbr: "珈琲",
              item_type: {
                id: "00000000-0000-4000-8000-000000000005",
                name: "hot",
                display_name: "ホット",
              },
            },
          },
        ],
      },
    },
  ],
};

describe("[unit] order snapshot conversion", () => {
  test("uses saved name and price, not the current menu master", () => {
    const order = responseToOrderEntity(response);
    expect(order.menus[0].name).toBe("注文時のセット名");
    expect(order.total).toBe(500);
    expect(order.billingAmount).toBe(500);
    expect(order.getCharge()).toBe(500);
    expect(order.menus[0].items[0].quantity).toBe(2);
  });

  test("preserves the line ID and snapshot through cloning and editing", () => {
    const order = responseToOrderEntity(response).clone();
    order.menus[0].assignee = "担当者";
    const request = orderToUpdateRequest(order);
    expect(order.menus[0].name).toBe("注文時のセット名");
    expect(request.billing_amount).toBe(500);
    expect(request.menu_ids).toEqual([
      {
        menu_id: response.menus[0].menu.id,
        order_menu_id: response.menus[0].id,
        assignee: "担当者",
      },
    ]);
    expect(orderEntityToCreateRequest(order).menu_ids[0]).not.toHaveProperty(
      "order_menu_id",
    );
  });

  test("zero-price snapshots are not replaced with current prices", () => {
    const order = responseToOrderEntity({
      ...response,
      menus: [{ ...response.menus[0], unit_price: 0 }],
    });
    expect(order.total).toBe(0);
  });
});
