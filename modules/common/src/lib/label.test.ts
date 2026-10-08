import { describe, expect, test } from "vitest";
import type { Cup } from "../models/cup";
import { MenuEntity } from "../models/menu";
import { OrderEntity } from "../models/order";
import {
  emergencyLabels,
  orderCupLabels,
  orderLabels,
  orderSummaryLabel,
  pendingEmergencyLabels,
} from "./label";

const type = (name: string, needsBrew: boolean, makesCup = true) => ({
  id: `type-${name}`,
  name,
  display_name: name,
  makes_cup: makesCup,
  needs_brew: needsBrew,
  senior_only: false,
});
const item = (id: string, name: string, t: ReturnType<typeof type>) => ({
  id,
  name,
  abbr: name.slice(0, 1),
  item_type: t,
});
const blend = item("i-blend", "ブレンド", type("hot", true));
const kenya = item("i-kenya", "ケニア", type("hot", true));
const milk = item("i-milk", "アイスミルク", type("milk", false));
const goods = item("i-goods", "ステッカー", type("others", false, false));

const menu = (
  name: string,
  items: { item: typeof blend; quantity: number }[],
  price: number,
) =>
  MenuEntity.fromMenu({
    id: `m-${name}`,
    name,
    abbr: name.slice(0, 1),
    price,
    key: name,
    items,
    assignee: null,
  });

// レジで会計する注文（保存前。サーバーのカップは無い）
const cashierOrder = () => {
  const order = OrderEntity.createNew({ orderId: 42 });
  const set = menu(
    "ブレンドとミルクのセット",
    [
      { item: blend, quantity: 2 },
      { item: milk, quantity: 1 },
    ],
    700,
  );
  const named = menu("ケニア", [{ item: kenya, quantity: 1 }], 600);
  named.assign(2, "たくみ");
  order.menus = [
    set,
    named,
    menu("ステッカー", [{ item: goods, quantity: 1 }], 200),
    menu("ブレンド", [{ item: blend, quantity: 1 }], 500),
  ];
  return order;
};

// 保存した注文：サーバーが明細の順 → 構成品の順 → 数量にカップを作る（グッズ以外）。WebSocket で届く形
const savedOrder = () => {
  const draft = cashierOrder();
  const menus = draft.menus.map((m, i) =>
    MenuEntity.fromMenu({ ...m.toMenu(), orderMenuId: `line-${i}` }),
  );
  let seq = 0;
  const cups: Cup[] = menus.flatMap((m) =>
    m.items.flatMap(({ item, quantity }) =>
      item.item_type.makes_cup
        ? Array.from({ length: quantity }, () => ({
            id: `cup-${++seq}`,
            orderMenuId: m.orderMenuId ?? "",
            item: item.toItem() as Cup["item"],
            readyAt: null,
            servedAt: null,
            dripper: null,
            dripperPosition: null,
            dripId: null,
            brewStartedAt: null,
            brewFinishedAt: null,
            emergencyAt: null,
            emergencyDripId: null,
            emergencyPrintedAt: null,
          }))
        : [],
    ),
  );
  return OrderEntity.fromOrder({
    ...draft.toOrder(),
    id: "order-42",
    menus,
    cups,
  });
};

describe("[unit] ラベルの中身", () => {
  test("会計のラベル：抽出が要るカップごとに 1 枚（何杯目/全部で何杯・指名）と、引換券のシール", () => {
    const labels = orderLabels(cashierOrder());
    expect(labels).toEqual([
      {
        type: "cup",
        cupId: undefined,
        orderNo: 42,
        name: "ブレンド",
        index: 1,
        total: 4,
        assignee: null,
      },
      {
        type: "cup",
        cupId: undefined,
        orderNo: 42,
        name: "ブレンド",
        index: 2,
        total: 4,
        assignee: null,
      },
      {
        type: "cup",
        cupId: undefined,
        orderNo: 42,
        name: "ケニア",
        index: 3,
        total: 4,
        assignee: "たくみ",
      },
      {
        type: "cup",
        cupId: undefined,
        orderNo: 42,
        name: "ブレンド",
        index: 4,
        total: 4,
        assignee: null,
      },
      {
        type: "summary",
        orderNo: 42,
        total: 2000,
        assigned: [{ name: "ケニア", assignee: "たくみ" }],
        // 8 文字以上の名前は 6 文字にし、2 つずつ横に並べる
        lines: ["ブレンドとミ  ステッカー", "ブレンド"],
      },
    ]);
  });

  test("保存した注文のカップのシールは、会計のときのシールと全く同じ（カップの ID だけ付く）", () => {
    const before = orderCupLabels(cashierOrder());
    const after = orderCupLabels(savedOrder());
    expect(after.map((l) => l.cupId)).toEqual([
      "cup-1",
      "cup-2",
      "cup-4",
      "cup-5",
    ]);
    expect(after.map(({ cupId, ...rest }) => rest)).toEqual(
      before.map(({ cupId, ...rest }) => rest),
    );
    expect(orderSummaryLabel(savedOrder())).toEqual(
      orderSummaryLabel(cashierOrder()),
    );
  });

  test("緊急のシール：「緊急」のシールのあとに、そのカップの本物と全く同じシール", () => {
    const order = savedOrder();
    const real = orderCupLabels(order)[2];
    expect(emergencyLabels(order, "cup-4")).toEqual([
      { type: "emergency" },
      real,
    ]);
    // シールの無いカップ（アイスミルク）・無いカップ
    expect(emergencyLabels(order, "cup-3")).toBeNull();
    expect(emergencyLabels(order, "nope")).toBeNull();
  });

  test("指名は自由記述があればその文、無ければドリッパーの番号（1st〜6th）を印刷する", () => {
    const order = cashierOrder();
    order.menus[1].assign(3, null);
    const kenya = orderCupLabels(order)[2];
    expect(kenya.name).toBe("ケニア");
    expect(kenya.assignee).toBe("3rd");
    expect(orderSummaryLabel(order).assigned).toEqual([
      { name: "ケニア", assignee: "3rd" },
    ]);
    // 保存した注文（サーバーのカップ）でも同じ
    const draft = savedOrder();
    draft.menus[1].assign(3, null);
    expect(orderCupLabels(draft)[2].assignee).toBe("3rd");
  });

  test("印刷していない緊急のカップを見つける", () => {
    const order = savedOrder();
    const at = new Date("2026-10-08T03:00:00Z");
    const cups = order.cups as Cup[];
    cups[0].emergencyAt = at;
    cups[0].emergencyPrintedAt = at; // もう印刷した
    cups[3].emergencyAt = at;
    expect(
      pendingEmergencyLabels([order]).map((p) => [p.order.id, p.cupId]),
    ).toEqual([["order-42", "cup-4"]]);
  });
});
