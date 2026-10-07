import type React from "react";
import type { CardBean } from "../types";
import { beanNamesOf } from "../utils/beans";

// カードの豆。POS の在庫対象の名前をそのまま出す。
// 豆が分からないカード（実データテスト、在庫の設定で豆を結んでいない商品）には出さない。
export const BeanBadge: React.FC<{
  beans?: CardBean[];
  className?: string;
}> = ({ beans, className = "" }) => {
  const names = beanNamesOf({ beans });
  if (!names) return null;
  return (
    <span
      title={`豆：${names}`}
      className={`min-w-0 shrink truncate rounded bg-black/10 px-1.5 py-0.5 font-bold text-[10px] leading-none ${className}`}
    >
      {names}
    </span>
  );
};
