import { type OrderEntity, assignmentLabelText } from "@cafeore/common";
import type { Label, PrintJob, TextLine, TextRun, TextSize } from "./document";

type CupItem = ReturnType<OrderEntity["getCoffeeCups"]>[number];

type FixedLabel = Extract<Label, { type: "fixed" }>;

/** 行頭の余白（2 倍の大きさの空白 1 文字） */
const MARGIN: TextRun = { text: " ", size: [2, 2] };

/** 余白を付けた 1 行 */
const line = (text: string, size: TextSize): TextLine => [
  MARGIN,
  { text, size },
];

/**
 * 引換券のシールで 2 列に並べるときの名前
 *
 * 8 文字以上のときは 6 文字だけ取り出す
 * （俺ブレが正式名称だと入らない、ブレンで切りたくないため）
 */
const shortName = (name: string) => (name.length < 8 ? name : name.slice(0, 6));

/** 指名の行（ラベルに印刷する指名。無ければ空白） */
const assignmentLine = (assignment: string | null) =>
  assignment ? `指名： ${assignment}` : "　";

/** カップに貼るシール（1 杯につき 1 枚） */
const cupLabel = (
  orderId: number,
  index: number,
  total: number,
  item: CupItem,
): FixedLabel => ({
  type: "fixed",
  area: { x: 0, y: 24, width: 570, height: 230 },
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

/** 引換券に貼るシール（番号・合計と、注文の中身） */
const summaryLabel = (order: OrderEntity): Label => {
  const lines: TextLine[] = [
    [
      { text: " ", size: [1, 1] },
      { text: "明細 ", size: [1, 2] },
      { text: "No.", size: [1, 1] },
      { text: order.orderId.toString().padStart(3, "0"), size: [2, 2] },
      { text: " ￥", size: [1, 2] },
      { text: `${order.total}-`, size: [2, 2] },
    ],
  ];

  const assignedMenus = order.menus.filter(
    (menu) => assignmentLabelText(menu) !== null,
  );
  const unassignedMenus = order.menus.filter(
    (menu) => assignmentLabelText(menu) === null,
  );

  for (const menu of assignedMenus) {
    lines.push(line(menu.name, [1, 1]));
    lines.push(line(`  指名：${assignmentLabelText(menu)}`, [1, 1]));
  }

  for (let i = 0; i < unassignedMenus.length; i += 2) {
    const item1 = shortName(unassignedMenus[i].name);
    const item2 = unassignedMenus[i + 1]
      ? shortName(unassignedMenus[i + 1].name)
      : null;
    // 2 つある場合は横に並べる
    lines.push(line(item2 ? `${item1.padEnd(8, " ")}${item2}` : item1, [1, 1]));
  }

  return { type: "flow", lines };
};

/**
 * カップ 1 杯のシール（緊急で入れ直したカップに貼る）。注文で刷るカップのシールと同じ中身で、
 * 「2/3」はその注文の抽出が要るカップの中の順番。1 枚だけ刷るので、何枚目のカップでも先頭へ送る。
 * 注文にそのカップが無ければ null
 */
export const cupLabelJob = (
  order: OrderEntity,
  cupId: string,
): PrintJob | null => {
  const cups = order.getCups().filter((cup) => cup.item_type.needs_brew);
  const index = cups.findIndex((cup) => cup.cupId === cupId);
  if (index < 0) return null;
  return {
    labels: [cupLabel(order.orderId, index + 1, cups.length, cups[index])],
  };
};

/**
 * 注文で刷るシール
 *
 * 抽出が要るもの 1 杯ごとにカップに貼るシールを刷り、最後に引換券に貼るシールを 1 枚刷る。
 * 先頭へ送るのは 1 枚目のカップだけで、2 枚目以降のカップは前のシールの続きから刷る（continued）。
 */
export const orderLabelJob = (order: OrderEntity): PrintJob => {
  const cups = order.getCoffeeCups();
  return {
    labels: [
      ...cups.map((item, idx) => {
        const label = cupLabel(order.orderId, idx + 1, cups.length, item);
        return idx === 0 ? label : { ...label, continued: true };
      }),
      summaryLabel(order),
    ],
  };
};
