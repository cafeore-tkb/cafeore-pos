import { ArrowRightLeft, Clock3, Star } from "lucide-react";
import type React from "react";
import { useLimitedLabel } from "../limitedLabel";
import type { Barista } from "../types";

interface BaysOverviewViewProps {
  baristas: Barista[];
  nextShiftLabel: string;
  onChangeShift: () => void;
}

export const BaysOverviewView: React.FC<BaysOverviewViewProps> = ({
  baristas,
  nextShiftLabel,
  onChangeShift,
}) => {
  const limitedLabel = useLimitedLabel();
  const specialCount = baristas.filter(
    (barista) => barista.canHandleSpecial,
  ).length;

  return (
    <div className="space-y-3">
      <section className="rounded-xl border border-slate-300 bg-slate-50 p-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-1.5 font-bold text-[12px] text-slate-500">
              <Clock3 className="h-4 w-4" />
              <span>次の交代 {nextShiftLabel}</span>
            </div>
            <div className="mt-1 font-black text-[15px] text-slate-950">
              6人総入替
              {limitedLabel &&
                `・${limitedLabel}を淹れられる人 ${specialCount}人`}
            </div>
          </div>
          <button
            type="button"
            onClick={onChangeShift}
            className="min-h-[44px] shrink-0 touch-manipulation rounded-lg bg-slate-950 px-3 font-black text-[12px] text-white shadow-sm active:scale-[0.98]"
          >
            <span className="flex items-center gap-1.5">
              <ArrowRightLeft className="h-4 w-4" />
              今すぐ交代
            </span>
          </button>
        </div>
      </section>

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
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-300 bg-slate-100 font-bold font-mono text-[14px] text-slate-600">
                    {barista.bayNumber}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <h3 className="truncate font-black text-[16px] text-slate-950">
                        {barista.name}
                      </h3>
                      {barista.canHandleSpecial && limitedLabel && (
                        <span className="inline-flex shrink-0 items-center gap-0.5 rounded bg-emerald-950 px-1.5 py-0.5 font-black text-[10px] text-emerald-100">
                          <Star className="h-2.5 w-2.5 fill-current" />
                          {limitedLabel}
                        </span>
                      )}
                    </div>
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

      <p className="px-1 text-[11px] text-slate-500 leading-relaxed">
        毎正時に自動交代します。
        {limitedLabel &&
          `${limitedLabel}を淹れられる人は1番、次に6番へ優先配置されます。`}
      </p>
    </div>
  );
};
