import { useRef, useState } from "react";
import { cn } from "~/lib/utils";
import { CashierDialog, dialogButton } from "./CashierDialog";

type props = {
  open: boolean;
  orderId: number;
  /** 開いたときの特記事項 */
  initial: string;
  onCommit: (memo: string) => void;
  onClose: () => void;
};

/**
 * 特記事項（送るときにレジのコメントとして付ける）を書くダイアログ
 *
 * Enter で確定、Shift+Enter で改行する。
 */
export const MemoDialog = ({
  open,
  orderId,
  initial,
  onCommit,
  onClose,
}: props) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  return (
    <CashierDialog
      open={open}
      onClose={onClose}
      title="特記事項"
      sub={`No.${orderId}`}
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        const textarea = textareaRef.current;
        if (!textarea) return;
        textarea.focus();
        textarea.setSelectionRange(
          textarea.value.length,
          textarea.value.length,
        );
      }}
      className="w-[580px]"
    >
      {/* 閉じると中身ごと外れるので、開くたびに今の特記事項から始まる */}
      <MemoForm
        initial={initial}
        textareaRef={textareaRef}
        onCommit={onCommit}
        onClose={onClose}
      />
    </CashierDialog>
  );
};

const MemoForm = ({
  initial,
  textareaRef,
  onCommit,
  onClose,
}: Pick<props, "initial" | "onCommit" | "onClose"> & {
  textareaRef: React.RefObject<HTMLTextAreaElement>;
}) => {
  const [memo, setMemo] = useState(initial);
  return (
    <>
      <div className="flex flex-col gap-2 p-4">
        <textarea
          ref={textareaRef}
          aria-label="特記事項"
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onCommit(memo.trim());
            }
          }}
          placeholder="特記事項を入力"
          className="h-45 w-full resize-none rounded-[10px] border border-theme-primary bg-white px-3.5 py-3 text-[17px] leading-relaxed shadow-[0_0_0_1px_var(--color-theme-primary)] outline-none placeholder:text-stone-400"
        />
        <span className="text-stone-400 text-xs">
          Enter で確定 ・ Shift+Enter で改行 ・ Esc で閉じる
        </span>
      </div>
      <div className="flex flex-none items-center gap-2 px-4 pb-4">
        <button
          type="button"
          onClick={() => onCommit("")}
          className={dialogButton.danger}
        >
          削除して確定
        </button>
        <button
          type="button"
          onClick={onClose}
          className={cn(dialogButton.cancel, "ml-auto")}
        >
          キャンセル
        </button>
        <button
          type="button"
          onClick={() => onCommit(memo.trim())}
          className={dialogButton.primary}
        >
          確定
        </button>
      </div>
    </>
  );
};
