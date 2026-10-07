import type React from "react";
import type { Barista } from "../types";
import { laneOrdinal } from "../utils/lanes";

// ドリッパーのタブ：6 列（1st〜6th）の今の抽出と待ちの件数。
// 列の担当者は CaOS では作らない（あとでサーバーの盤面と sohosai-shift の予定から出す）。

interface BaysOverviewViewProps {
  baristas: Barista[];
}

export const BaysOverviewView: React.FC<BaysOverviewViewProps> = ({
  baristas,
}) => (
  <div className="space-y-3">
    <div className="grid grid-cols-2 gap-2">
      {[...baristas]
        .sort((a, b) => a.bayNumber - b.bayNumber)
        .map((barista) => {
          const current = barista.queue[0];
          return (
            <article
              key={barista.id}
              className="rounded-xl border border-slate-300 bg-white p-3 shadow-xs"
            >
              <div className="flex items-center gap-2">
                <div className="flex h-8 min-w-10 shrink-0 items-center justify-center rounded-lg border border-slate-300 bg-slate-100 px-1 font-bold font-mono text-[13px] text-slate-600">
                  {laneOrdinal(barista.bayNumber)}
                </div>
              </div>
              <div className="mt-2 border-slate-100 border-t pt-2 text-[12px]">
                {current ? (
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-bold text-slate-700">
                      {current.beanName}
                    </span>
                    <span className="shrink-0 font-black font-mono text-[15px] text-slate-950">
                      {current.id}
                    </span>
                  </div>
                ) : (
                  <span className="font-bold text-slate-400">待機中</span>
                )}
                <div className="mt-1 font-bold text-[11px] text-slate-500">
                  待ち {Math.max(0, barista.queue.length - 1)}件
                </div>
              </div>
            </article>
          );
        })}
    </div>
  </div>
);
