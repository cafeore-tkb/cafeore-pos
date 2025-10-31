import { Button } from "../ui/button";

type Props = {
  active: boolean;
  disabled?: boolean;
  onServiceDiscountOrder: () => void;
  onDiscountOrderRemoved: () => void;
};

/**
 * 割引券なしでサービス割引を適用するコンポーネント
 */
export const ServiceDiscountButton = ({
  active,
  disabled,
  onServiceDiscountOrder,
  onDiscountOrderRemoved,
}: Props) => {
  const handleClick = () => {
    if (disabled) return;
    active ? onDiscountOrderRemoved() : onServiceDiscountOrder();
  };

  return (
    <div className="mt-5 border-t-4 pt-4">
      <p className="pb-1">特殊な割引</p>
      <div className="flex flex-col items-center p-6">
        <Button
          variant={active ? "destructive" : "default"}
          className="h-auto whitespace-pre-line px-4 py-2 text-center text-xl"
          onClick={handleClick}
          disabled={disabled}
        >
          {active ? "特殊な割引\nを解除" : "特殊な割引\nを適用"}
        </Button>
        <div className="my-2 text-center text-sm text-stone-400">
          今年以外の引換券があるときは1杯分に限り特殊な割引を適用できます。
        </div>
      </div>
    </div>
  );
};
