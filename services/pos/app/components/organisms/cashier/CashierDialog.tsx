import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Cross2Icon } from "@radix-ui/react-icons";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { cn } from "~/lib/utils";

type props = {
  open: boolean;
  onClose: () => void;
  title: string;
  /** 題の横に小さく出す（注文番号・対象の商品など） */
  sub?: ReactNode;
  /** 開いたときに最初にフォーカスする要素を決める。決めなければ閉じるボタン以外の最初の要素 */
  onOpenAutoFocus?: ComponentPropsWithoutRef<
    typeof DialogPrimitive.Content
  >["onOpenAutoFocus"];
  className?: string;
  children: ReactNode;
};

/**
 * レジ画面のダイアログの枠（指名・特記事項・全削除）
 *
 * Esc・外側のクリックで閉じる。レジ画面は Esc で入力中の注文を消すので、閉じるだけの Esc はここで止める。
 */
export const CashierDialog = ({
  open,
  onClose,
  title,
  sub,
  onOpenAutoFocus,
  className,
  children,
}: props) => (
  <DialogPrimitive.Root
    open={open}
    onOpenChange={(next) => {
      if (!next) onClose();
    }}
  >
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-stone-900/42 data-[state=closed]:animate-out data-[state=open]:animate-in" />
      <DialogPrimitive.Content
        aria-describedby={undefined}
        onEscapeKeyDown={(event) => event.stopPropagation()}
        onOpenAutoFocus={onOpenAutoFocus}
        className={cn(
          "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 -translate-x-1/2 -translate-y-1/2 fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-32px)] w-[460px] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-xl bg-white font-noto text-stone-900 shadow-[0_0_0_1px_rgba(0,0,0,.08),0_24px_64px_-12px_rgba(0,0,0,.45)] duration-150 data-[state=closed]:animate-out data-[state=open]:animate-in",
          className,
        )}
      >
        <div className="flex h-12 flex-none items-center gap-2.5 border-stone-200 border-b bg-stone-100 pr-1 pl-4">
          <DialogPrimitive.Title className="font-bold text-[15px]">
            {title}
          </DialogPrimitive.Title>
          {sub && <span className="text-[13px] text-stone-500">{sub}</span>}
          <DialogPrimitive.Close
            aria-label="閉じる"
            className="ml-auto flex h-11 w-11 items-center justify-center rounded-lg text-stone-600 hover:bg-stone-200"
          >
            <Cross2Icon className="h-4.5 w-4.5" />
          </DialogPrimitive.Close>
        </div>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  </DialogPrimitive.Root>
);

/** ダイアログの下に並べるボタンの見た目 */
export const dialogButton = {
  /** 「削除して確定」など、赤い文字だけのボタン */
  danger:
    "h-12 rounded-[10px] px-3.5 font-bold text-red-700 text-sm hover:bg-red-50",
  cancel:
    "h-12 rounded-[10px] border border-stone-300 bg-white px-5 font-bold text-[15px] text-stone-700 hover:bg-stone-50",
  primary:
    "h-12 rounded-[10px] bg-theme-primary px-7 font-bold text-[15px] text-white hover:bg-theme-deep",
  destructive:
    "h-12 rounded-[10px] bg-red-500 px-6 font-bold text-[15px] text-white hover:bg-red-600",
};
