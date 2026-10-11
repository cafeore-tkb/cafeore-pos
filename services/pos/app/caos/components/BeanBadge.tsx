import type React from "react";
import type { CardBean } from "../types";

// カードの豆と区分。豆は POS の在庫対象の名前、区分は商品の種類の表示名をそのまま出す（例「ケニア豆 / ホット」）。
// どちらも分からないカード（実データテスト）には出さない。狭いカードでは後ろが切れるので豆を先にする。
export const BeanBadge: React.FC<{
  card: { beans?: CardBean[]; typeName?: string };
  className?: string;
}> = ({ card, className = "" }) => {
  const beans = (card.beans ?? []).map((bean) => bean.name).join("・");
  const label = [beans, card.typeName].filter(Boolean).join(" / ");
  if (!label) return null;
  return (
    <span
      title={`豆：${beans || "なし"}　区分：${card.typeName ?? "なし"}`}
      className={`min-w-0 shrink truncate rounded bg-black/10 px-1.5 py-0.5 font-bold text-[10px] leading-none ${className}`}
    >
      {label}
    </span>
  );
};
