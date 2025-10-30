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
    <div className="flex flex-col items-center">
      <Button
        variant={active ? "destructive" : "default"}
        className="h-auto whitespace-pre-line px-4 py-2 text-center text-xl"
        onClick={handleClick}
        disabled={disabled}
      >
        {active ? "サービス割引\nを解除" : "サービス割引\nを適用"}
      </Button>
      <div className="my-2 px-10 text-center text-sm text-stone-400">
        過去に出店した際の引換券などがあれば適用できます
      </div>
    </div>
  );
};
