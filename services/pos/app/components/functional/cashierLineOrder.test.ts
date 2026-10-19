import {
  type Cup,
  type ItemType,
  MenuEntity,
  OrderEntity,
  type WithId,
} from "@cafeore/common";
import { describe, expect, test } from "vitest";
import { previousSingles, sortOrderForSubmit } from "./cashierLineOrder";

const itemType = (name: string, needsBrew: boolean): ItemType => ({
  id: name,
  name,
  display_name: name,
  makes_cup: needsBrew,
  needs_brew: needsBrew,
  senior_only: false,
  iced_brew: false,
});
const hot = itemType("hot", true);
const goods = itemType("others", false);

/** 値段と、コーヒー（抽出が要る）の杯数を決めたメニュー。商品の ID はメニューと同じ */
const menu = (id: string, price: number, coffees: number) =>
  MenuEntity.fromMenu({
    id,
    name: id,
    abbr: id,
    price,
    key: id,
    items: [
      {
        item: { id, name: id, abbr: id, item_type: coffees > 0 ? hot : goods },
        quantity: Math.max(coffees, 1),
      },
    ],
    assignee: null,
  });

const blend = menu("blend", 500, 1);
const light = menu("light", 600, 1);
const dark = menu("dark", 600, 1);
const cookie = menu("cookie", 200, 0);

/** 注文（menus の行ごとに 1 杯のカップ）。state はカップの CaOS の値 */
const savedOrder = (
  orderId: number,
  menus: (typeof blend)[],
  state: Partial<Cup> = {},
  fields: { cancelledAt?: Date } = {},
): WithId<OrderEntity> => {
  const order = OrderEntity.createNew({ orderId });
  const lines = menus.map((m, i) =>
    MenuEntity.fromMenu({ ...m.toMenu(), orderMenuId: `line-${orderId}-${i}` }),
  );
  return OrderEntity.fromOrder({
    ...order.toOrder(),
    id: `order-${orderId}`,
    menus: lines.map((line) => line.toMenu()),
    cups: lines.map((line, i) => ({
      id: `cup-${orderId}-${i}`,
      orderMenuId: line.orderMenuId,
      item: line.items[0].item,
      readyAt: null,
      servedAt: null,
      dripper: null,
      dripperPosition: null,
      dripId: null,
      brewStartedAt: null,
      brewFinishedAt: null,
      emergencies: [],
      ...state,
    })),
    cancelledAt: fields.cancelledAt ?? null,
  } as WithId<ReturnType<OrderEntity["toOrder"]>>);
};

/** 送る前の注文 */
const newOrder = (...menus: (typeof blend)[]) => {
  const order = OrderEntity.createNew({ orderId: 12 });
  order.menus = menus;
  return order;
};

const namesOf = (order: OrderEntity) => order.menus.map((m) => m.name);

describe("[unit] cashierLineOrder の前の注文", () => {
  test("すぐ前の番号の注文の、抽出前の 1 杯のカードの商品", () => {
    const orders = [
      savedOrder(10, [blend]),
      savedOrder(11, [light, blend, blend]),
      savedOrder(13, [dark]),
    ];
    // No.12 の前は No.11。blend 2 杯は 2 杯のカードなので数えない
    expect(previousSingles(orders, 12)).toEqual(["light"]);
    // キャンセルした注文は飛ばす
    const cancelled = savedOrder(11, [dark], {}, { cancelledAt: new Date() });
    expect(previousSingles([orders[0], cancelled], 12)).toEqual(["blend"]);
    expect(previousSingles(orders, 1)).toEqual([]);
  });

  test("抽出を始めた・終えた杯は数えず、待機の杯は数える", () => {
    const brewing = savedOrder(11, [light], {
      dripper: 1,
      dripperPosition: 0,
      dripId: "d1",
      brewStartedAt: new Date(),
    });
    expect(previousSingles([brewing], 12)).toEqual([]);
    const queued = savedOrder(11, [light], {
      dripper: 1,
      dripperPosition: 0,
      dripId: "d1",
    });
    expect(previousSingles([queued], 12)).toEqual(["light"]);
  });
});

describe("[unit] cashierLineOrder の並べ替え", () => {
  test("分けていたときの番号の順に明細を並べ、番号・金額は変えない", () => {
    const order = newOrder(blend, blend, cookie, blend, light);
    const sorted = sortOrderForSubmit(order, ["light"]);
    // light+blend｜blend+blend。クッキーは 1 つ目の組に入る
    expect(namesOf(sorted)).toEqual([
      "blend",
      "cookie",
      "light",
      "blend",
      "blend",
    ]);
    expect(sorted.orderId).toBe(12);
    expect(sorted.billingAmount).toBe(order.billingAmount);
    // 元の注文（シール・レシートに使う）は入れた順のまま
    expect(namesOf(order)).toEqual([
      "blend",
      "blend",
      "cookie",
      "blend",
      "light",
    ]);
  });

  test("払った明細の位置も並べ替えた位置に直す", () => {
    const order = newOrder(blend, blend, blend, light);
    order.payments = [
      {
        method: "cash",
        amount: 1100,
        received: 1100,
        discount: 0,
        menuIndexes: [0, 3],
      },
    ];
    const sorted = sortOrderForSubmit(order, ["light"]);
    // light+blend｜blend+blend
    expect(namesOf(sorted)).toEqual(["blend", "light", "blend", "blend"]);
    expect(sorted.payments[0].menuIndexes).toEqual([0, 1]);
  });

  test("分けなくてよい注文は並べ替えない", () => {
    const order = newOrder(light, blend, cookie, blend);
    expect(sortOrderForSubmit(order, ["blend"])).toBe(order);
  });
});
