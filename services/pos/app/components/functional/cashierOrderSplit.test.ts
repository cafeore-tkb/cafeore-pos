import {
  type Cup,
  type ItemType,
  MenuEntity,
  OrderEntity,
  type WithId,
} from "@cafeore/common";
import { describe, expect, test } from "vitest";
import { type CashierDraft, addLine, emptyCashierDraft } from "./cashierDraft";
import {
  orderSplitGroups,
  previousSingles,
  splitItemsText,
  splitOrdersForSubmit,
  suggestOrderSplit,
} from "./cashierOrderSplit";
import { beginRest, leavePayment } from "./cashierSplit";

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

const withLines = (...items: (typeof blend)[]): CashierDraft =>
  items.reduce(addLine, emptyCashierDraft());

const keysOf = (draft: CashierDraft) => draft.lines.map((line) => line.key);

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

describe("[unit] cashierOrderSplit の前の注文", () => {
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

describe("[unit] cashierOrderSplit の分け方", () => {
  test("分割を推奨する注文を番号ごとに分ける。分けなくてよければ null", () => {
    const draft = withLines(blend, blend, blend, light, cookie);
    const [b1, b2, b3, l, c] = keysOf(draft);
    const split = suggestOrderSplit(draft.lines, []);
    // AA｜A+B（グッズは 1 つ目）
    expect(split).toEqual({
      count: 2,
      assign: { [b1]: 0, [b2]: 0, [c]: 0, [b3]: 1, [l]: 1 },
    });
    if (split === null) throw new Error("no split");
    const groups = orderSplitGroups(draft.lines, split, 124);
    expect(groups.map((group) => group.orderId)).toEqual([124, 125]);
    expect(groups.map((group) => group.cups)).toEqual([2, 2]);
    expect(groups.map((group) => splitItemsText(group.lines))).toEqual([
      "blend×2・cookie",
      "blend・light",
    ]);
    expect(groups.some((group) => group.needsSplit)).toBe(false);
    expect(suggestOrderSplit(withLines(blend, blend, light).lines, [])).toBe(
      null,
    );
  });

  test("会計をやめると分け方も消す", () => {
    const paying = {
      ...beginRest(withLines(blend, light, dark), 0, 100),
      orderSplit: { count: 2, assign: {} },
    };
    expect(leavePayment(paying).orderSplit).toBeNull();
  });
});

describe("[unit] cashierOrderSplit の送る注文", () => {
  test("1 つ目の注文に分けた注文を付け、割引は 1 つ目から順に割り振る。支払いは 1 つ目が持つ", () => {
    const draft = withLines(blend, light, dark, cookie);
    const [b, l, d, c] = keysOf(draft);
    const order = OrderEntity.createNew({ orderId: 124 });
    order.menus = draft.lines.map((line) => line.menu);
    order.applyServiceOneCupDiscount();
    order.addComment("cashier", "氷少なめ");
    order.payments = [
      {
        method: "cash",
        amount: 1800,
        received: 2000,
        discount: 100,
        menuIndexes: [0, 1, 2, 3],
      },
    ];
    order.received = 2000;
    // No.124: dark・cookie（コーヒー 1 杯）、No.125: blend・light
    const first = splitOrdersForSubmit(order, draft.lines, {
      count: 2,
      assign: { [b]: 1, [l]: 1, [d]: 0, [c]: 0 },
    });
    expect(first.orderId).toBe(124);
    expect(first.menus.map((m) => m.id)).toEqual(["dark", "cookie"]);
    expect(first.discountOrderCups).toBe(1);
    expect(first.billingAmount).toBe(700);
    expect(first.payments).toEqual([
      { ...order.payments[0], menuIndexes: [0, 1] },
    ]);
    expect(first.received).toBe(2000);
    expect(first.comments.map((comment) => comment.text)).toEqual(["氷少なめ"]);

    expect(first.splitOrders).toHaveLength(1);
    const [second] = first.splitOrders;
    expect(second.orderId).toBe(125);
    expect(second.menus.map((m) => m.id)).toEqual(["blend", "light"]);
    expect(second.discountOrderCups).toBe(0);
    expect(second.discount).toBe(0);
    expect(second.billingAmount).toBe(1100);
    expect(second.received).toBe(0);
    expect(second.payments).toEqual([]);
    expect(second.comments.map((comment) => comment.text)).toEqual([
      "氷少なめ",
    ]);
    // 合計は分ける前と同じ
    expect(first.billingAmount + second.billingAmount).toBe(
      order.billingAmount,
    );
  });

  test("1 つ目にコーヒーが無ければ、割引は次の注文に付ける", () => {
    const draft = withLines(cookie, blend, light, dark);
    const [c, b, l, d] = keysOf(draft);
    const order = OrderEntity.createNew({ orderId: 50 });
    order.menus = draft.lines.map((line) => line.menu);
    const coupon = OrderEntity.createNew({ orderId: 7 });
    coupon.menus = [blend, blend];
    order.applyDiscount(coupon);
    const first = splitOrdersForSubmit(order, draft.lines, {
      count: 3,
      assign: { [c]: 0, [b]: 1, [l]: 2, [d]: 2 },
    });
    expect(first.discountOrderId).toBeNull();
    expect(first.discountOrderCups).toBe(0);
    expect(
      first.splitOrders.map((o) => [o.discountOrderId, o.discount]),
    ).toEqual([
      [7, 100],
      [7, 100],
    ]);
  });
});
