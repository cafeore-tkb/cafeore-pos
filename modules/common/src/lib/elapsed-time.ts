// 注文からの経過時間。dayjs(差分).minute() のように時刻として扱うと60分で0分に戻るので、差分の秒数から出す。

/** この秒数（15分）以上たった注文を遅れとして目立たせる */
const OVERDUE_SECONDS = 15 * 60;

export type ElapsedTime = {
  /** 分（60で一周しない） */
  m: number;
  /** 秒（0〜59）を2桁にした文字列。92:07 なら "07" */
  ss: string;
  /** 15分以上たったか */
  overdue: boolean;
};

/** from から to までの経過時間（秒は切り捨て。to が from より前なら 0） */
export const elapsedTime = (from: Date, to: Date): ElapsedTime => {
  const seconds = Math.max(
    0,
    Math.floor((to.getTime() - from.getTime()) / 1000),
  );
  return {
    m: Math.floor(seconds / 60),
    ss: String(seconds % 60).padStart(2, "0"),
    overdue: seconds >= OVERDUE_SECONDS,
  };
};

/** 注文を受けてからの経過時間。提供済みなら提供まで、まだなら now まで */
export const orderElapsedTime = (
  order: { createdAt: Date; servedAt: Date | null },
  now: Date = new Date(),
): ElapsedTime => elapsedTime(order.createdAt, order.servedAt ?? now);
