import { useRef } from "react";
import { cn } from "~/lib/utils";
import { CashierDialog, dialogButton } from "./CashierDialog";

type props = {
  open: boolean;
  orderId: number;
  /** 削除する商品（「商品 3点（¥1,200）」） */
  summary: string;
  onConfirm: () => void;
  onClose: () => void;
};

/**
 * 全削除の確認。削除した商品は一覧に残り、1 点ずつ戻せるので、Enter で全削除できるようにする
 */
export const VoidAllDialog = ({
  open,
  orderId,
  summary,
  onConfirm,
  onClose,
}: props) => {
  const confirmRef = useRef<HTMLButtonElement>(null);
  return (
    <CashierDialog
      open={open}
      onClose={onClose}
      title="全削除"
      sub={`No.${orderId}`}
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        confirmRef.current?.focus();
      }}
    >
      <div className="flex flex-col gap-2 px-5 py-4.5">
        <span className="font-extrabold text-xl">
          {summary} をすべて削除しますか？
        </span>
        <span className="text-sm text-stone-600 leading-relaxed">
          削除した商品は二重線で一覧に残り、「削除を戻す」で 1 点ずつ戻せます。
        </span>
        <span className="text-stone-400 text-xs">
          Enter で全削除 ・ Esc で閉じる
        </span>
      </div>
      <div className="flex justify-end gap-2 px-5 pb-4.5">
        <button type="button" onClick={onClose} className={dialogButton.cancel}>
          キャンセル
        </button>
        <button
          ref={confirmRef}
          type="button"
          onClick={onConfirm}
          className={cn(
            dialogButton.destructive,
            "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-red-200",
          )}
        >
          全削除する
        </button>
      </div>
    </CashierDialog>
  );
};
