import { Sliders, Zap } from "lucide-react";
import type React from "react";
import type { LearningEngineLog } from "../types";

interface AiLearningEnginePanelProps {
  logs: LearningEngineLog[];
  onTriggerRecalibration: () => void;
}

export const AiLearningEnginePanel: React.FC<AiLearningEnginePanelProps> = ({
  logs,
  onTriggerRecalibration,
}) => {
  return (
    <div className="flex w-full shrink-0 flex-col justify-between rounded-lg border border-[#cbd5e1] bg-white p-3 shadow-xs lg:w-[420px]">
      {/* Header */}
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sliders className="h-4 w-4 text-[#16a34a]" />
          <h2 className="font-bold text-[#0f172a] text-[14px] tracking-tight">
            抽出タイム自動学習エンジン
          </h2>
        </div>
        <button
          onClick={onTriggerRecalibration}
          className="flex cursor-pointer items-center gap-1 font-semibold text-[10px] text-blue-600 hover:text-blue-800 hover:underline"
          title="実績データをもとに係数を再計算"
        >
          <Zap className="h-3 w-3 text-amber-500" />
          <span>即時補正</span>
        </button>
      </div>

      {/* Rows Container */}
      <div className="flex flex-1 flex-col justify-center gap-1.5">
        {logs.map((log) => {
          let statusColor = "text-[#16a34a] font-bold";
          if (log.coefficientStatus.includes("連動")) {
            statusColor = "text-[#d97706] font-bold";
          } else if (log.coefficientStatus.includes("最速")) {
            statusColor = "text-[#0284c7] font-bold";
          }

          let deltaColor = "text-[#16a34a]";
          if (log.deltaType === "slower") {
            deltaColor = "text-[#ea580c]";
          }

          return (
            <div
              key={log.id}
              className="flex items-center justify-between rounded border border-[#dbeafe] bg-[#f0f7ff] px-3 py-2 font-medium text-[12px]"
            >
              {/* Left: Barista & recent performance */}
              <div className="flex items-center gap-2">
                <span className="font-bold text-slate-900">
                  {log.baristaKey}:
                </span>
                <span className="text-slate-600">直近実績</span>
                <span className="font-bold font-mono text-slate-800">
                  {log.recentActual}
                </span>
                <span
                  className={`font-bold font-mono text-[11px] ${deltaColor}`}
                >
                  {log.deltaStr}
                </span>
              </div>

              {/* Right: AI Coefficient status */}
              <div className="flex shrink-0 items-center gap-1">
                <span className={`font-mono text-[11px] ${statusColor}`}>
                  {log.coefficientStatus}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
