import type { OrderEntity } from "@cafeore/common";
import { useMemo } from "react";
import { currentStack, predictReadyMinutes } from "~/lib/readyTimeEstimate";
import { useCurrentTime } from "../functional/useCurrentTime";

type Props = {
  /** 受け付けた注文。入力中の注文は含めない */
  orders: OrderEntity[] | undefined;
  /** 入力中の注文のドリンク杯数。0 杯（物販だけ・空）なら出さない */
  drinkCups: number;
};

/**
 * 入力中の注文が提供可能になるまでの予測時間。お客さんに口頭で伝えるために出す。
 *
 * いま提供可能になっていないドリンクの杯数（stack）だけから予測する。
 * 誤差が 1 分より大きいので、1 分単位に丸めて「約 N 分」と出す。
 */
const ReadyTimeEstimate = ({ orders, drinkCups }: Props) => {
  // 日付が変わったら前の日の注文を数えないように、時刻もときどき更新する
  const now = useCurrentTime(30_000);
  const stack = useMemo(
    () => (orders ? currentStack(orders, now) : null),
    [orders, now],
  );

  if (stack === null || drinkCups === 0) {
    return null;
  }
  const minutes = Math.round(predictReadyMinutes(stack));

  return (
    <div
      className="flex items-baseline gap-1.5"
      title="まだ提供可能になっていないドリンクの杯数から予測しています"
    >
      <span className="text-[13px] text-stone-500">提供まで</span>
      <span className="font-bold text-xl">約 {minutes} 分</span>
      <span className="text-[13px] text-stone-500">待ち {stack} 杯</span>
    </div>
  );
};

export { ReadyTimeEstimate };
