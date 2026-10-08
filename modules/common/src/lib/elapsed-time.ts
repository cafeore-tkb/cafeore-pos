// 注文からの経過時間の計算と表示。
// dayjs(差分).minute() のように時刻として扱うと60分で0分に戻るので、差分のミリ秒から分・秒を出す。

/** この分数以上たった注文を遅れとして目立たせる */
export const OVERDUE_MINUTES = 15;

export type ElapsedTime = {
  /** 経過した秒数（切り捨て。終わりが始まりより前なら 0） */
  totalSeconds: number;
  /** 分（60 で一周しない） */
  minutes: number;
  /** 秒（0〜59） */
  seconds: number;
  /** 秒を2桁にした文字列（"07"）。「92:07」「92分07秒」のように出すとき用 */
  ss: string;
  /** OVERDUE_MINUTES 分以上たったか */
  overdue: boolean;
};

export const elapsedTime = (from: Date, to: Date): ElapsedTime => {
  const ms = Math.max(0, to.getTime() - from.getTime());
  const totalSeconds = Math.floor(ms / 1000);
  return {
    totalSeconds,
    minutes: Math.floor(totalSeconds / 60),
    seconds: totalSeconds % 60,
    ss: String(totalSeconds % 60).padStart(2, "0"),
    overdue: ms >= OVERDUE_MINUTES * 60 * 1000,
  };
};

/**
 * 注文を受けてからの経過時間。提供済みなら提供までの時間、まだなら now までの時間
 */
export const orderElapsedTime = (
  order: { createdAt: Date; servedAt: Date | null },
  now: Date = new Date(),
): ElapsedTime => elapsedTime(order.createdAt, order.servedAt ?? now);
