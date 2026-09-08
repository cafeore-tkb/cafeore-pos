import { DRIPPER_COUNT, type OrderEntity, type WithId } from "@cafeore/common";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";

type props = {
  order: WithId<OrderEntity>;
  /** ドリッパー番号 → それを使っているオーダー番号 */
  usedDrippers: Map<number, number>;
  onSelect: (dripper: number | null) => void;
};

/**
 * ドリップに入ったオーダーへドリッパーを割り当てる。
 * 割当済みの番号をもう一度押すと解除する。
 */
export const DripperSelect = ({ order, usedDrippers, onSelect }: props) => {
  const numbers = Array.from({ length: DRIPPER_COUNT }, (_, i) => i + 1);

  return (
    <div className="mt-4">
      <p className="pb-1 text-stone-500 text-xs">ドリッパー</p>
      <div className="flex flex-wrap gap-2">
        {numbers.map((n) => {
          const holder = usedDrippers.get(n);
          const isMine = order.dripper === n;
          const isTaken = holder !== undefined && !isMine;

          return (
            <Button
              key={n}
              type="button"
              disabled={isTaken}
              onClick={() => onSelect(isMine ? null : n)}
              className={cn(
                "h-10 w-10 p-0 text-base",
                isMine
                  ? "bg-theme-primary hover:bg-theme-primary/90"
                  : "bg-stone-200 text-stone-600 hover:bg-stone-300",
              )}
              title={isTaken ? `No.${holder} が使用中` : undefined}
            >
              {n}
            </Button>
          );
        })}
      </div>
    </div>
  );
};
