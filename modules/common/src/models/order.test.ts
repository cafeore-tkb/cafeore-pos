import { describe, expect, test } from "vitest";
import type { WithId } from "../lib/typeguard";
import { MenuEntity } from "./menu";
import { OrderEntity } from "./order";

const coffeeItem = MenuEntity.fromMenu({
  id: "1",
  name: "item1",
  abbr: "1",
  price: 300,
  key: "1",
  item_type: { id: "1", name: "hot", display_name: "ホット" },
  assignee: null,
});

const milkItem = MenuEntity.fromMenu({
  id: "2",
  name: "item2",
  abbr: "2",
  price: 100,
  key: "2",
  item_type: { id: "3", name: "milk", display_name: "ミルク" },
  assignee: null,
});

describe("[unit] order entity", () => {
  test("total auto calc", () => {
    const order = OrderEntity.createNew({ orderId: 2024 });
    expect(order.total).toBe(0);

    const items: WithId<MenuEntity>[] = [
      MenuEntity.fromMenu({
        id: "1",
        name: "item1",
        abbr: "1",
        price: 100,
        key: "1",
        item_type: { id: "1", name: "hot", display_name: "ホット" },
        assignee: null,
      }),
      MenuEntity.fromMenu({
        id: "2",
        name: "item2",
        abbr: "2",
        price: 341,
        key: "2",
        item_type: { id: "3", name: "milk", display_name: "ミルク" },
        assignee: null,
      }),
    ];

    order.menus = items;
    expect(order.total).toBe(441);

    order.menus.push(
      MenuEntity.fromMenu({
        id: "3",
        name: "item3",
        abbr: "3",
        price: 100,
        key: "3",
        item_type: { id: "2", name: "ice", display_name: "アイス" },
        assignee: null,
      }),
    );
    expect(order.total).toBe(541);
  });

  test("beReady", () => {
    const order = OrderEntity.createNew({ orderId: 2024 });
    expect(order.readyAt).toBe(null);

    order.beReady();
    expect(order.readyAt).not.toBe(null);
    expect(order.readyAt).toBeInstanceOf(Date);
  });

  test("beServed", () => {
    const order = OrderEntity.createNew({ orderId: 2024 });
    expect(order.servedAt).toBe(null);

    order.beServed();
    expect(order.servedAt).not.toBe(null);
    expect(order.servedAt).toBeInstanceOf(Date);
    expect(order.readyAt).not.toBe(null);
    expect(order.readyAt).toEqual(order.servedAt);
  });

  test("undoServed & undoReady", () => {
    const order = OrderEntity.createNew({ orderId: 2024 });
    expect(order.servedAt).toBe(null);

    // 提供時には readyAt と servedAt が同じ
    order.beServed();
    expect(order.servedAt).not.toBe(null);
    expect(order.readyAt).not.toBe(null);
    expect(order.readyAt).toEqual(order.servedAt);

    // undoServed で servedAt も readyAt も null になる
    order.undoServed();
    expect(order.servedAt).toBe(null);
    expect(order.readyAt).toBe(null);

    // 別々に設定した場合は undoServed では servedAt だけが null になる
    order.beReady();
    order.beServed();
    order.undoServed();
    expect(order.servedAt).toBe(null);
    expect(order.readyAt).not.toBe(null);
  });

  test("billingAmount", () => {
    const order = OrderEntity.createNew({ orderId: 2024 });
    expect(order.billingAmount).toBe(0);

    const items = [
      {
        id: "1",
        name: "item1",
        abbr: "1",
        price: 400,
        key: "1",
        item_type: { id: "1", name: "hot", display_name: "ホット" },
        assignee: null,
      },
      {
        id: "2",
        name: "item2",
        abbr: "2",
        price: 500,
        key: "2",
        item_type: { id: "3", name: "milk", display_name: "ミルク" },
        assignee: null,
      },
    ];
    const menuEntities = items.map((item) => MenuEntity.fromMenu(item));

    order.menus = menuEntities;
    expect(order.billingAmount).toBe(900);

    const previousOrder = OrderEntity.fromOrder({
      id: "1",
      orderId: 99999,
      createdAt: new Date(),
      readyAt: null,
      servedAt: null,
      menus: menuEntities.slice(0, 1),
      total: 900,
      comments: [],
      billingAmount: 900,
      received: 0,
      discountOrderId: null,
      discountOrderCups: 0,
      DISCOUNT_PER_CUP: 100,
      discount: 0,
      estimateTime: -1,
    });

    order.applyDiscount(previousOrder);
    expect(order.discountOrderId).toBe(99999);
    expect(order.discountOrderCups).toBe(1);
    expect(order.discount).toBe(100);
    expect(order.billingAmount).toBe(800);
  });

  test("received", () => {
    const order = OrderEntity.createNew({ orderId: 2024 });
    expect(order.received).toBe(0);

    order.received = 1000;
    expect(order.received).toBe(1000);
  });

  test("getDrinkCups returns each constituent item's abbreviation", () => {
    const order = OrderEntity.createNew({ orderId: 2024 });
    order.menus = [
      MenuEntity.fromMenu({
        id: "00000000-0000-4000-8000-000000000001",
        name: "コーヒーセット",
        abbr: "セット",
        price: 500,
        key: "s",
        assignee: "担当者",
        items: [
          {
            item: {
              id: "00000000-0000-4000-8000-000000000002",
              name: "ブレンドコーヒー",
              abbr: "ブレンド",
              item_type: {
                id: "00000000-0000-4000-8000-000000000003",
                name: "hot",
                display_name: "ホット",
              },
            },
            quantity: 2,
          },
        ],
      }),
    ];

    expect(order.getDrinkCups()).toEqual([
      expect.objectContaining({ abbr: "ブレンド", assignee: "担当者" }),
      expect.objectContaining({ abbr: "ブレンド", assignee: "担当者" }),
    ]);
    expect(order.getDrinkCups().map((item) => item.abbr)).not.toContain(
      "セット",
    );
    expect(order.getCoffeeCups().map((item) => item.abbr)).toEqual([
      "ブレンド",
      "ブレンド",
    ]);
    expect(order.getItems().map((item) => item.abbr)).toEqual([
      "ブレンド",
      "ブレンド",
    ]);
  });

  test("applyDiscount", () => {
    const order = OrderEntity.createNew({ orderId: 2024 });
    expect(order.billingAmount).toBe(0);

    const items = [
      {
        id: "1",
        name: "item1",
        abbr: "1",
        price: 400,
        key: "1",
        item_type: { id: "1", name: "hot", display_name: "ホット" },
        assignee: null,
      },
      {
        id: "2",
        name: "item2",
        abbr: "2",
        price: 500,
        key: "2",
        item_type: { id: "2", name: "ice", display_name: "アイス" },
        assignee: null,
      },
    ];
    const menuEntities = items.map((item) => MenuEntity.fromMenu(item));

    order.menus = menuEntities;
    expect(order.billingAmount).toBe(900);

    const previousOrder = OrderEntity.fromOrder({
      id: "1",
      orderId: 99999,
      createdAt: new Date(),
      readyAt: null,
      servedAt: null,
      menus: menuEntities,
      total: 900,
      comments: [],
      billingAmount: 900,
      received: 0,
      discountOrderId: null,
      discountOrderCups: 0,
      DISCOUNT_PER_CUP: 100,
      discount: 0,
      estimateTime: -1,
    });

    order.applyDiscount(previousOrder);
    expect(order.discountOrderId).toBe(99999);
    expect(order.discountOrderCups).toBe(2);
    expect(order.discount).toBe(200);
    expect(order.billingAmount).toBe(700);

    order.menus.pop();
    expect(order.discount).toBe(100);
    expect(order.total).toBe(400);
    expect(order.billingAmount).toBe(300);

    order.menus.push(milkItem);
    expect(order.discount).toBe(100);
    expect(order.total).toBe(500);
    expect(order.billingAmount).toBe(400);
  });

  test("addComment", () => {
    const order = OrderEntity.fromOrder({
      id: "1",
      orderId: 99999,
      createdAt: new Date(),
      readyAt: null,
      servedAt: null,
      menus: [],
      total: 900,
      comments: [],
      billingAmount: 900,
      received: 0,
      discountOrderId: null,
      discountOrderCups: 0,
      DISCOUNT_PER_CUP: 100,
      discount: 0,
      estimateTime: -1,
    });

    expect(order.comments).toEqual([]);
    order.addComment("cashier", "testAddComments");
    expect(order.comments[0].author).toBe("cashier");
    expect(order.comments[0].text).toBe("testAddComments");
    order.addComment("master", "2");
    expect(order.comments[1].author).toBe("master");
    expect(order.comments[1].text).toBe("2");
  });
});
