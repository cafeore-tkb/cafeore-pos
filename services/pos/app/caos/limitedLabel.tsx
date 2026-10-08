import { useItemMaster } from "@cafeore/common";
import { createContext, useContext } from "react";

// 限定（SP）を表す名前。POS の API の商品の種類（limited）の表示名をそのまま使う。
// コードに「限定」「SP」のような呼び方を持たないために使う。読み込み前や種類が無いときは空。
const LimitedLabelContext = createContext("");

export const LimitedLabelProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const { itemTypes } = useItemMaster();
  const label =
    itemTypes.find((itemType) => itemType.name === "limited")?.display_name ??
    "";
  return (
    <LimitedLabelContext.Provider value={label}>
      {children}
    </LimitedLabelContext.Provider>
  );
};

export const useLimitedLabel = () => useContext(LimitedLabelContext);
