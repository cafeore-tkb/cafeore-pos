import { assignmentLabelText } from "../models/dripper";
import type { OrderEntity } from "../models/order";

// ラベル（シール）の中身を作る。レジの会計のラベルも、緊急のシールも、ここで作ったものを印刷する
// （services/pos の label/print-util.ts が、これをプリンターの命令にする）。
// 同じ注文からは、いつ作っても同じ中身になるので、緊急で印刷し直すシールは本物と全く同じになる。

/** カップに貼るシール 1 枚（注文番号・商品名・何杯目/全部で何杯・指名） */
export type CupLabel = {
  type: "cup";
  /** サーバーが作ったカップの ID。カップを持たない注文（保存前など）は undefined */
  cupId: string | undefined;
  orderNo: number;
  name: string;
  /** 何杯目か（1 始まり） */
  index: number;
  /** シールのあるカップが全部で何杯か */
  total: number;
  /** 指名（自由記述があればその文、無ければ "1st" など）。指名なしは null */
  assignment: string | null;
};

/** 引換券に貼るシール（注文番号・金額・指名のある明細・残りの明細の名前） */
export type OrderSummaryLabel = {
  type: "summary";
  orderNo: number;
  total: number;
  assigned: { name: string; assignment: string }[];
  /** 指名の無い明細の名前を 2 つずつ横に並べた行 */
  lines: string[];
};

/** 緊急の目印のシール（「緊急」とだけ書く）。本物と同じシールの前に 1 枚出す */
export type EmergencyMarkLabel = { type: "emergency" };

export type Label = CupLabel | OrderSummaryLabel | EmergencyMarkLabel;

/**
 * シールを印刷するカップの種類か。アイスミルク（milk）とグッズ（others）にはシールが無い
 * （OrderEntity.getCoffeeCups と同じ決まり。サーバーの isLabelCup も同じ）
 */
export const isLabelItemType = (itemTypeName: string): boolean =>
  itemTypeName !== "milk" && itemTypeName !== "others";

/**
 * 注文のカップごとのシール。注文した順（サーバーのカップの並び）に、シールのあるカップだけを数える。
 * カップを持たない注文は、getCoffeeCups と同じ展開になる
 */
export const orderCupLabels = (order: OrderEntity): CupLabel[] => {
  const cups = order
    .getCups()
    .filter((cup) => isLabelItemType(cup.item_type.name));
  return cups.map((cup, i) => ({
    type: "cup",
    cupId: cup.cupId,
    orderNo: order.orderId,
    name: cup.name,
    index: i + 1,
    total: cups.length,
    assignment: assignmentLabelText(cup),
  }));
};

// アイテム名が8文字以上のときは6文字だけ取り出す
// 俺ブレが正式名称だと入らない、ブレンで切りたくないため
const shortName = (name: string) => (name.length < 8 ? name : name.slice(0, 6));

/** 引換券に貼るシール */
export const orderSummaryLabel = (order: OrderEntity): OrderSummaryLabel => {
  const assigned = order.menus.flatMap((menu) => {
    const assignment = assignmentLabelText(menu);
    return assignment === null ? [] : [{ name: menu.name, assignment }];
  });
  const unassigned = order.menus.filter(
    (menu) => assignmentLabelText(menu) === null,
  );
  const lines: string[] = [];
  for (let i = 0; i < unassigned.length; i += 2) {
    const item1 = shortName(unassigned[i].name);
    const item2 = unassigned[i + 1] ? shortName(unassigned[i + 1].name) : null;
    // 2つある場合は横に並べる
    lines.push(item2 ? `${item1.padEnd(8, " ")}${item2}` : item1);
  }
  return {
    type: "summary",
    orderNo: order.orderId,
    total: order.total,
    assigned,
    lines,
  };
};

/** レジの会計で印刷するラベル：カップごとのシールを順に、最後に引換券に貼るシール */
export const orderLabels = (order: OrderEntity): Label[] => [
  ...orderCupLabels(order),
  orderSummaryLabel(order),
];

/**
 * 緊急の印刷：「緊急」のシール → そのカップの本物と全く同じシール。
 * シールの無いカップ・その注文に無いカップは null
 */
export const emergencyLabels = (
  order: OrderEntity,
  cupId: string,
): Label[] | null => {
  const label = orderCupLabels(order).find((l) => l.cupId === cupId);
  return label ? [{ type: "emergency" }, label] : null;
};

/** 印刷キューの仕事 1 件で印刷するシール。作れなければ null（カップが無いなど） */
export const printJobLabels = (
  job: { kind: "order" | "emergency"; cupId: string | null },
  order: OrderEntity,
): Label[] | null => {
  if (job.kind === "order") return orderLabels(order);
  return job.cupId ? emergencyLabels(order, job.cupId) : null;
};
