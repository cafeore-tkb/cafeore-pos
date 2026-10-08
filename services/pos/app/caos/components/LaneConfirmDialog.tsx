import { TriangleAlert } from "lucide-react";
import type React from "react";

// 限定のカードが待っている列で、上級生でない人に替えるときの確認。ボタンは［まだ変えない］［変える］の 2 つだけ。
// ［変える］なら、そのまま交代し、限定のカードも列に残る（予約や未割当への自動の戻しはしない）。

interface LaneConfirmDialogProps {
  /** 例「この列に限定のカードが2枚あります（佐藤さんは上級生ではありません）」。列ごとに 1 行 */
  messages: string[];
  onCancel: () => void;
  onConfirm: () => void;
}

export const LaneConfirmDialog: React.FC<LaneConfirmDialogProps> = ({
  messages,
  onCancel,
  onConfirm,
}) => (
  <div className="fixed inset-0 z-[210] flex items-center justify-center bg-slate-950/50 p-4">
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label="交代の確認"
      className="w-[min(480px,100%)] overflow-hidden rounded-2xl bg-white shadow-2xl"
    >
      <div className="flex gap-3 p-5">
        <TriangleAlert className="mt-0.5 h-6 w-6 shrink-0 text-amber-500" />
        <div className="space-y-1.5">
          {messages.map((message) => (
            <p
              key={message}
              className="font-black text-[16px] text-slate-950 leading-snug"
            >
              {message}
            </p>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 border-slate-200 border-t bg-slate-50 p-3">
        <button
          type="button"
          onClick={onCancel}
          className="min-h-[52px] touch-manipulation rounded-xl border-2 border-slate-300 bg-white font-black text-[15px] text-slate-800"
        >
          まだ変えない
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className="min-h-[52px] touch-manipulation rounded-xl bg-slate-950 font-black text-[15px] text-white"
        >
          変える
        </button>
      </div>
    </div>
  </div>
);
