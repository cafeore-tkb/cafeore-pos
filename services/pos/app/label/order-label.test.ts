import { type ItemType, MenuEntity, OrderEntity } from "@cafeore/common";
import { describe, expect, test } from "vitest";
import type { Label, StickerLabel, TextLine } from "./document";
import { emergencyLabelJobs, orderLabelJob } from "./order-label";
import { DIE_CUT_LABEL_WIDTHS, RECEIPT_PAPER_WIDTHS } from "./paper";
import type { EmergencyStickers } from "./sticker";

/** 80mm のダイカットラベルの印字幅で、長さ 29mm（232 ドット）の回さないシール */
const WIDTH = DIE_CUT_LABEL_WIDTHS["80mm"];
const GEOMETRY = { width: WIDTH, height: 232, rotate180: false };

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

    const { labels } = orderLabelJob(order, GEOMETRY);

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

    const [cup] = orderLabelJob(order, GEOMETRY).labels;

    expect(cup.type === "fixed" && cup.elements.at(-1)).toEqual({
      type: "logo",
      x: 230,
      y: 204,
    });
  });

  test("カップのシールの範囲（幅 570）は、印字幅がそれより狭い紙では印字幅に縮める", () => {
    const order = orderOf(7, [menu("ブレンド", hotType, null)]);
    const widthOf = (width: number) => {
      const [cup] = orderLabelJob(order, { ...GEOMETRY, width }).labels;
      return cup.type === "fixed" && cup.area.width;
    };

    expect(widthOf(RECEIPT_PAPER_WIDTHS.tm_l90["80mm"])).toBe(570);
    expect(widthOf(DIE_CUT_LABEL_WIDTHS["80mm"])).toBe(560);
    expect(widthOf(DIE_CUT_LABEL_WIDTHS["58mm"])).toBe(384);
    // 高さと位置は変えない
    const [cup] = orderLabelJob(order, GEOMETRY).labels;
    expect(cup.type === "fixed" && cup.area).toEqual({
      x: 0,
      y: 24,
      width: 560,
      height: 210,
    });
  });

  test("抽出が要るものが無ければ、何も刷らない", () => {
    const order = orderOf(12, [menu("クッキー", goodsType, null)]);

    expect(orderLabelJob(order, GEOMETRY).labels).toEqual([]);
  });

  // test("引換券のシールは、指名ありを先に 1 つずつ、指名なしを 2 列で並べる", () => {
  //   const order = orderOf(45, [
  //     menu("ブレンド", hotType, null),
  //     menu("アイス", hotType, "B"),
  //     menu("俺のブレンドスペシャル", hotType, null),
  //     menu("ラテ", hotType, null),
  //   ]);
  //
  //   const summary = orderLabelJob(order, GEOMETRY).labels.at(-1);
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

describe("[unit] orderLabelJob（180° 回す）", () => {
  test("範囲をシールの上で 180° 回した所に置き、範囲の中を回す（中身の座標は変えない）", () => {
    const order = orderOf(7, [menu("ブレンド", hotType, null)]);
    const [plain] = orderLabelJob(order, {
      width: 360,
      height: 232,
      rotate180: false,
    }).labels;
    const [rotated] = orderLabelJob(order, {
      width: 360,
      height: 232,
      rotate180: true,
    }).labels;

    // 回さないと y = 24〜234。回すと 232 − 234 〜 232 − 24 だが、シールの頭より前は切る
    expect(rotated).toEqual({
      ...plain,
      area: { x: 0, y: 0, width: 360, height: 208 },
      rotate180: true,
    });
  });

  test("シールが範囲より長ければ、回した範囲はシールの終わりから 24 ドット手前で終わる。範囲の幅が印字幅より狭ければ、右に寄せる", () => {
    const order = orderOf(7, [menu("ブレンド", hotType, null)]);
    const [cup] = orderLabelJob(order, {
      width: 576,
      height: 320,
      rotate180: true,
    }).labels;

    expect(cup.type === "fixed" && cup.area).toEqual({
      x: 6,
      y: 86,
      width: 570,
      height: 210,
    });
  });
});

describe("[unit] emergencyLabelJobs", () => {
  /** 注文をサーバーが保存した形にする（カップはカップを作る種類だけ。id は「cup-名前」） */
  const savedOf = (order: OrderEntity) => {
    const lines = order.menus.map((m) => ({
      ...m.toMenu(),
      orderMenuId: crypto.randomUUID(),
    }));
    return OrderEntity.fromOrder({
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
  };

  /** 描いた緊急のシールの代わり（画像は canvas が要るので、ここでは描かない） */
  const sticker = (bits: string): StickerLabel => ({
    type: "sticker",
    image: { width: 8, height: 1, bits },
  });
  const stickers: EmergencyStickers = {
    start: sticker("gA=="),
    end: sticker("AQ=="),
  };

  const order = orderOf(7, [
    menu("ブレンド", hotType, null),
    menu("クッキー", goodsType, null),
    menu("カフェオレ", hotType, "やまだ"),
  ]);
  const saved = savedOf(order);
  const cupLabels = orderLabelJob(order, GEOMETRY).labels;

  test("1 杯なら、ここから・そのカップのシール（注文で刷ったものと同じ。「2/2」は抽出が要るカップの中の順番）・ここまで", () => {
    const jobs = emergencyLabelJobs(
      [{ order: saved, cupId: "cup-カフェオレ", emergencyId: "e1" }],
      GEOMETRY,
      stickers,
    );

    expect(jobs).toEqual([
      {
        cup: { order: saved, cupId: "cup-カフェオレ", emergencyId: "e1" },
        job: { labels: [stickers.start, cupLabels[1], stickers.end] },
      },
    ]);
  });

  test("何杯かなら 1 杯ずつの印刷データにし、最初の杯の前にここから、最後の杯の後ろにここまでを付ける", () => {
    const jobs = emergencyLabelJobs(
      [
        { order: saved, cupId: "cup-ブレンド", emergencyId: "e1" },
        { order: saved, cupId: "cup-カフェオレ", emergencyId: "e2" },
        { order: saved, cupId: "cup-ブレンド", emergencyId: "e3" },
      ],
      GEOMETRY,
      stickers,
    );

    expect(jobs.map(({ cup, job }) => [cup.emergencyId, job.labels])).toEqual([
      ["e1", [stickers.start, cupLabels[0]]],
      ["e2", [cupLabels[1]]],
      ["e3", [cupLabels[0], stickers.end]],
    ]);
  });

  test("抽出が要らないカップ・注文に無いカップは飛ばし、緊急のシールは残った最初と最後の杯に付ける", () => {
    const jobs = emergencyLabelJobs(
      [
        { order: saved, cupId: "cup-クッキー", emergencyId: "e1" },
        { order: saved, cupId: "cup-ブレンド", emergencyId: "e2" },
        { order: saved, cupId: "cup-無い", emergencyId: "e3" },
      ],
      GEOMETRY,
      stickers,
    );

    expect(jobs.map(({ cup, job }) => [cup.emergencyId, job.labels])).toEqual([
      ["e2", [stickers.start, cupLabels[0], stickers.end]],
    ]);
    expect(
      emergencyLabelJobs(
        [{ order: saved, cupId: "cup-無い", emergencyId: "e1" }],
        GEOMETRY,
        stickers,
      ),
    ).toEqual([]);
  });

  test("カップのシールは、刷るプリンターのシールの大きさと向きで作る", () => {
    const geometry = { width: 360, height: 232, rotate180: true };
    const [{ job }] = emergencyLabelJobs(
      [{ order: saved, cupId: "cup-ブレンド", emergencyId: "e1" }],
      geometry,
      stickers,
    );

    expect(job.labels[1]).toEqual(orderLabelJob(order, geometry).labels[0]);
  });
});
