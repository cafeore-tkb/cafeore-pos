import { type ItemType, MenuEntity, OrderEntity } from "@cafeore/common";
import { describe, expect, test } from "vitest";
import type { Label, TextLine } from "./document";
import { cupLabelJob, orderLabelJob } from "./order-label";
import { DIE_CUT_LABEL_WIDTHS, RECEIPT_PAPER_WIDTHS } from "./paper";

/** 80mm のダイカットラベル（いつものシール）の印字幅 */
const WIDTH = DIE_CUT_LABEL_WIDTHS["80mm"];

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

// 引換券に貼るシールは刷らないので、そのテストもコメントアウトしてある（order-label.ts の summaryLabel と同じ）
// /** 引換券に貼るシールの、上から順の行 */
// const summaryLines = (label: Label) => {
//   if (label.type !== "flow") throw new Error("flow ではない");
//   return label.lines.map(textOf);
// };

describe("[unit] orderLabelJob", () => {
  test("抽出が要るもの 1 杯ごとのシールだけを刷る（引換券のシールは刷らない）", () => {
    const order = orderOf(7, [
      menu("ブレンド", hotType, null),
      menu("カフェオレ", hotType, "やまだ"),
      menu("クッキー", goodsType, null),
    ]);

    const { labels } = orderLabelJob(order, WIDTH);

    expect(labels.map((label) => label.type)).toEqual(["fixed", "fixed"]);
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

    const [cup] = orderLabelJob(order, WIDTH).labels;

    expect(cup.type === "fixed" && cup.elements.at(-1)).toEqual({
      type: "logo",
      x: 230,
      y: 204,
    });
  });

  test("カップのシールの範囲（幅 570）は、印字幅がそれより狭い紙では印字幅に縮める", () => {
    const order = orderOf(7, [menu("ブレンド", hotType, null)]);
    const widthOf = (width: number) => {
      const [cup] = orderLabelJob(order, width).labels;
      return cup.type === "fixed" && cup.area.width;
    };

    expect(widthOf(RECEIPT_PAPER_WIDTHS.tm_l90["80mm"])).toBe(570);
    expect(widthOf(DIE_CUT_LABEL_WIDTHS["80mm"])).toBe(560);
    expect(widthOf(DIE_CUT_LABEL_WIDTHS["58mm"])).toBe(384);
    // 高さと位置は変えない
    const [cup] = orderLabelJob(order, WIDTH).labels;
    expect(cup.type === "fixed" && cup.area).toEqual({
      x: 0,
      y: 24,
      width: 560,
      height: 210,
    });
  });

  test("抽出が要るものが無ければ、何も刷らない", () => {
    const order = orderOf(12, [menu("クッキー", goodsType, null)]);

    expect(orderLabelJob(order, WIDTH).labels).toEqual([]);
  });

  // test("引換券のシールは、指名ありを先に 1 つずつ、指名なしを 2 列で並べる", () => {
  //   const order = orderOf(45, [
  //     menu("ブレンド", hotType, null),
  //     menu("アイス", hotType, "B"),
  //     menu("俺のブレンドスペシャル", hotType, null),
  //     menu("ラテ", hotType, null),
  //   ]);
  //
  //   const summary = orderLabelJob(order, WIDTH).labels.at(-1);
  //
  //   expect(summary && summaryLines(summary)).toEqual([
  //     " 明細 No.045 ￥1200-",
  //     " アイス",
  //     "   指名：B",
  //     // 8 文字以上の名前は 6 文字にする
  //     " ブレンド    俺のブレンド",
  //     " ラテ",
  //   ]);
  // });
});

describe("[unit] cupLabelJob", () => {
  test("保存した注文のカップ 1 杯のシールは、注文で刷ったそのカップのシールと同じ（「2/2」は抽出が要るカップの中の順番）", () => {
    const order = orderOf(7, [
      menu("ブレンド", hotType, null),
      menu("クッキー", goodsType, null),
      menu("カフェオレ", hotType, "やまだ"),
    ]);
    // サーバーが作ったカップ（カップを作る種類だけ）と同じ形にする
    const lines = order.menus.map((m) => ({
      ...m.toMenu(),
      orderMenuId: crypto.randomUUID(),
    }));
    const saved = OrderEntity.fromOrder({
      ...order.toOrder(),
      menus: lines,
      cups: lines
        .filter((line) => line.items[0].item.item_type.makes_cup)
        .map((line) => ({
          id: `cup-${line.name}`,
          orderMenuId: line.orderMenuId,
          item: { ...line.items[0].item, id: line.name },
          readyAt: null,
          servedAt: null,
          dripper: null,
          dripperPosition: null,
          dripId: null,
          brewStartedAt: null,
          brewFinishedAt: null,
          emergencies: [],
        })),
    });

    expect(cupLabelJob(saved, "cup-カフェオレ", WIDTH)).toEqual({
      labels: [orderLabelJob(order, WIDTH).labels[1]],
    });
    expect(cupLabelJob(saved, "cup-クッキー", WIDTH)).toBeNull();
  });
});
