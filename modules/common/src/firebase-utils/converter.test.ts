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
  cups: [],
};

const cup = (id: string): OrderResponse["cups"][number] => ({
  id,
  order_menu_id: response.menus[0].id,
  item: response.menus[0].menu.items[0].item,
  ready_at: null,
  served_at: null,
});

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

  test("converts each cup's ready and served status", () => {
    const readyAt = "2026-09-11T00:05:00Z";
    const servedAt = "2026-09-11T00:06:00Z";
    const order = responseToOrderEntity({
      ...response,
      cups: [
        cup("00000000-0000-4000-8000-000000000011"),
        {
          ...cup("00000000-0000-4000-8000-000000000012"),
          ready_at: readyAt,
          served_at: servedAt,
        },
      ],
    });
    expect(order.cups.map((c) => c.servedAt)).toEqual([
      null,
      new Date(servedAt),
    ]);
    // 2杯入りのセットでも、カードは1杯ずつ別の状態を持つ
    expect(order.getCups()).toEqual([
      expect.objectContaining({
        cupId: "00000000-0000-4000-8000-000000000011",
        abbr: "珈琲",
        status: "preparing",
      }),
      expect.objectContaining({
        cupId: "00000000-0000-4000-8000-000000000012",
        abbr: "珈琲",
        status: "served",
      }),
    ]);
    expect(
      order
        .clone()
        .getCups()
        .map((c) => c.status),
    ).toEqual(["preparing", "served"]);
    // レジなどで使う getItems() の展開は変わらない
    expect(order.getItems().map((item) => item.abbr)).toEqual(["珈琲", "珈琲"]);
  });

  test("cups follow the server even if the menu composition changed", () => {
    const order = responseToOrderEntity({
      ...response,
      menus: [{ ...response.menus[0], assignee: "担当者" }],
      cups: [cup("00000000-0000-4000-8000-000000000011")],
    });
    expect(order.getDrinkCups()).toHaveLength(2);
    expect(order.getCups()).toEqual([
      expect.objectContaining({ abbr: "珈琲", assignee: "担当者" }),
    ]);
  });

  test("orders without cups fall back to the drink cups", () => {
    const order = responseToOrderEntity({
      ...response,
      served_at: "2026-09-11T00:06:00Z",
    });
    expect(order.getCups()).toEqual([
      expect.objectContaining({ cupId: undefined, status: "served" }),
      expect.objectContaining({ cupId: undefined, status: "served" }),
    ]);
  });

  test("zero-price snapshots are not replaced with current prices", () => {
    const order = responseToOrderEntity({
      ...response,
      menus: [{ ...response.menus[0], unit_price: 0 }],
    });
    expect(order.total).toBe(0);
  });
});
