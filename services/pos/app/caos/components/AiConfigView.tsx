import { RefreshCw, Sparkles, Zap } from "lucide-react";
import type React from "react";
import type { Barista, LearningEngineLog } from "../types";

interface AiConfigViewProps {
  baristas: Barista[];
  logs: LearningEngineLog[];
  onUpdateCoefficient: (baristaId: number, newCoef: number) => void;
  onResetLearning: () => void;
}

export const AiConfigView: React.FC<AiConfigViewProps> = ({
  baristas,
  logs,
  onUpdateCoefficient,
  onResetLearning,
}) => {
  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 border-slate-200 border-b pb-3">
        <div>
          <h2 className="flex items-center gap-2 font-black text-[16px] text-slate-900 tracking-tight">
            <Sparkles className="h-5 w-5 text-emerald-600" />
            <span>抽出時間の補正</span>
          </h2>
          <p className="mt-0.5 text-slate-500 text-xs">
            ドリッパーごとの所要時間係数
          </p>
        </div>

        <button
          onClick={onResetLearning}
          className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-semibold text-slate-700 text-xs transition-colors hover:bg-slate-50"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          <span>学習パラメータ初期化</span>
        </button>
      </div>

      {/* Barista Coefficients Grid */}
      <div className="grid grid-cols-1 gap-2">
        {baristas.map((b) => (
          <div
            key={b.id}
            className="space-y-2 rounded-xl border border-slate-300 bg-white p-3 shadow-xs"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded bg-slate-900 font-bold font-mono text-sm text-white">
                  {b.id}
                </div>
                <div>
                  <h3 className="font-bold text-slate-900">
                    {b.name} バリスタ
                  </h3>
                  <span className="text-[10px] text-slate-500">
                    ドリッパー {b.bayNumber}
                  </span>
                </div>
              </div>
            </div>

            {/* Slider to adjust coefficient */}
            <div>
              <div className="mb-1 flex items-center justify-between text-slate-600 text-xs">
                <span>速度補正係数 (0.80x 〜 1.30x):</span>
                <span className="font-semibold text-slate-900">
                  {b.coefficient < 1.0
                    ? "高速抽出タイプ"
                    : b.coefficient === 1.0
                      ? "標準ペース"
                      : "丁寧・大容量タイプ"}
                </span>
              </div>
              <input
                type="range"
                min="0.80"
                max="1.30"
                step="0.01"
                value={b.coefficient}
                onChange={(e) =>
                  onUpdateCoefficient(b.id, Number.parseFloat(e.target.value))
                }
                className="w-full cursor-pointer accent-slate-900"
              />
              <div className="flex justify-between font-mono text-[10px] text-slate-400">
                <span>0.80 (高速)</span>
                <span>1.00 (標準)</span>
                <span>1.30 (長時間)</span>
              </div>
            </div>

            <div className="space-y-1 rounded-lg bg-slate-50 p-2.5 text-xs">
              <div className="flex justify-between text-slate-600">
                <span>標準予測 2分30秒 の場合:</span>
                <span className="font-bold font-mono text-slate-900">
                  {Math.floor((150 * b.coefficient) / 60)}分
                  {Math.round((150 * b.coefficient) % 60)}秒
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Real-time Learning Logs */}
      <div className="rounded-xl border border-slate-300 bg-white p-4 shadow-xs">
        <h3 className="mb-3 flex items-center gap-2 font-bold text-slate-900 text-sm">
          <Zap className="h-4 w-4 text-amber-500" />
          <span>最新の自動補正ログ (直近5件)</span>
        </h3>
        <div className="divide-y divide-slate-100 text-xs">
          {logs.map((log) => (
            <div
              key={log.id}
              className="flex flex-col items-start gap-1.5 py-2.5"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[11px] text-slate-400">
                  {log.timestamp}
                </span>
                <span className="font-bold text-slate-900">
                  {log.baristaKey}
                </span>
                <span className="text-slate-600">
                  直近実績:{" "}
                  <strong className="font-mono">{log.recentActual}</strong>
                </span>
                <span
                  className={`font-bold font-mono ${log.deltaType === "slower" ? "text-amber-600" : "text-emerald-600"}`}
                >
                  {log.deltaStr}
                </span>
              </div>
              <span className="rounded border border-blue-200 bg-blue-50 px-2 py-0.5 font-bold font-mono text-blue-700">
                {log.coefficientStatus}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
