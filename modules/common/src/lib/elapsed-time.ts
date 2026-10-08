// 注文からの経過時間。dayjs(差分).minute() のように時刻として扱うと60分で0分に戻るので、秒の数で持つ。
// 分と秒に分けて出すのは画面の側（services/pos/app/lib/minSec.ts）。

/** この秒数（15分）以上たった注文を遅れとして目立たせる */
export const OVERDUE_SECONDS = 15 * 60;

/** from から to までの秒数（切り捨て。to が from より前なら 0） */
export const elapsedSeconds = (from: Date, to: Date): number =>
  Math.max(0, Math.floor((to.getTime() - from.getTime()) / 1000));

/** 注文を受けてからの秒数。提供済みなら提供まで、まだなら now まで */
export const orderElapsedSeconds = (
  order: { createdAt: Date; servedAt: Date | null },
  now: Date = new Date(),
): number => elapsedSeconds(order.createdAt, order.servedAt ?? now);
