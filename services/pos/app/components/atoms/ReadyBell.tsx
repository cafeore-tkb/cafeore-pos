import type { OrderEntity, WithId } from "@cafeore/common";
import { HiBell, HiBellAlert } from "react-icons/hi2";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";

type props = {
  order: WithId<OrderEntity>;
  changeReady: (ready: boolean) => void;
};

export const ReadyBell = ({ order, changeReady }: props) => {
  const isReady = order.readyAt != null;
  return (
    <Button
      type="button"
      onClick={() => changeReady(!isReady)}
      className="items-cente flex h-16 w-20 flex-col bg-stone-200 hover:bg-orange-200"
    >
      {isReady ? (
        <HiBellAlert className="h-7 w-7 rotate-12 fill-orange-600" />
      ) : (
        <HiBell className="h-7 w-7 fill-stone-500" />
      )}
      <span
        className={cn(
          "text-xs",
          isReady ? "text-orange-600" : "text-stone-500",
        )}
      >
        {isReady ? "呼び出し中" : "呼び出し"}
      </span>
    </Button>
  );
};
