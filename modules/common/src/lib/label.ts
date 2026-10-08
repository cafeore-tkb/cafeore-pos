import type { OrderEntity } from "../models/order";

// ラベル（シール）の中身を作る。レジの会計のラベルも、緊急のシールも、ここで作ったものを印刷する
// （services/pos の label/print-util.ts が、これをプリンターの命令にする）。
// 緊急のシールは「緊急」とだけ書いたシールのあとに、そのカップの本物と全く同じシールを出す（本物には「緊急」と書かない）。

/** カップに貼るシール 1 枚（注文番号・商品名・何杯目/全部で何杯・指名） */
export type CupLabel = {
  type: "cup";
  /** サーバーが作ったカップの ID。保存前の注文（レジの会計）は undefined */
  cupId: string | undefined;
  orderNo: number;
  name: string;
  /** 何杯目か（1 始まり） */
  index: number;
  /** シールのあるカップが全部で何杯か */
  total: number;
  /** 明細の指名（自由記述）。無ければ null */
  assignee: string | null;
};

/** 引換券に貼るシール（注文番号・金額・指名のある明細・残りの明細の名前） */
export type OrderSummaryLabel = {
  type: "summary";
  orderNo: number;
  total: number;
  assigned: { name: string; assignee: string }[];
  /** 指名の無い明細の名前を 2 つずつ横に並べた行 */
  lines: string[];
};

/** 緊急の目印のシール（「緊急」とだけ書く）。本物と同じシールの前に 1 枚出す */
export type EmergencyMarkLabel = { type: "emergency" };

export type Label = CupLabel | OrderSummaryLabel | EmergencyMarkLabel;

/**
 * 注文のカップごとのシール。シールを貼るのは種類の「抽出が要る」が付いたカップ（OrderEntity.getCoffeeCups と同じ）。
 *   - 保存前の注文（レジの会計。サーバーのカップが無い）は getCoffeeCups の展開（明細の順 → 構成品の順 → 数量）
 *   - 保存した注文は、サーバーが注文のときに同じ展開で作ったカップ（cups。注文した順）。あとでメニューの構成が変わっても、
 *     会計のときに印刷したシールと同じになる
 */
export const orderCupLabels = (order: OrderEntity): CupLabel[] => {
  const cups =
    order.cups.length === 0
      ? order.getCoffeeCups().map((item) => ({
          cupId: undefined,
          name: item.name,
          assignee: item.assignee,
        }))
      : order.cups
          .filter((cup) => cup.item.item_type.needs_brew)
          .map((cup) => ({
            cupId: cup.id,
            name: cup.item.name,
            assignee:
              order.menus.find((menu) => menu.orderMenuId === cup.orderMenuId)
                ?.assignee ?? null,
          }));
  return cups.map((cup, i) => ({
    type: "cup",
    ...cup,
    orderNo: order.orderId,
    index: i + 1,
    total: cups.length,
  }));
};

// アイテム名が8文字以上のときは6文字だけ取り出す
// 俺ブレが正式名称だと入らない、ブレンで切りたくないため
const shortName = (name: string) => (name.length < 8 ? name : name.slice(0, 6));

/** 引換券に貼るシール */
export const orderSummaryLabel = (order: OrderEntity): OrderSummaryLabel => {
  const assigned = order.menus.flatMap((menu) =>
    menu.assignee === null
      ? []
      : [{ name: menu.name, assignee: menu.assignee }],
  );
  const unassigned = order.menus.filter((menu) => menu.assignee === null);
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
 * 緊急のシール：「緊急」のシール → そのカップの本物と全く同じシール。
 * シールの無いカップ・その注文に無いカップは null
 */
export const emergencyLabels = (
  order: OrderEntity,
  cupId: string,
): Label[] | null => {
  const label = orderCupLabels(order).find((l) => l.cupId === cupId);
  return label ? [{ type: "emergency" }, label] : null;
};

/** まだ緊急のシールを印刷していないカップ（緊急にしてあり、印刷した時刻が空）。注文の順 */
export const pendingEmergencyLabels = <T extends OrderEntity>(
  orders: readonly T[],
): { order: T; cupId: string }[] =>
  orders.flatMap((order) =>
    order.cups
      .filter(
        (cup) =>
          (cup.emergencyAt ?? null) !== null &&
          (cup.emergencyPrintedAt ?? null) === null,
      )
      .map((cup) => ({ order, cupId: cup.id })),
  );
