import type { OrderEntity, WithId } from "@cafeore/common";
import { FaCheck } from "react-icons/fa";
import { Button } from "../ui/button";

import { cn } from "~/lib/utils";

type props = {
  order: WithId<OrderEntity>;
  // 応答待ち。押しても無視される
  busy: boolean;
  onServe: (order: OrderEntity) => void;
};

export const ServeCheck = ({ order, busy, onServe }: props) => {
  return (
    <Button
      onClick={() => onServe(order)}
      aria-busy={busy}
      className={cn(
        "hover:-translate-y-0.5 flex h-16 w-20 flex-col items-center bg-green-600 transition-all duration-150 hover:bg-green-500 hover:shadow-md active:translate-y-0 active:scale-95",
        busy && "animate-pulse cursor-wait",
      )}
    >
      <FaCheck className="h-7 w-7 fill-white" strokeWidth={1.5} />
      <span className="text-white text-xs">提供</span>
    </Button>
  );
};
