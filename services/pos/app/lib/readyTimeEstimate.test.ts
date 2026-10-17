import { type ItemType, MenuEntity, OrderEntity } from "@cafeore/common";
import { describe, expect, test } from "vitest";
import { currentStack, predictReadyMinutes } from "./readyTimeEstimate";

describe("[unit] predictReadyMinutes", () => {
  // 実装資料の検算表（丸めたパラメータで計算した期待値、小数第 3 位まで）
  const cases: [stack: number, n6: number, n5: number, n7: number][] = [
    [0, 5.987, 5.987, 5.987],
    [7, 5.987, 5.987, 5.987],
    [8, 6.305, 6.448, 6.203],
    [10, 7.193, 7.735, 6.805],
    [12, 8.08, 9.022, 7.408],
    [15, 9.412, 10.952, 8.312],
    [20, 11.631, 14.168, 9.818],
    [25, 13.849, 17.385, 11.324],
    [30, 16.068, 20.602, 12.83],
  ];

  test.each(cases)("stack %i 杯", (stack, n6, n5, n7) => {
    expect(predictReadyMinutes(stack)).toBeCloseTo(n6, 3);
    expect(predictReadyMinutes(stack, 6)).toBeCloseTo(n6, 3);
    expect(predictReadyMinutes(stack, 5)).toBeCloseTo(n5, 3);
    expect(predictReadyMinutes(stack, 7)).toBeCloseTo(n7, 3);
  });
});

describe("[unit] currentStack", () => {
  const itemType = (name: string, makesCup: boolean): ItemType => ({
    id: name,
    name,
    display_name: name,
    makes_cup: makesCup,
    needs_brew: makesCup,
    senior_only: false,
    iced_brew: false,
    needs_finishing: false,
  });
  const hot = itemType("hot", true);
  const goods = itemType("others", false);

  const menu = (id: string, ...types: ItemType[]) =>
    MenuEntity.fromMenu({
      id,
      name: id,
      abbr: id,
      price: 500,
      key: id,
      items: types.map((type, i) => ({
        item: { id: `${id}-${i}`, name: id, abbr: id, item_type: type },
        quantity: 1,
      })),
      assignee: null,
    });

  const blend = menu("blend", hot);
  const tote = menu("tote", hot, goods); // トートのセットはドリンクだけ 1 杯
  const bag = menu("bag", goods);

  const order = (
    createdAt: string,
    menus: ReturnType<typeof menu>[],
    { readyAt, servedAt }: { readyAt?: string; servedAt?: string } = {},
  ) => {
    const entity = OrderEntity.fromOrder({
      ...OrderEntity.createNew({ orderId: 1 }).toOrder(),
      createdAt: new Date(createdAt),
      readyAt: readyAt ? new Date(readyAt) : null,
      servedAt: servedAt ? new Date(servedAt) : null,
    });
    entity.menus = menus;
    return entity;
  };

  const now = new Date("2026-11-07T12:00:00+09:00");

  test("提供可能になっていない今日の注文のドリンク杯数を足す", () => {
    const orders = [
      order("2026-11-07T11:50:00+09:00", [blend, blend]),
      order("2026-11-07T11:55:00+09:00", [tote, bag]),
    ];
    expect(currentStack(orders, now)).toBe(3);
  });

  test("readyAt がある注文は、受け取り待ちでも数えない", () => {
    const orders = [
      order("2026-11-07T11:50:00+09:00", [blend], {
        readyAt: "2026-11-07T11:58:00+09:00",
      }),
      order("2026-11-07T11:40:00+09:00", [blend], {
        readyAt: "2026-11-07T11:45:00+09:00",
        servedAt: "2026-11-07T11:46:00+09:00",
      }),
      order("2026-11-07T11:55:00+09:00", [blend]),
    ];
    expect(currentStack(orders, now)).toBe(1);
  });

  test("前の日（日本時間）の注文は打刻忘れでも数えない", () => {
    const orders = [
      order("2026-11-06T23:59:00+09:00", [blend, blend]),
      order("2026-11-07T00:01:00+09:00", [blend]),
    ];
    expect(currentStack(orders, now)).toBe(1);
  });

  test("now より後に確定した注文も数える（画面の now は少し古いことがある）", () => {
    const orders = [order("2026-11-07T12:00:20+09:00", [blend])];
    expect(currentStack(orders, now)).toBe(1);
  });
});
