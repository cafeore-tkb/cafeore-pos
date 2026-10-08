import { KeyRound, TriangleAlert } from "lucide-react";
import type React from "react";
import { useCaosLanes } from "./CaosLanesContext";

// ヘッダーに出す担当者のこと：どのドリッパーにも上級生がいなければ知らせる（限定のカードをどこにも置けない）。
// 操作の画面では、この端末の sohosai-shift の合言葉の設定も開ける。

export const LaneHeaderStatus: React.FC = () => {
  const { hasSenior, editable, openSettings, shiftFeed } = useCaosLanes();
  return (
    <>
      {!hasSenior && (
        <div
          role="status"
          data-no-senior
          title="限定のカードは上級生のドリッパーにしか置けません。各ドリッパーの「交代」で上級生を入れてください"
          className="flex min-h-[44px] items-center gap-1 rounded-lg border border-amber-300 bg-amber-50 px-2 font-black text-[11px] text-amber-900 leading-tight"
        >
          <TriangleAlert className="h-4 w-4 shrink-0" />
          {/* 幅が狭いと短く出す（ヘッダーに余裕が無いので） */}
          <span className="whitespace-nowrap 2xl:hidden">上級生なし</span>
          <span className="hidden whitespace-nowrap 2xl:inline">
            上級生がいません（限定を置けません）
          </span>
        </div>
      )}
      {editable && (
        <button
          type="button"
          onClick={openSettings}
          title="sohosai-shift の合言葉（この端末の設定）"
          aria-label="sohosai-shift の合言葉"
          className={`flex h-11 w-11 touch-manipulation items-center justify-center rounded-lg border ${shiftFeed.feedKey ? (shiftFeed.error ? "border-red-200 bg-red-50 text-red-600" : "border-[#cbd5e1] bg-[#f1f5f9] text-slate-700") : "border-slate-300 border-dashed bg-white text-slate-400"}`}
        >
          <KeyRound className="h-4 w-4" />
        </button>
      )}
    </>
  );
};
