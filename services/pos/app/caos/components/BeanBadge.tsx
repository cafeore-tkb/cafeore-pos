import type React from "react";
import type { CardBean } from "../types";
import { beanNamesOf } from "../utils/beans";

// カードの区分と豆。区分は POS の商品の種類の表示名（display_name）、豆は在庫対象の名前をそのまま出す。
// どちらも分からないカード（実データテスト）には出さない。豆は在庫の設定で豆を結んでいない商品には出さない。
export const BeanBadge: React.FC<{
  beans?: CardBean[];
  typeName?: string;
  className?: string;
}> = ({ beans, typeName, className = "" }) => {
  const names = beanNamesOf({ beans });
  const label = [typeName, names].filter(Boolean).join(" / ");
  if (!label) return null;
  return (
    <span
      title={[typeName && `区分：${typeName}`, names && `豆：${names}`]
        .filter(Boolean)
        .join("　")}
      className={`min-w-0 shrink truncate rounded bg-black/10 px-1.5 py-0.5 font-bold text-[10px] leading-none ${className}`}
    >
      {label}
    </span>
  );
};
