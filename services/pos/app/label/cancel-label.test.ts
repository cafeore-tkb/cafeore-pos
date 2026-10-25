import { type ItemType, MenuEntity, OrderEntity } from "@cafeore/common";
import { describe, expect, test } from "vitest";
import { cancelLabelJob, hasCancelLabel } from "./cancel-label";

const hotType: ItemType = {
  id: "1",
  name: "hot",
  display_name: "ホット",
  makes_cup: true,
  needs_brew: true,
  senior_only: false,
  iced_brew: false,
  serve_with_snack: false,
};
const goodsType: ItemType = {
  ...hotType,
  id: "2",
  name: "goods",
  display_name: "グッズ",
  makes_cup: false,
  needs_brew: false,
};

const menu = (name: string, itemType: ItemType) =>
  MenuEntity.fromMenu({
    id: name,
    name,
    abbr: name,
    price: 300,
    key: name,
    item_type: itemType,
    assignee: null,
  });

const orderOf = (menus: ReturnType<typeof menu>[]) => {
  const order = OrderEntity.createNew({ orderId: 12 });
  order.menus = menus;
  return order;
};

describe("[unit] hasCancelLabel", () => {
  test("カップのシールを刷る注文（抽出が要るものがある）なら刷る", () => {
    expect(
      hasCancelLabel(
        orderOf([menu("ブレンド", hotType), menu("クッキー", goodsType)]),
      ),
    ).toBe(true);
  });

  test("抽出が要るものが無い注文には刷らない", () => {
    expect(hasCancelLabel(orderOf([menu("クッキー", goodsType)]))).toBe(false);
  });
});

describe("[unit] cancelLabelJob", () => {
  test("刷らない注文は、画像を描かずに null", async () => {
    await expect(
      cancelLabelJob(orderOf([menu("クッキー", goodsType)]), {
        width: 360,
        height: 232,
        margin: 0,
      }),
    ).resolves.toBeNull();
  });
});
