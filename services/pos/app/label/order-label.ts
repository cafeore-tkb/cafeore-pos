import { type OrderEntity, assignmentLabelText } from "@cafeore/common";
import type { Label, PrintJob, TextLine, TextRun, TextSize } from "./document";
import type { LabelGeometry } from "./paper";
import type { EmergencyStickers } from "./sticker";

type CupItem = ReturnType<OrderEntity["getCoffeeCups"]>[number];

/** カップのシールに使う、ラベル用のシールの大きさと向き（余白は使わない） */
type CupGeometry = Pick<LabelGeometry, "width" | "height" | "rotate180">;

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

type Area = typeof CUP_LABEL_AREA;

/**
 * 180° 回すときの範囲。シール（印字幅 width × 長さ height）の真ん中を中心に、回さないときの範囲を回した所に置く。
 * 範囲の中は右下から置く（document.ts の fixed の rotate180）ので、中身もシールの上で回さないときと点対称になる。
 * シールの頭より前に出る分は切る（回さないときに、シールの終わりを越えて刷られない分と同じ）
 */
const rotatedArea = (area: Area, width: number, height: number): Area => {
  const top = Math.max(0, height - (area.y + area.height));
  return {
    x: width - (area.x + area.width),
    y: top,
    width: area.width,
    height: height - area.y - top,
  };
};

/**
 * カップに貼るシール（1 杯につき 1 枚）。範囲の幅は、印字幅（width ドット）が狭い紙ではそれに縮める。
 * rotate180 なら、シールの上で 180° 回した所に、範囲の中を回して置く
 */
const cupLabel = (
  orderId: number,
  index: number,
  total: number,
  item: CupItem,
  { width, height, rotate180 }: CupGeometry,
): Label => {
  const area = {
    ...CUP_LABEL_AREA,
    width: Math.min(CUP_LABEL_AREA.width, width),
  };
  return {
    type: "fixed",
    area: rotate180 ? rotatedArea(area, width, height) : area,
    ...(rotate180 ? { rotate180 } : {}),
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
  };
};

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

/** 緊急で淹れ直すカップ 1 杯（どの注文のどのカップか） */
type EmergencyCup = { order: OrderEntity; cupId: string };

/**
 * 緊急で淹れ直したカップ 1 杯のシール。注文で刷るものと同じ中身で、「2/3」はその注文の抽出が要るカップの中の順番。
 * 注文にそのカップが無ければ null
 */
const emergencyCupLabel = (
  { order, cupId }: EmergencyCup,
  geometry: CupGeometry,
) => {
  const cups = order.getCups().filter((cup) => cup.item_type.needs_brew);
  const index = cups.findIndex((cup) => cup.cupId === cupId);
  if (index < 0) return null;
  return cupLabel(order.orderId, index + 1, cups.length, cups[index], geometry);
};

/**
 * 一度に緊急で淹れ直したカップの分（cups の順）。geometry は刷るプリンターのシールの大きさと向き
 *
 * 1 杯ずつの印刷データにし、最初の杯の前に「ここから」、最後の杯の後ろに「ここまで」の緊急のシール
 * （sticker.ts の emergencyStickers で描いたもの）を付ける。順に刷ると、淹れ直したカップのシールが緊急のシールで挟まれる。
 * 1 杯ずつにするのは、刷れなかったもの・代理印刷・取り消しを淹れ直しごとに扱うため（print-util の usePrinter）。
 * 注文にそのカップが無い杯は飛ばす（緊急のシールは、残った最初と最後の杯に付ける）。
 */
export const emergencyLabelJobs = <C extends EmergencyCup>(
  cups: readonly C[],
  geometry: CupGeometry,
  stickers: EmergencyStickers,
): { cup: C; job: PrintJob }[] => {
  const labels = cups.flatMap((cup) => {
    const label = emergencyCupLabel(cup, geometry);
    return label ? [{ cup, label }] : [];
  });
  const last = labels.length - 1;
  return labels.map(({ cup, label }, i) => ({
    cup,
    job: {
      labels: [
        ...(i === 0 ? [stickers.start] : []),
        label,
        ...(i === last ? [stickers.end] : []),
      ],
    },
  }));
};

/**
 * 注文で刷るシール。geometry は刷るプリンターのシールの大きさと向き
 *
 * 抽出が要るもの 1 杯ごとにカップに貼るシールを刷る（抽出が要るものが無ければ空）。
 * 引換券に貼るシールは刷らない（コメントアウトしてある）。
 */
export const orderLabelJob = (
  order: OrderEntity,
  geometry: CupGeometry,
): PrintJob => {
  const cups = order.getCoffeeCups();
  return {
    labels: [
      ...cups.map((item, idx) =>
        cupLabel(order.orderId, idx + 1, cups.length, item, geometry),
      ),
      // summaryLabel(order),
    ],
  };
};
