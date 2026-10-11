import { type ItemType, MenuEntity, OrderEntity } from "@cafeore/common";
import { describe, expect, test } from "vitest";
import type { Label, TextLine } from "./document";
import { orderLabelJob } from "./order-label";

const hotType: ItemType = {
  id: "1",
  name: "hot",
  display_name: "ホット",
  makes_cup: true,
  needs_brew: true,
  senior_only: false,
  iced_brew: false,
};
const goodsType: ItemType = {
  ...hotType,
  id: "2",
  name: "goods",
  display_name: "グッズ",
  makes_cup: false,
  needs_brew: false,
};

const menu = (name: string, itemType: ItemType, assignee: string | null) =>
  MenuEntity.fromMenu({
    id: name,
    name,
    abbr: name,
    price: 300,
    key: name,
    item_type: itemType,
    assignee,
  });

const orderOf = (orderId: number, menus: ReturnType<typeof menu>[]) => {
  const order = OrderEntity.createNew({ orderId });
  order.menus = menus;
  return order;
};

/** 1 行の文字をつなげたもの（行頭の余白を含む） */
const textOf = (line: TextLine) => line.map((run) => run.text).join("");

/** カップに貼るシールの、上から順の行 */
const cupLines = (label: Label) => {
  if (label.type !== "fixed") throw new Error("fixed ではない");
  return label.elements.flatMap((element) =>
    element.type === "text" ? [textOf(element.line)] : [],
  );
};

/** 引換券に貼るシールの、上から順の行 */
const summaryLines = (label: Label) => {
  if (label.type !== "flow") throw new Error("flow ではない");
  return label.lines.map(textOf);
};

describe("[unit] orderLabelJob", () => {
  test("抽出が要るもの 1 杯ごとのシールと、引換券のシール 1 枚を刷る", () => {
    const order = orderOf(7, [
      menu("ブレンド", hotType, null),
      menu("カフェオレ", hotType, "やまだ"),
      menu("クッキー", goodsType, null),
    ]);

    const { labels } = orderLabelJob(order);

    expect(labels.map((label) => label.type)).toEqual([
      "fixed",
      "fixed",
      "flow",
    ]);
    expect(cupLines(labels[0])).toEqual([" No.7", " ブレンド", " 1/2", " 　"]);
    expect(cupLines(labels[1])).toEqual([
      " No.7",
      " カフェオレ",
      " 2/2",
      " 指名： やまだ",
    ]);
  });

  test("カップのシールにはロゴを置く", () => {
    const order = orderOf(7, [menu("ブレンド", hotType, null)]);

    const [cup] = orderLabelJob(order).labels;

    expect(cup.type === "fixed" && cup.elements.at(-1)).toEqual({
      type: "logo",
      x: 230,
      y: 204,
    });
  });

  test("抽出が要るものが無ければ、引換券のシールだけを刷る", () => {
    const order = orderOf(12, [menu("クッキー", goodsType, null)]);

    const { labels } = orderLabelJob(order);

    expect(labels).toHaveLength(1);
    expect(summaryLines(labels[0])).toEqual([
      " 明細 No.012 ￥300-",
      " クッキー",
    ]);
  });

  test("引換券のシールは、指名ありを先に 1 つずつ、指名なしを 2 列で並べる", () => {
    const order = orderOf(45, [
      menu("ブレンド", hotType, null),
      menu("アイス", hotType, "B"),
      menu("俺のブレンドスペシャル", hotType, null),
      menu("ラテ", hotType, null),
    ]);

    const summary = orderLabelJob(order).labels.at(-1);

    expect(summary && summaryLines(summary)).toEqual([
      " 明細 No.045 ￥1200-",
      " アイス",
      "   指名：B",
      // 8 文字以上の名前は 6 文字にする
      " ブレンド    俺のブレンド",
      " ラテ",
    ]);
  });
});
