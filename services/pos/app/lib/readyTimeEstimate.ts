import { type OrderEntity, jstDate } from "@cafeore/common";

/**
 * 提供時間を予測する stack モデルの係数。
 * 雙峰祭2025（11/2〜11/3、978 注文、抽出担当 6 人）の実績で当てはめた値（cafeore_analysis の R/model_svtime.R）。
 */
const STACK_MODEL = {
  /** 平坦部のしきい値（杯） */
  a1: 7.2829,
  /** 傾きの定数部分（分/杯） */
  b1: -0.55405,
  /** 最低提供時間（分）。平坦部の高さと傾きの両方に現れる */
  c1: 5.98696,
  /** 抽出担当の人数。当てはめた体制のまま固定する */
  nStaff: 6,
} as const;

/**
 * stack（未提供のドリンク杯数）から、受付から提供可能（readyAt）になるまでの予測時間（分）を返す。
 * stack が a1 杯までは c1 分で一定、それを超えると 1 杯ごとに b 分ずつ伸びる。
 */
export const predictReadyMinutes = (
  stack: number,
  nStaff: number = STACK_MODEL.nStaff,
): number => {
  const { a1, b1, c1 } = STACK_MODEL;
  const b = b1 + c1 / nStaff;
  return Math.max(b * (stack - a1) + c1, c1);
};

/**
 * いまの stack。今日（日本時間）受けた注文のうち、まだ提供可能になっていない（readyAt が無い）ものの杯数の合計。
 * readyAt は全カップが揃ったときに付く注文単位のものを使う（カップ単位で数えると予測が短めに出る）。
 * 受け取り待ち（readyAt があって servedAt が無い）は数えない。入力中の注文は orders に含めない。
 */
export const currentStack = (orders: OrderEntity[], now: Date): number => {
  const today = jstDate(now.getTime());
  return orders
    .filter(
      (order) =>
        order.readyAt === null &&
        order.createdAt < now &&
        jstDate(order.createdAt.getTime()) === today,
    )
    .reduce((sum, order) => sum + order.getDrinkCups().length, 0);
};
