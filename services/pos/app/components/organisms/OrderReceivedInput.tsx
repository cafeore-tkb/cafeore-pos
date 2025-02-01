import type { OrderEntity } from "@cafeore/common";
import { CrossCircledIcon } from "@radix-ui/react-icons";
import { memo, useMemo } from "react";
import { AttractiveInput } from "../molecules/AttractiveInput";

type props = {
  order: OrderEntity;
  onTextSet: (text: string) => void;
  focus: boolean;
  onClick: () => void;
};

const OrderReceivedInput = memo(
  ({ order, onTextSet, focus, onClick }: props) => {
    const charge = useMemo(() => order.getCharge(), [order]);

    return (
      <>
        <div className="">
          <div className="grid grid-cols-6">
            <p className="col-span-5 font-bold text-lg">合計</p>
            <div className="flex items-center justify-end text-right">
              &yen;{order.billingAmount}
            </div>
          </div>
          <hr className="my-3" />
          <div className="grid grid-cols-6">
            <p className="col-span-4 font-bold text-lg">受取金額</p>
            <div className="col-span-2 flex items-center">
              <span className="mr-2">&yen;</span>
              <AttractiveInput
                type="number"
                onTextSet={onTextSet}
                focus={focus}
                onClick={onClick}
              />
            </div>
          </div>
          {charge < 0 && (
            <div className="flex items-center">
              <CrossCircledIcon className="mr-1 h-5 w-5 stroke-red-700" />
              <p className="flex items-center">不足しています</p>
            </div>
          )}
          {charge >= 0 && (
            <>
              <hr className="my-3" />
              <div className="grid grid-cols-6">
                <p className="col-span-5 font-bold text-lg">おつり</p>
                <div className="flex items-center justify-end text-right">
                  &yen;{charge}
                </div>
              </div>
            </>
          )}
        </div>
      </>
    );
  },
);

export { OrderReceivedInput };
