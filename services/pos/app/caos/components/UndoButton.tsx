import { Undo2 } from "lucide-react";
import type React from "react";

interface UndoButtonProps {
  /** 戻せる操作の名前。null なら押せない（灰色） */
  label: string | null;
  pending: boolean;
  onUndo: () => void;
}

// ヘッダーの「1つ戻す」。この画面が最後にした操作だけを戻す（hooks/useCaosUndo）
export const UndoButton: React.FC<UndoButtonProps> = ({
  label,
  pending,
  onUndo,
}) => (
  <button
    id="btn-undo"
    type="button"
    disabled={!label || pending}
    onClick={onUndo}
    title={label ? `「${label}」を元に戻す` : "元に戻せる操作はありません"}
    aria-label={label ? `1つ戻す：${label}` : "1つ戻す"}
    className="flex min-h-[44px] shrink-0 touch-manipulation items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-300 bg-white px-3 font-black text-slate-800 text-xs shadow-xs transition-colors hover:bg-slate-100 disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
  >
    <Undo2 className="h-4 w-4" />
    <span>1つ戻す</span>
  </button>
);
