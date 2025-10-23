import type { OrderEntity, WithId } from "@cafeore/common";
import { FaCheck } from "react-icons/fa";
import { Button } from "../ui/button";

type props = {
  order: WithId<OrderEntity>;
  onServe: (order: OrderEntity) => void;
};

export const ServeCheck = ({ order, onServe }: props) => {
  return (
    <Button
      onClick={() => onServe(order)}
      className="flex h-16 w-20 flex-col items-center bg-green-600 hover:bg-green-200"
    >
      <FaCheck className="h-7 w-7 fill-white" strokeWidth={1.5} />
      <span className="text-white text-xs">提供</span>
    </Button>
  );
};
