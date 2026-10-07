import { Star } from "lucide-react";
import type React from "react";
import { useLimitedLabel } from "../limitedLabel";
import type { Barista } from "../types";

// 列の担当者の名前と、上級生（限定を淹れられる人）の印（POS の API の限定の種類の表示名）。
// 担当者がいない列は何も出さない（列は番号「1st」〜「6th」だけで呼ぶ）。

export const SeniorMark: React.FC<{ className?: string }> = ({
  className = "",
}) => {
  const limitedLabel = useLimitedLabel();
  if (!limitedLabel) return null;
  return (
    <span
      title="上級生（限定を淹れられる）"
      className={`inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap rounded bg-emerald-950 px-1.5 py-0.5 font-black text-[9px] text-emerald-100 ${className}`}
    >
      <Star className="h-2.5 w-2.5 fill-current" />
      {limitedLabel}
    </span>
  );
};

export const LaneName: React.FC<{
  barista: Pick<Barista, "name" | "senior">;
  className?: string;
}> = ({ barista, className = "" }) => {
  if (!barista.name) return null;
  return (
    <span className={`inline-flex min-w-0 items-center gap-1 ${className}`}>
      <span className="truncate">{barista.name}</span>
      {barista.senior && <SeniorMark />}
    </span>
  );
};
