import { useItemMaster } from "@cafeore/common";
import { useMemo } from "react";

// 商品の種類の表示名（種類の name → display_name）。POS の商品の種類（API）から引く
export const useItemTypeNames = () => {
  const { itemTypes } = useItemMaster();
  return useMemo(
    () =>
      new Map(
        itemTypes.map((itemType) => [itemType.name, itemType.display_name]),
      ),
    [itemTypes],
  );
};
