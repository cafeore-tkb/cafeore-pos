import { ArrowRightLeft, UserRoundPen, X } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { useLimitedLabel } from "../limitedLabel";
import type { Barista } from "../types";
import { laneOrdinal } from "../utils/lanes";
import { LaneName } from "./LaneName";

// ドリッパーのタブ：6 列の担当者と今の抽出。各列の「交代」と、2 つの列の担当者の「入れ替え」をここで行う。
// 担当者はサーバーの盤面にあり、全部の iPad でそろう。時刻どおりの自動の交代はしない（人が押したときに替える）。

interface BaysOverviewViewProps {
  baristas: Barista[];
  /** 列の「交代」。無ければ（実データテスト中）出さない */
  onChangeLane?: (bayId: number) => void;
  /** 2 つの列の担当者の入れ替え */
  onSwapLanes?: (bayId: number, otherBayId: number) => void;
}

export const BaysOverviewView: React.FC<BaysOverviewViewProps> = ({
  baristas,
  onChangeLane,
  onSwapLanes,
}) => {
  const limitedLabel = useLimitedLabel();
  const [swapSource, setSwapSource] = useState<number | null>(null);
  const seniorCount = baristas.filter((barista) => barista.senior).length;
  const editable = Boolean(onChangeLane && onSwapLanes);

  return (
    <div className="space-y-3">
      <section className="rounded-xl border border-slate-300 bg-slate-50 p-3">
        {swapSource === null ? (
          <div className="font-black text-[15px] text-slate-950">
            {seniorCount > 0
              ? `上級生（${limitedLabel || "限定"}を淹れられる人）の列 ${seniorCount}`
              : `上級生のいる列がありません（${limitedLabel || "限定"}のカードを割り当てられません）`}
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <div className="font-black text-[15px] text-blue-800">
              {laneOrdinal(swapSource)} と入れ替える列を選んでください
            </div>
            <button
              type="button"
              onClick={() => setSwapSource(null)}
              className="flex min-h-[44px] shrink-0 touch-manipulation items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 font-bold text-[12px] text-slate-700"
            >
              <X className="h-4 w-4" />
              やめる
            </button>
          </div>
        )}
      </section>

      <div className="grid grid-cols-2 gap-2">
        {[...baristas]
          .sort((a, b) => a.bayNumber - b.bayNumber)
          .map((barista) => {
            const current = barista.queue[0];
            const isSwapSource = swapSource === barista.id;
            const isSwapTarget = swapSource !== null && !isSwapSource;
            return (
              <article
                key={barista.id}
                data-lane-card={barista.id}
                className={`rounded-xl border bg-white p-3 shadow-xs ${isSwapSource ? "border-blue-500 ring-2 ring-blue-300" : isSwapTarget ? "border-blue-300" : "border-slate-300"}`}
              >
                <div className="flex items-center gap-2">
                  <div className="flex h-8 min-w-10 shrink-0 items-center justify-center rounded-lg border border-slate-300 bg-slate-100 px-1 font-bold font-mono text-[13px] text-slate-600">
                    {laneOrdinal(barista.bayNumber)}
                  </div>
                  <div className="min-w-0 flex-1">
                    {barista.name ? (
                      <LaneName
                        barista={barista}
                        className="font-black text-[16px] text-slate-950"
                      />
                    ) : (
                      <span className="font-bold text-[13px] text-slate-400">
                        担当者なし
                      </span>
                    )}
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
                {editable && (
                  <div className="mt-2 grid grid-cols-2 gap-1.5">
                    {isSwapTarget ? (
                      <button
                        type="button"
                        data-lane-swap-target={barista.id}
                        onClick={() => {
                          if (swapSource !== null)
                            onSwapLanes?.(swapSource, barista.id);
                          setSwapSource(null);
                        }}
                        className="col-span-2 flex min-h-[44px] touch-manipulation items-center justify-center gap-1 rounded-lg bg-blue-700 font-black text-[12px] text-white active:scale-[0.98]"
                      >
                        <ArrowRightLeft className="h-4 w-4" />
                        ここと入れ替え
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          data-lane-change={barista.id}
                          disabled={isSwapSource}
                          onClick={() => onChangeLane?.(barista.id)}
                          className="flex min-h-[44px] touch-manipulation items-center justify-center gap-1 rounded-lg bg-slate-950 font-black text-[12px] text-white active:scale-[0.98] disabled:bg-slate-300"
                        >
                          <UserRoundPen className="h-4 w-4" />
                          交代
                        </button>
                        <button
                          type="button"
                          data-lane-swap={barista.id}
                          onClick={() =>
                            setSwapSource(isSwapSource ? null : barista.id)
                          }
                          className={`flex min-h-[44px] touch-manipulation items-center justify-center gap-1 rounded-lg border font-black text-[12px] active:scale-[0.98] ${isSwapSource ? "border-blue-500 bg-blue-50 text-blue-800" : "border-slate-300 bg-white text-slate-800"}`}
                        >
                          <ArrowRightLeft className="h-4 w-4" />
                          入れ替え
                        </button>
                      </>
                    )}
                  </div>
                )}
              </article>
            );
          })}
      </div>

      <p className="px-1 text-[11px] text-slate-500 leading-relaxed">
        担当者は時刻どおりには替わりません。替わったら「交代」を押してください（sohosai-shift
        の予定の人が候補に出ます）。2
        つの列の人が入れ替わったときは「入れ替え」で選びます。どちらもほかの
        iPad にすぐ出て、「1つ戻す」で戻せます。
      </p>
    </div>
  );
};
