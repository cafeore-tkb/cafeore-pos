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
      className={cn(
        "items-cente flex h-16 w-20 flex-col hover:bg-orange-200",
        isReady ? "bg-stone-200" : "bg-orange-600",
      )}
    >
      {isReady ? (
        <HiBellAlert className="h-7 w-7 rotate-12 fill-orange-600" />
      ) : (
        <HiBell className="h-7 w-7 fill-white" />
      )}
      <span
        className={cn("text-xs", isReady ? "text-orange-600" : "text-white")}
      >
        {isReady ? "呼び出し中" : "呼び出す"}
      </span>
    </Button>
  );
};
