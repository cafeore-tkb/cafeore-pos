import type { OrderEntity, WithId } from "@cafeore/common";
import { HiCheck } from "react-icons/hi2";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";

type props = {
  order: WithId<OrderEntity>;
  onServe: (order: OrderEntity) => void;
};

export const ServeCheck = ({ order, onServe }: props) => {
  return (
    <Button
      onClick={() => onServe(order)}
      className="items-center flex h-16 w-20 flex-col hover:bg-green-200 bg-green-600"
    >
      <HiCheck className="h-7 w-7 fill-white" strokeWidth={3} />
      <span className="text-xs text-white">
        提供
      </span>
    </Button>
  );
};
