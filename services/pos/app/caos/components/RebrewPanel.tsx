import { AlertTriangle, X } from "lucide-react";
import type React from "react";
import { useState } from "react";
import type { OrderTicket } from "../types";

// 緊急（入れ直し）の設定。決めるのは「どのカップを入れ直すか」と「抽出中なら中断するか」だけ。
// 入れ直しのカードは未割当のいちばん上に出るので、担当の列はそこから割り当てる。

export interface RebrewCup {
  id: string;
  label: string;
  /** もう緊急にしたカップ（2 回は緊急にしない） */
  disabled: boolean;
}

export interface RebrewDecision {
  cupIds: string[];
  interruptCurrent: boolean;
}

interface RebrewPanelProps {
  ticket: OrderTicket;
  cups: RebrewCup[];
  onClose: () => void;
  onConfirm: (decision: RebrewDecision) => void;
}

export const RebrewPanel: React.FC<RebrewPanelProps> = ({
  ticket,
  cups,
  onClose,
  onConfirm,
}) => {
  const isBrewing = ticket.status === "brewing";
  const [interruptCurrent, setInterruptCurrent] = useState(isBrewing);
  const selectable = cups.filter((cup) => !cup.disabled);
  const [picked, setPicked] = useState<string[]>(
    selectable.slice(0, 1).map((cup) => cup.id),
  );
  // 中断すると、そのカードのカップは全部入れ直す
  const interrupting = interruptCurrent && isBrewing;
  const cupIds = interrupting ? selectable.map((cup) => cup.id) : picked;

  const toggle = (id: string) =>
    setPicked((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );

  return (
    <aside
      className="context-sheet absolute top-[56px] right-0 bottom-0 z-[150] flex w-[min(460px,46vw)] min-w-[390px] flex-col border-red-200 border-l bg-white shadow-2xl"
      aria-label="緊急入れ直し設定"
    >
      <div className="flex h-[60px] shrink-0 items-center gap-3 border-red-200 border-b bg-red-50 px-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-600 text-white">
          <AlertTriangle className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-black text-[12px] text-red-700">
            緊急の入れ直し
          </div>
          <div className="flex items-baseline gap-2">
            <span className="font-black font-mono text-[23px] text-red-700">
              {ticket.id}
            </span>
            <span className="truncate font-black text-[15px]">
              {ticket.beanName}
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex h-11 w-11 touch-manipulation items-center justify-center rounded-full hover:bg-red-100"
          aria-label="閉じる"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {isBrewing && (
          <section>
            <h3 className="mb-2 font-black text-[13px] text-slate-600">
              現在の抽出
            </h3>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setInterruptCurrent(true)}
                className={`min-h-[52px] touch-manipulation rounded-xl border-2 font-black text-[14px] ${interruptCurrent ? "border-red-600 bg-red-50 text-red-700" : "border-slate-200 bg-white text-slate-700"}`}
              >
                今すぐ中断
              </button>
              <button
                type="button"
                onClick={() => setInterruptCurrent(false)}
                className={`min-h-[52px] touch-manipulation rounded-xl border-2 font-black text-[14px] ${!interruptCurrent ? "border-blue-600 bg-blue-50 text-blue-800" : "border-slate-200 bg-white text-slate-700"}`}
              >
                抽出は続ける
              </button>
            </div>
          </section>
        )}

        <section>
          <h3 className="mb-2 font-black text-[13px] text-slate-600">
            入れ直すカップ
          </h3>
          <div className="grid grid-cols-2 gap-2">
            {cups.map((cup) => {
              const on = cupIds.includes(cup.id);
              return (
                <button
                  key={cup.id}
                  type="button"
                  disabled={cup.disabled || interrupting}
                  onClick={() => toggle(cup.id)}
                  className={`min-h-[50px] touch-manipulation rounded-xl border-2 px-2 font-black text-[15px] disabled:opacity-60 ${on ? "border-red-600 bg-red-50 text-red-700" : "border-slate-200 bg-white"}`}
                >
                  {cup.label}
                  {cup.disabled && (
                    <span className="ml-1 text-[11px] text-slate-500">
                      緊急済み
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <p className="mt-2 font-bold text-[12px] text-slate-500">
            {interrupting
              ? "中断すると、このカードのカップを全部入れ直します。"
              : "入れ直しのカードは未割当のいちばん上に出ます。そこから列に割り当ててください。"}
          </p>
        </section>
      </div>

      <div className="flex shrink-0 gap-2 border-slate-200 border-t bg-slate-50 p-3">
        <button
          type="button"
          onClick={onClose}
          className="min-h-[50px] touch-manipulation rounded-xl border border-slate-300 bg-white px-5 font-black"
        >
          キャンセル
        </button>
        <button
          type="button"
          disabled={cupIds.length === 0}
          onClick={() => onConfirm({ cupIds, interruptCurrent: interrupting })}
          className="min-h-[50px] flex-1 touch-manipulation rounded-xl bg-red-600 font-black text-[15px] text-white disabled:bg-slate-300"
        >
          緊急にする
        </button>
      </div>
    </aside>
  );
};
