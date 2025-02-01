import { useMemo } from "react";
import { Input } from "../ui/input";
import { OrderEntity } from "@cafeore/common";

type props = {
  order: OrderEntity;
};

/**
 * おつりの表示をするコンポーネント
 * @param props
 * @returns
 */
const ChargeView = ({ order }: props) => {
  const chargeView: string | number = useMemo(() => {
    const charge = order.getCharge();
    if (charge < 0) {
      return "不足しています";
    }
    return charge;
  }, [order]);

  return <Input disabled value={chargeView} />;
};

export { ChargeView };
