import { useState } from "react";
import { Button } from "../ui/button";

type Props = {
  onServiceDiscountOrder: () => void;
  onDiscountOrderRemoved: () => void;
};

export function ServiceDiscountButton({
  onServiceDiscountOrder,
  onDiscountOrderRemoved,
}: Props) {
  const [active, setActive] = useState(false);

  const handleClick = () => {
    setActive((prev) => {
      const next = !prev;
      if (next) {
        // トグルON → 割引を適用
        onServiceDiscountOrder();
      } else {
        // トグルOFF → 割引を解除
        onDiscountOrderRemoved();
      }
      return next;
    });
  };

  return (
    <Button
      variant={active ? "destructive" : "default"}
      className="h-auto whitespace-pre-line px-4 py-2 text-center text-xl"
      onClick={handleClick}
    >
      {active ? "サービス割引\nを解除" : "サービス割引\nを適用"}
    </Button>
  );
}
