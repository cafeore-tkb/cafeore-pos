import { Coffee } from "lucide-react";
import type React from "react";

// 豆キュー。豆の在庫は CaOS では作らず、あとで POS の在庫（/inventory）をそのまま出す。
// それまでは何も出さない（端末だけの架空の在庫や、1杯ごとの減算はしない）。

export const BeanQueueView: React.FC = () => (
  <div className="space-y-3">
    <h2 className="flex items-center gap-2 font-black text-[16px] text-slate-900 tracking-tight">
      <Coffee className="h-5 w-5 text-[#006c4a]" />
      <span>豆キュー</span>
    </h2>
    <p className="rounded-xl border border-slate-300 border-dashed bg-slate-50 p-4 font-bold text-[13px] text-slate-500 leading-relaxed">
      豆の在庫は、あとで POS の在庫から出します。
    </p>
  </div>
);
