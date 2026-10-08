import { describe, expect, test } from "vitest";
import {
  type OrderResponse,
  orderEntityToCreateRequest,
  responseToOrderEntity,
  responseToPrintJob,
} from "../firebase-utils/converter";
import { MenuEntity } from "../models/menu";
import { OrderEntity } from "../models/order";
import {
  emergencyLabels,
  orderCupLabels,
  orderLabels,
  orderSummaryLabel,
  printJobLabels,
} from "./label";

const itemType = (name: string) => ({
  id: `type-${name}`,
  name,
  display_name: name,
});
const item = (id: string, name: string, type: string) => ({
  id,
  name,
  abbr: name.slice(0, 2),
  item_type: itemType(type),
});
const blend = item("item-blend", "俺ブレンド", "hot");
const kenya = item("item-kenya", "ケニア", "ice");
const milk = item("item-milk", "アイスミルク", "milk");
const tote = item("item-tote", "トートバッグ", "others");

const menu = (
  id: string,
  name: string,
  items: ReturnType<typeof item>[],
  price = 500,
) => ({
  id: `line-${id}`,
  menu_name: name,
  unit_price: price,
  assignee: null as string | null,
  dripper: null as number | null,
  menu: {
    id: `menu-${id}`,
    name,
    price,
    abbr: name,
    key: id,
    items: items.map((i) => ({ quantity: 1, item: i })),
  },
});

// 俺ブレンド＋トートのセット・ケニア（指名 2nd・自由記述あり）・アイスミルク・ケニア
const lines = [
  menu("set", "俺ブレンドとトートのセット", [blend, tote], 1500),
  { ...menu("kenya1", "ケニア", [kenya]), dripper: 2, assignee: "山田" },
  menu("milk", "アイスミルク", [milk], 300),
  menu("kenya2", "ケニア", [kenya]),
];
const cup = (id: string, line: string, i: ReturnType<typeof item>) => ({
  id,
  order_menu_id: `line-${line}`,
  item: i,
  ready_at: null,
  served_at: null,
});
const response: OrderResponse = {
  id: "order-1",
  order_id: 12,
  created_at: "2026-10-08T01:00:00Z",
  billing_amount: 2800,
  received: 3000,
  menus: lines,
  cups: [
    cup("cup-blend", "set", blend),
    cup("cup-kenya1", "kenya1", kenya),
    cup("cup-milk", "milk", milk),
    cup("cup-kenya2", "kenya2", kenya),
  ],
};

describe("[unit] label", () => {
  test("カップごとのシールは、シールのあるカップ（アイスミルク・グッズ以外）を注文した順に数える", () => {
    const order = responseToOrderEntity(response);
    expect(orderCupLabels(order)).toEqual([
      {
        type: "cup",
        cupId: "cup-blend",
        orderNo: 12,
        name: "俺ブレンド",
        index: 1,
        total: 3,
        assignment: null,
      },
      {
        type: "cup",
        cupId: "cup-kenya1",
        orderNo: 12,
        name: "ケニア",
        index: 2,
        total: 3,
        assignment: "山田",
      },
      {
        type: "cup",
        cupId: "cup-kenya2",
        orderNo: 12,
        name: "ケニア",
        index: 3,
        total: 3,
        assignment: null,
      },
    ]);
  });

  test("引換券に貼るシールは、指名のある明細と、残りの明細の名前を 2 つずつ並べた行", () => {
    const order = responseToOrderEntity(response);
    expect(orderSummaryLabel(order)).toEqual({
      type: "summary",
      orderNo: 12,
      total: 2800,
      assigned: [{ name: "ケニア", assignment: "山田" }],
      // 8 文字以上の名前は 6 文字にする
      lines: ["俺ブレンドと  アイスミルク", "ケニア"],
    });
  });

  test("レジの会計のラベルは、カップのシールを順に、最後に引換券のシール", () => {
    const order = responseToOrderEntity(response);
    expect(orderLabels(order).map((l) => l.type)).toEqual([
      "cup",
      "cup",
      "cup",
      "summary",
    ]);
  });

  test("緊急は「緊急」のシール → そのカップの本物と全く同じシール", () => {
    const order = responseToOrderEntity(response);
    const real = orderLabels(order);
    expect(emergencyLabels(order, "cup-kenya2")).toEqual([
      { type: "emergency" },
      real[2],
    ]);
    expect(
      printJobLabels({ kind: "emergency", cupId: "cup-kenya1" }, order),
    ).toEqual([{ type: "emergency" }, real[1]]);
    expect(printJobLabels({ kind: "order", cupId: null }, order)).toEqual(real);
    // シールの無いカップ・無いカップ・カップの指定が無いときは作らない
    expect(emergencyLabels(order, "cup-milk")).toBeNull();
    expect(emergencyLabels(order, "cup-x")).toBeNull();
    expect(
      printJobLabels({ kind: "emergency", cupId: null }, order),
    ).toBeNull();
  });

  test("保存前の注文（カップなし）は、今までのレジと同じ getCoffeeCups の展開", () => {
    const order = OrderEntity.createNew({ orderId: 3 });
    order.menus = responseToOrderEntity(response).menus.map((m) =>
      MenuEntity.fromMenu(m.toMenu()),
    );
    expect(
      orderCupLabels(order).map((l) => [l.name, l.index, l.total, l.cupId]),
    ).toEqual(
      order
        .getCoffeeCups()
        .map((c, i, all) => [c.name, i + 1, all.length, undefined]),
    );
  });
});

describe("[unit] print job conversion", () => {
  test("API の PrintJob の日時を Date にする", () => {
    const job = responseToPrintJob({
      id: 5,
      kind: "emergency",
      source: "caos",
      order_id: "order-1",
      order_no: 12,
      cup_id: "cup-kenya1",
      status: "printing",
      printer_id: "printer-a",
      claimed_at: "2026-10-08T01:00:00Z",
      finished_at: null,
      error: null,
      attempts: 1,
      created_at: "2026-10-08T00:59:00Z",
      updated_at: "2026-10-08T01:00:00Z",
    });
    expect(job).toMatchObject({
      id: 5,
      kind: "emergency",
      source: "caos",
      orderId: "order-1",
      orderNo: 12,
      cupId: "cup-kenya1",
      status: "printing",
      printerId: "printer-a",
      claimedAt: new Date("2026-10-08T01:00:00Z"),
      finishedAt: null,
      error: null,
    });
  });

  test("レジの会計だけ print_labels を付けて注文を作る", () => {
    const order = responseToOrderEntity(response);
    expect(orderEntityToCreateRequest(order)).not.toHaveProperty(
      "print_labels",
    );
    expect(
      orderEntityToCreateRequest(order, { printLabels: true }).print_labels,
    ).toBe(true);
  });
});
