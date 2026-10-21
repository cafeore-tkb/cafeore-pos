import addFormats from "ajv-formats";
import Ajv2020 from "ajv/dist/2020";
import { describe, expect, test } from "vitest";
import { OrderEntity } from "../models/order";
import schemas from "../types/openapi-schemas.json";
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
  payment_method: "cash",
  payments: [],
  menus: [
    {
      id: "00000000-0000-4000-8000-000000000002",
      menu_name: "注文時のセット名",
      unit_price: 500,
      assignee: null,
      dripper: null,
      menu: {
        id: "00000000-0000-4000-8000-000000000003",
        name: "変更後のセット名",
        price: 800,
        abbr: "セット",
        key: "s",
        priority: 0,
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
  dripper: null,
  dripper_position: null,
  drip_id: null,
  assigned_at: null,
  brew_started_at: null,
  brew_finished_at: null,
  emergencies: [],
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
    order.menus[0].assign(2, "担当者");
    const request = orderToUpdateRequest(order);
    expect(order.menus[0].name).toBe("注文時のセット名");
    expect(request.billing_amount).toBe(500);
    expect(request.menu_ids).toEqual([
      {
        menu_id: response.menus[0].menu.id,
        order_menu_id: response.menus[0].id,
        assignee: "担当者",
        dripper: 2,
      },
    ]);
    expect(orderEntityToCreateRequest(order).menu_ids[0]).toMatchObject({
      assignee: "担当者",
      dripper: 2,
    });
    expect(orderEntityToCreateRequest(order).menu_ids[0]).not.toHaveProperty(
      "order_menu_id",
    );
  });

  test("create request carries the payment method", () => {
    const order = responseToOrderEntity(response).clone();
    const cash = orderEntityToCreateRequest(order);
    expect(cash.payment_method).toBe("cash");
    expect(cash.square_checkout_id).toBeNull();

    const checkoutId = "00000000-0000-4000-8000-000000000009";
    const square = orderEntityToCreateRequest(order, {
      method: "square",
      squareCheckoutId: checkoutId,
    });
    expect(square.payment_method).toBe("square");
    expect(square.square_checkout_id).toBe(checkoutId);
  });

  test("keeps the saved payment method through cloning", () => {
    expect(responseToOrderEntity(response).paymentMethod).toBe("cash");
    const order = responseToOrderEntity({
      ...response,
      payment_method: "square",
    });
    expect(order.paymentMethod).toBe("square");
    expect(order.clone().paymentMethod).toBe("square");
    expect(OrderEntity.createNew({ orderId: 1 }).paymentMethod).toBeUndefined();
  });

  test("split payments point at the lines by their position", () => {
    const second = {
      ...response.menus[0],
      id: "00000000-0000-4000-8000-000000000021",
    };
    const order = responseToOrderEntity({
      ...response,
      payment_method: "square",
      menus: [response.menus[0], second],
      payments: [
        {
          method: "cash",
          amount: 400,
          received: 500,
          discount: 100,
          order_menu_ids: [second.id],
          square_checkout_id: null,
        },
        {
          method: "square",
          amount: 500,
          received: 500,
          discount: 0,
          // 注文を編集して外した明細は落とす
          order_menu_ids: [
            response.menus[0].id,
            "00000000-0000-4000-8000-000000000099",
          ],
          square_checkout_id: "00000000-0000-4000-8000-000000000031",
          square_payment_type: "FELICA_ALL",
          square_refund_status: "refunded",
        },
      ],
    });
    expect(order.payments).toEqual([
      {
        method: "cash",
        amount: 400,
        received: 500,
        discount: 100,
        menuIndexes: [1],
        squareCheckoutId: undefined,
        squarePaymentType: undefined,
        squareRefundStatus: undefined,
      },
      {
        method: "square",
        amount: 500,
        received: 500,
        discount: 0,
        menuIndexes: [0],
        squareCheckoutId: "00000000-0000-4000-8000-000000000031",
        squarePaymentType: "FELICA_ALL",
        squareRefundStatus: "refunded",
      },
    ]);
    expect(order.clone().payments).toEqual(order.payments);
    expect(responseToOrderEntity(response).payments).toEqual([]);
  });

  test("create request carries split payments instead of the payment method", () => {
    const order = responseToOrderEntity(response).clone();
    order.payments = [
      {
        method: "cash",
        amount: 200,
        received: 1000,
        discount: 0,
        menuIndexes: [0],
      },
      {
        method: "square",
        amount: 300,
        received: 300,
        discount: 100,
        menuIndexes: [],
        squareCheckoutId: "00000000-0000-4000-8000-000000000031",
      },
    ];
    const request = orderEntityToCreateRequest(order, {
      method: "square",
      squareCheckoutId: "00000000-0000-4000-8000-000000000032",
    });
    expect(request.payment_method).toBeUndefined();
    expect(request.square_checkout_id).toBeUndefined();
    expect(request.payments).toEqual([
      {
        method: "cash",
        amount: 200,
        received: 1000,
        discount: 0,
        menu_indexes: [0],
        square_checkout_id: null,
      },
      {
        method: "square",
        amount: 300,
        received: 300,
        discount: 100,
        menu_indexes: [],
        square_checkout_id: "00000000-0000-4000-8000-000000000031",
      },
    ]);
    // 一括の注文には payments を付けない
    expect(
      orderEntityToCreateRequest(responseToOrderEntity(response).clone()),
    ).not.toHaveProperty("payments");
  });

  test("keeps the Square refund status through cloning", () => {
    expect(responseToOrderEntity(response).squareRefundStatus).toBeUndefined();
    const order = responseToOrderEntity({
      ...response,
      payment_method: "square",
      square_refund_status: "pending",
    });
    expect(order.squareRefundStatus).toBe("pending");
    expect(order.clone().squareRefundStatus).toBe("pending");
    expect(
      OrderEntity.createNew({ orderId: 1 }).squareRefundStatus,
    ).toBeUndefined();
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
      menus: [{ ...response.menus[0], assignee: "担当者", dripper: 4 }],
      cups: [cup("00000000-0000-4000-8000-000000000011")],
    });
    expect(order.getDrinkCups()).toHaveLength(2);
    expect(order.getCups()).toEqual([
      expect.objectContaining({ abbr: "珈琲", assignee: "担当者", dripper: 4 }),
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

describe("[unit] assigned_at backward compatibility", () => {
  const ajv = new Ajv2020({ strict: false });
  addFormats(ajv);
  ajv.addSchema({ $id: "openapi", components: { schemas } });
  const validate = ajv.getSchema(
    "openapi#/components/schemas/OrderCupResponse",
  );
  if (!validate) throw new Error("OrderCupResponse schema missing");
  test("旧レスポンスの欠落とnullを受け入れ、欠落は未計測にする", () => {
    const old = cup("00000000-0000-4000-8000-000000000099");
    old.assigned_at = undefined;
    expect(validate(old), JSON.stringify(validate.errors)).toBe(true);
    expect(
      responseToOrderEntity({ ...response, cups: [old] }).cups[0].assignedAt,
    ).toBeNull();
    expect(validate({ ...old, assigned_at: null })).toBe(true);
    expect(schemas.CupEmergencyResponse.required).not.toContain("assigned_at");
  });
  test("初回割り振りの時刻は変換・複製を通して保持し、不正日時は拒否", () => {
    const saved = {
      ...cup("00000000-0000-4000-8000-000000000099"),
      assigned_at: "2026-09-11T00:03:00Z",
    };
    expect(validate(saved)).toBe(true);
    expect(validate({ ...saved, assigned_at: "broken" })).toBe(false);
    expect(
      responseToOrderEntity({ ...response, cups: [saved] })
        .clone()
        .cups[0].assignedAt?.toISOString(),
    ).toBe("2026-09-11T00:03:00.000Z");
  });
});
