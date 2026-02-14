import { describe, expect, test } from "vitest";
import type { WithId } from "../lib/typeguard";
import { type Item, ItemEntity } from "./item";
import { OrderEntity } from "./order";

const coffeeItem = ItemEntity.fromItem({
  id: "1",
  name: "item1",
  abbr: "1",
  price: 300,
  key: "1",
  item_type: { id: "1", name: "hot", display_name: "ホット" },
  assignee: null,
});

const milkItem = ItemEntity.fromItem({
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

    const items: WithId<ItemEntity>[] = [
      ItemEntity.fromItem({
        id: "1",
        name: "item1",
        abbr: "1",
        price: 100,
        key: "1",
        item_type: { id: "1", name: "hot", display_name: "ホット" },
        assignee: null,
      }),
      ItemEntity.fromItem({
        id: "2",
        name: "item2",
        abbr: "2",
        price: 341,
        key: "2",
        item_type: { id: "3", name: "milk", display_name: "ミルク" },
        assignee: null,
      }),
    ];

    order.items = items;
    expect(order.total).toBe(441);

    order.items.push(
      ItemEntity.fromItem({
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

    const items: WithId<Item>[] = [
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
    const itemEntities = items.map((item) => ItemEntity.fromItem(item));

    order.items = itemEntities;
    expect(order.billingAmount).toBe(900);

    const previousOrder = OrderEntity.fromOrder({
      id: "1",
      orderId: 99999,
      createdAt: new Date(),
      readyAt: null,
      servedAt: null,
      items: itemEntities.slice(0, 1),
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

  test("applyDiscount", () => {
    const order = OrderEntity.createNew({ orderId: 2024 });
    expect(order.billingAmount).toBe(0);

    const items: WithId<Item>[] = [
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
    const itemEntities = items.map((item) => ItemEntity.fromItem(item));

    order.items = itemEntities;
    expect(order.billingAmount).toBe(900);

    const previousOrder = OrderEntity.fromOrder({
      id: "1",
      orderId: 99999,
      createdAt: new Date(),
      readyAt: null,
      servedAt: null,
      items: itemEntities,
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

    order.items.pop();
    expect(order.discount).toBe(100);
    expect(order.total).toBe(400);
    expect(order.billingAmount).toBe(300);

    order.items.push(milkItem);
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
      items: [],
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
