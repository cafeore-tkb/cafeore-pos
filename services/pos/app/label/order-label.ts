import { type OrderEntity, assignmentLabelText } from "@cafeore/common";
import type { Label, PrintJob, TextLine, TextRun, TextSize } from "./document";

type CupItem = ReturnType<OrderEntity["getCoffeeCups"]>[number];

/** 行頭の余白（2 倍の大きさの空白 1 文字） */
const MARGIN: TextRun = { text: " ", size: [2, 2] };

/** 余白を付けた 1 行 */
const line = (text: string, size: TextSize): TextLine => [
  MARGIN,
  { text, size },
];

// 引換券に貼る明細シールは刷らないので、コメントアウトしてある（summaryLabel と、orderLabelJob の呼び出しも）
// /**
//  * 引換券のシールで 2 列に並べるときの名前
//  *
//  * 8 文字以上のときは 6 文字だけ取り出す
//  * （俺ブレが正式名称だと入らない、ブレンで切りたくないため）
//  */
// const shortName = (name: string) => (name.length < 8 ? name : name.slice(0, 6));

/** 指名の行（ラベルに印刷する指名。無ければ空白） */
const assignmentLine = (assignment: string | null) =>
  assignment ? `指名： ${assignment}` : "　";

/**
 * カップのシール 1 枚の範囲（80mm の紙のとき）
 *
 * 範囲の終わり（y + height）まで紙が送られるので、ラベル 1 枚（ラベルと隙間）より長いと次のラベルの頭を越え、
 * 次のシールでそのラベルを飛ばして白紙が出る（高さ 230 で同じ注文のシールの間に毎回出た）。
 * そのため中身の下端（いちばん下の行の y = 204。文字は y が基準線で少し下まで、ロゴは y が下端）の少し下で終える。
 */
const CUP_LABEL_AREA = { x: 0, y: 24, width: 570, height: 210 };

/** カップに貼るシール（1 杯につき 1 枚）。範囲の幅は、印字幅（width ドット）が狭い紙ではそれに縮める */
const cupLabel = (
  orderId: number,
  index: number,
  total: number,
  item: CupItem,
  width: number,
): Label => ({
  type: "fixed",
  area: { ...CUP_LABEL_AREA, width: Math.min(CUP_LABEL_AREA.width, width) },
  elements: [
    {
      type: "text",
      x: 0,
      y: 48,
      line: [
        MARGIN,
        { text: "No.", size: [1, 1] },
        { text: `${orderId}`, size: [2, 2] },
      ],
    },
    { type: "text", x: 0, y: 108, line: line(item.name, [1, 2]) },
    { type: "text", x: 0, y: 156, line: line(`${index}/${total}`, [2, 1]) },
    {
      type: "text",
      x: 0,
      y: 204,
      line: line(assignmentLine(assignmentLabelText(item)), [1, 1]),
    },
    { type: "logo", x: 230, y: 204 },
  ],
});

// /** 引換券に貼るシール（番号・合計と、注文の中身） */
// const summaryLabel = (order: OrderEntity): Label => {
//   const lines: TextLine[] = [
//     [
//       { text: " ", size: [1, 1] },
//       { text: "明細 ", size: [1, 2] },
//       { text: "No.", size: [1, 1] },
//       { text: order.orderId.toString().padStart(3, "0"), size: [2, 2] },
//       { text: " ￥", size: [1, 2] },
//       { text: `${order.total}-`, size: [2, 2] },
//     ],
//   ];
//
//   const assignedMenus = order.menus.filter(
//     (menu) => assignmentLabelText(menu) !== null,
//   );
//   const unassignedMenus = order.menus.filter(
//     (menu) => assignmentLabelText(menu) === null,
//   );
//
//   for (const menu of assignedMenus) {
//     lines.push(line(menu.name, [1, 1]));
//     lines.push(line(`  指名：${assignmentLabelText(menu)}`, [1, 1]));
//   }
//
//   for (let i = 0; i < unassignedMenus.length; i += 2) {
//     const item1 = shortName(unassignedMenus[i].name);
//     const item2 = unassignedMenus[i + 1]
//       ? shortName(unassignedMenus[i + 1].name)
//       : null;
//     // 2 つある場合は横に並べる
//     lines.push(line(item2 ? `${item1.padEnd(8, " ")}${item2}` : item1, [1, 1]));
//   }
//
//   return { type: "flow", lines };
// };

const EMERGENCY_TEXT = "緊急";
const EMERGENCY_SIZE: TextSize = [6, 6];

/** 標準の大きさの全角 1 文字の幅と高さ（ドット） */
const FULL_WIDTH_DOTS = 24;

/**
 * 緊急のシール（「緊急」とだけ大きく書いた 1 枚）。緊急で淹れ直したカップのシールの前に刷る
 *
 * カップのシールはレジで刷るものと同じなので、続けて刷るこれで、淹れ直しのシールだと分かるようにする。
 * 範囲はカップのシールと同じ（シールの切れ目にかからないように）。
 * ページモードでは文字を寄せられないので、文字の幅から x を決めて中央に置く
 * （6 倍で 288 × 144 ドット。いちばん狭い 58mm のダイカットラベル（384 ドット）にも入る）。
 */
const emergencyLabel = (width: number): Label => {
  const areaWidth = Math.min(CUP_LABEL_AREA.width, width);
  const textWidth = EMERGENCY_TEXT.length * FULL_WIDTH_DOTS * EMERGENCY_SIZE[0];
  const textHeight = FULL_WIDTH_DOTS * EMERGENCY_SIZE[1];
  return {
    type: "fixed",
    area: { ...CUP_LABEL_AREA, width: areaWidth },
    elements: [
      {
        type: "text",
        x: Math.floor((areaWidth - textWidth) / 2),
        y: Math.floor((CUP_LABEL_AREA.height + textHeight) / 2),
        line: [{ text: EMERGENCY_TEXT, size: EMERGENCY_SIZE }],
      },
    ],
  };
};

/**
 * 緊急で淹れ直したカップ 1 杯の分：緊急のシールと、そのカップのシール。
 * カップのシールは注文で刷るものと同じ中身で、「2/3」はその注文の抽出が要るカップの中の順番。
 * 注文にそのカップが無ければ null。width は刷るプリンターの印字幅（ドット）
 */
export const emergencyLabelJob = (
  order: OrderEntity,
  cupId: string,
  width: number,
): PrintJob | null => {
  const cups = order.getCups().filter((cup) => cup.item_type.needs_brew);
  const index = cups.findIndex((cup) => cup.cupId === cupId);
  if (index < 0) return null;
  return {
    labels: [
      emergencyLabel(width),
      cupLabel(order.orderId, index + 1, cups.length, cups[index], width),
    ],
  };
};

/**
 * 注文で刷るシール。width は刷るプリンターの印字幅（ドット）
 *
 * 抽出が要るもの 1 杯ごとにカップに貼るシールを刷る（抽出が要るものが無ければ空）。
 * 引換券に貼るシールは刷らない（コメントアウトしてある）。
 */
export const orderLabelJob = (order: OrderEntity, width: number): PrintJob => {
  const cups = order.getCoffeeCups();
  return {
    labels: [
      ...cups.map((item, idx) =>
        cupLabel(order.orderId, idx + 1, cups.length, item, width),
      ),
      // summaryLabel(order),
    ],
  };
};
