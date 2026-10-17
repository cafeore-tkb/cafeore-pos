import { type ReactNode, useRef } from "react";
import { cn } from "~/lib/utils";
import { CashierDialog, dialogButton } from "./CashierDialog";

type props = {
  open: boolean;
  title: string;
  sub?: string;
  /** 大きく出す問い（「商品 3点（¥1,200） をすべて削除しますか？」） */
  question: ReactNode;
  /** 問いの下に出す説明 */
  note: ReactNode;
  /** キーの案内（「Enter で全削除 ・ Esc で閉じる」） */
  hint: string;
  confirmLabel: string;
  /** 閉じるボタンの文言。既定は「キャンセル」 */
  cancelLabel?: string;
  /** 確定ボタンの色。消す・取り消す操作は destructive（既定）、戻すなどは primary */
  confirmTone?: "destructive" | "primary";
  /**
   * 開いたときにフォーカスするボタン（Enter で押すボタン）。
   * 取り返しがつかない操作は cancel にして、押し間違いの Enter で進まないようにする
   */
  focus: "confirm" | "cancel";
  onConfirm: () => void;
  onClose: () => void;
};

/** レジの確認ダイアログ（全削除・入力中の注文を消す・先払いの途中に戻す） */
export const ConfirmDialog = ({
  open,
  title,
  sub,
  question,
  note,
  hint,
  confirmLabel,
  cancelLabel = "キャンセル",
  confirmTone = "destructive",
  focus,
  onConfirm,
  onClose,
}: props) => {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  return (
    <CashierDialog
      open={open}
      onClose={onClose}
      title={title}
      sub={sub}
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        (focus === "confirm" ? confirmRef : cancelRef).current?.focus();
      }}
    >
      <div className="flex flex-col gap-2 px-5 py-4.5">
        <span className="font-extrabold text-xl">{question}</span>
        <span className="text-sm text-stone-600 leading-relaxed">{note}</span>
        <span className="text-stone-400 text-xs">{hint}</span>
      </div>
      <div className="flex justify-end gap-2 px-5 pb-4.5">
        <button
          ref={cancelRef}
          type="button"
          onClick={onClose}
          className={cn(
            dialogButton.cancel,
            "focus:outline-none focus:ring-4 focus:ring-stone-300",
          )}
        >
          {cancelLabel}
        </button>
        <button
          ref={confirmRef}
          type="button"
          onClick={onConfirm}
          className={cn(
            dialogButton[confirmTone],
            "focus:outline-none focus:ring-4",
            confirmTone === "destructive"
              ? "focus:ring-red-200"
              : "focus:ring-theme-primary/30",
          )}
        >
          {confirmLabel}
        </button>
      </div>
    </CashierDialog>
  );
};
