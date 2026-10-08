import { caosClockLabel } from "@cafeore/common";
import type React from "react";
import type { NextAvailable } from "../utils/orderQueue";

// 「次に空く」ドリッパー（管制盤 A の未割当の見出し・管制盤 C のドリッパーの見出し）
export const NextAvailableChips: React.FC<{ nextAvailable: NextAvailable }> = ({
  nextAvailable,
}) => (
  <div className="ml-1 flex min-w-0 items-center gap-1 font-bold text-[10px] text-slate-500">
    <span className="shrink-0">次に空く:</span>
    {nextAvailable.map((item, index) => (
      <span
        key={item.bayNumber}
        className={`shrink-0 whitespace-nowrap rounded border px-1.5 py-0.5 font-mono ${index === 0 ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-slate-300 bg-white text-slate-700"}`}
      >
        #{item.bayNumber}{" "}
        {item.isStandby ? "待機" : caosClockLabel(item.seconds)}
      </span>
    ))}
  </div>
);
