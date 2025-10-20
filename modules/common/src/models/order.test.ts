import { describe, expect, test } from "vitest";
import type { WithId } from "../lib/typeguard";
import { type Item, ItemEntity } from "./item";
import { OrderEntity } from "./order";

const coffeeItem = ItemEntity.fromItem({
  id: "1",
  name: "item1",
  price: 300,
  type: "hot",
  assignee: null,
});

const milkItem = ItemEntity.fromItem({
  id: "2",
  name: "item2",
  price: 100,
  type: "milk",
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
        price: 100,
        type: "hot",
        assignee: null,
      }),
      ItemEntity.fromItem({
        id: "2",
        name: "item2",
        price: 341,
        type: "ice",
        assignee: null,
      }),
    ];

    order.items = items;
    expect(order.total).toBe(441);

    order.items.push(
      ItemEntity.fromItem({
        id: "3",
        name: "item3",
        price: 100,
        type: "hotOre",
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
        price: 400,
        type: "hot",
        assignee: null,
      },
      {
        id: "2",
        name: "item2",
        price: 500,
        type: "ice",
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
        price: 400,
        type: "hot",
        assignee: null,
      },
      {
        id: "2",
        name: "item2",
        price: 500,
        type: "ice",
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

// 分割判定のテスト
  test("shouldSplitOrder - コーヒー3種以上で分割が必要", () => {
    const order = OrderEntity.createNew({ orderId: 2024 });
    
    // 3種類のコーヒーを追加
    order.items = [
      ItemEntity.fromItem({
        id: "01_yukari_brend",
        name: "縁ブレンド",
        price: 500,
        type: "hot",
        assignee: null,
      }),
      ItemEntity.fromItem({
        id: "02_cafeore_brend",
        name: "珈琲・俺ブレンド",
        price: 300,
        type: "hot",
        assignee: null,
      }),
      ItemEntity.fromItem({
        id: "03_Lychee",
        name: "ライチ",
        price: 1000,
        type: "hot",
        assignee: null,
      }),
    ];
    
    const details = order.shouldSplitOrder();
    expect(details.uniqueCoffeeCount).toBe(3);
    expect(details.totalCoffeeCups).toBe(3);
    expect(details.toteSets.length).toBe(0);
    expect(details.shouldSplit).toBe(true);
  });

  test("shouldSplitOrder - コーヒー5杯以上で分割が必要", () => {
    const order = OrderEntity.createNew({ orderId: 2024 });
    
    // 同じコーヒーを5杯追加
    order.items = [
      ItemEntity.fromItem({
        id: "01_yukari_brend",
        name: "縁ブレンド",
        price: 500,
        type: "hot",
        assignee: null,
      }),
      ItemEntity.fromItem({
        id: "01_yukari_brend",
        name: "縁ブレンド",
        price: 500,
        type: "hot",
        assignee: null,
      }),
      ItemEntity.fromItem({
        id: "01_yukari_brend",
        name: "縁ブレンド",
        price: 500,
        type: "hot",
        assignee: null,
      }),
      ItemEntity.fromItem({
        id: "01_yukari_brend",
        name: "縁ブレンド",
        price: 500,
        type: "hot",
        assignee: null,
      }),
      ItemEntity.fromItem({
        id: "01_yukari_brend",
        name: "縁ブレンド",
        price: 500,
        type: "hot",
        assignee: null,
      }),
    ];
    
    const details = order.shouldSplitOrder();
    expect(details.uniqueCoffeeCount).toBe(1);
    expect(details.totalCoffeeCups).toBe(5);
    expect(details.toteSets.length).toBe(0);
    expect(details.shouldSplit).toBe(true);
  });

  test("shouldSplitOrder - トートセットを含む場合（縁ブレンドとして読み替え）", () => {
    const order = OrderEntity.createNew({ orderId: 2024 });
    
    // トートセット1個 + コーヒー2種類 = 3種類（トートセットは縁ブレンドとして読み替え）
    order.items = [
      ItemEntity.fromItem({
        id: "51_tote_yukari",
        name: "トートセット",
        price: 1000,
        type: "others",
        assignee: null,
      }),
      ItemEntity.fromItem({
        id: "02_cafeore_brend",
        name: "珈琲・俺ブレンド",
        price: 300,
        type: "hot",
        assignee: null,
      }),
      ItemEntity.fromItem({
        id: "03_Lychee",
        name: "ライチ",
        price: 1000,
        type: "hot",
        assignee: null,
      }),
    ];
    
    const details = order.shouldSplitOrder();
    expect(details.uniqueCoffeeCount).toBe(3); // トートセットが縁ブレンドとして読み替えられる
    expect(details.totalCoffeeCups).toBe(3); // コーヒー2杯 + トートセット1個
    expect(details.toteSets.length).toBe(1);
    expect(details.coffeeCups.length).toBe(2);
    expect(details.shouldSplit).toBe(true);
  });

  test("shouldSplitOrder - トートセットと縁ブレンドが重複する場合", () => {
    const order = OrderEntity.createNew({ orderId: 2024 });
    
    // トートセット1個 + 縁ブレンド1杯 + 他のコーヒー1種類 = 2種類（トートセットと縁ブレンドは重複）
    order.items = [
      ItemEntity.fromItem({
        id: "51_tote_yukari",
        name: "トートセット",
        price: 1000,
        type: "others",
        assignee: null,
      }),
      ItemEntity.fromItem({
        id: "01_yukari_brend",
        name: "縁ブレンド",
        price: 500,
        type: "hot",
        assignee: null,
      }),
      ItemEntity.fromItem({
        id: "02_cafeore_brend",
        name: "珈琲・俺ブレンド",
        price: 300,
        type: "hot",
        assignee: null,
      }),
    ];
    
    const details = order.shouldSplitOrder();
    expect(details.uniqueCoffeeCount).toBe(2); // トートセットと縁ブレンドは重複して1種類としてカウント
    expect(details.totalCoffeeCups).toBe(3); // コーヒー2杯 + トートセット1個
    expect(details.toteSets.length).toBe(1);
    expect(details.coffeeCups.length).toBe(2);
    expect(details.shouldSplit).toBe(false);
  });

  test("shouldSplitOrder - 分割不要な場合", () => {
    const order = OrderEntity.createNew({ orderId: 2024 });
    
    // コーヒー2種類、4杯
    order.items = [
      ItemEntity.fromItem({
        id: "01_yukari_brend",
        name: "縁ブレンド",
        price: 500,
        type: "hot",
        assignee: null,
      }),
      ItemEntity.fromItem({
        id: "02_cafeore_brend",
        name: "珈琲・俺ブレンド",
        price: 300,
        type: "hot",
        assignee: null,
      }),
      ItemEntity.fromItem({
        id: "01_yukari_brend",
        name: "縁ブレンド",
        price: 500,
        type: "hot",
        assignee: null,
      }),
      ItemEntity.fromItem({
        id: "02_cafeore_brend",
        name: "珈琲・俺ブレンド",
        price: 300,
        type: "hot",
        assignee: null,
      }),
    ];
    
    const details = order.shouldSplitOrder();
    expect(details.uniqueCoffeeCount).toBe(2);
    expect(details.totalCoffeeCups).toBe(4);
    expect(details.toteSets.length).toBe(0);
    expect(details.shouldSplit).toBe(false);
  });

  test("shouldSplitOrder - ミルクやその他はカウントされない", () => {
    const order = OrderEntity.createNew({ orderId: 2024 });
    
    // ミルクとその他を大量に追加しても分割判定に影響しない
    order.items = [
      ItemEntity.fromItem({
        id: "01_yukari_brend",
        name: "縁ブレンド",
        price: 500,
        type: "hot",
        assignee: null,
      }),
      ItemEntity.fromItem({
        id: "01_yukari_brend",
        name: "縁ブレンド",
        price: 500,
        type: "hot",
        assignee: null,
      }),
      ItemEntity.fromItem({
        id: "01_yukari_brend",
        name: "縁ブレンド",
        price: 500,
        type: "hot",
        assignee: null,
      }),
      ItemEntity.fromItem({
        id: "01_yukari_brend",
        name: "縁ブレンド",
        price: 500,
        type: "hot",
        assignee: null,
      }),
      ItemEntity.fromItem({
        id: "40_ice_milk",
        name: "アイスミルク",
        price: 100,
        type: "milk",
        assignee: null,
      }),
      ItemEntity.fromItem({
        id: "50_coaster",
        name: "コースター",
        price: 100,
        type: "others",
        assignee: null,
      }),
      ItemEntity.fromItem({
        id: "52_tote",
        name: "トートバッグ単体",
        price: 1000,
        type: "others",
        assignee: null,
      }),
    ];
    
    const details = order.shouldSplitOrder();
    expect(details.uniqueCoffeeCount).toBe(1);
    expect(details.totalCoffeeCups).toBe(4);
    expect(details.toteSets.length).toBe(0);
    expect(details.coffeeCups.length).toBe(4);
    expect(details.shouldSplit).toBe(false);
  });
});
