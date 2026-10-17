import { DRIPPER_NUMBERS, dripperLabel } from "@cafeore/common";
import { type RefObject, useRef, useState } from "react";
import { cn } from "~/lib/utils";
import { CashierDialog, dialogButton } from "./CashierDialog";

type Assignment = { dripper: number | null; assignee: string | null };

type props = {
  /** 指名する商品（「1. 珈琲・俺ブレンド」）。null なら閉じている */
  target: string | null;
  /** 開いたときの指名 */
  initial: Assignment;
  onCommit: (dripper: number | null, assignee: string) => void;
  onClose: () => void;
};

const CHOICES: (number | null)[] = [null, ...DRIPPER_NUMBERS];

/**
 * 商品の指名を決めるダイアログ。ドリッパー（なし・1st〜6th）と、ラベルに印刷する自由記述
 *
 * 指名はドリッパーの番号が必須で、自由記述は番号を選んだときだけ書ける。
 * 入力欄で ←→ を押すとドリッパーを選び（ボタンの並びと同じ向き）、Enter で確定する。
 * ←→ はドリッパーに使うので、自由記述の中でカーソルは動かせない。
 */
export const AssignDialog = ({ target, initial, onCommit, onClose }: props) => {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <CashierDialog
      open={target !== null}
      onClose={onClose}
      title="指名"
      sub={target}
      // 開いたらすぐ ←→・Enter を使えるよう、入力欄にフォーカスする
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        inputRef.current?.focus();
      }}
      className="w-[520px]"
    >
      {/* 閉じると中身ごと外れるので、開くたびに今の指名から始まる */}
      <AssignForm
        initial={initial}
        inputRef={inputRef}
        onCommit={onCommit}
        onClose={onClose}
      />
    </CashierDialog>
  );
};

const AssignForm = ({
  initial,
  inputRef,
  onCommit,
  onClose,
}: Omit<props, "target"> & { inputRef: RefObject<HTMLInputElement> }) => {
  const [dripper, setDripper] = useState(initial.dripper);
  const [assignee, setAssignee] = useState(initial.assignee ?? "");

  const choose = (next: number | null) => {
    setDripper(next);
    inputRef.current?.focus();
  };

  return (
    <>
      <div className="flex flex-col gap-2 p-4">
        <div className="font-bold text-stone-600 text-xs">ドリッパー</div>
        <div className="grid grid-cols-7 gap-1.5">
          {CHOICES.map((choice) => {
            const on = dripper === choice;
            return (
              <button
                key={choice ?? "none"}
                type="button"
                aria-pressed={on}
                onClick={() => choose(choice)}
                className={cn(
                  "h-12 rounded-[10px] border font-bold text-[15px]",
                  on
                    ? "border-theme-primary bg-theme-primary text-white"
                    : "border-stone-300 bg-white text-stone-700 hover:bg-stone-50",
                )}
              >
                {choice === null ? "なし" : dripperLabel(choice)}
              </button>
            );
          })}
        </div>
        <label
          htmlFor="cashier-assignee"
          className="mt-1.5 font-bold text-stone-600 text-xs"
        >
          自由入力
        </label>
        <input
          id="cashier-assignee"
          ref={inputRef}
          value={dripper === null ? "" : assignee}
          // 番号を選ぶまでは書けない。←→・Enter を受けるために、フォーカスは置ける
          readOnly={dripper === null}
          onChange={(e) => setAssignee(e.target.value)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
              e.preventDefault();
              const step = e.key === "ArrowRight" ? 1 : -1;
              const index = CHOICES.indexOf(dripper);
              setDripper(
                CHOICES[(index + step + CHOICES.length) % CHOICES.length],
              );
            }
            if (e.key === "Enter") {
              e.preventDefault();
              onCommit(dripper, assignee);
            }
          }}
          placeholder={
            dripper === null
              ? "ドリッパーを選ぶと書けます"
              : `名前など自由に入力（ラベルに印刷。空なら${dripperLabel(dripper)}）`
          }
          className={cn(
            "h-14 w-full rounded-[10px] border border-theme-primary px-3.5 text-lg shadow-[0_0_0_1px_var(--color-theme-primary)] outline-none placeholder:text-stone-400",
            dripper === null ? "bg-stone-50" : "bg-white",
          )}
        />
        <span className="text-stone-400 text-xs">
          ← → でドリッパー ・ Enter で確定 ・ Esc で閉じる
        </span>
      </div>
      <div className="flex flex-none items-center gap-2 px-4 pb-4">
        <button
          type="button"
          onClick={() => onCommit(null, "")}
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
          onClick={() => onCommit(dripper, assignee)}
          className={dialogButton.primary}
        >
          確定
        </button>
      </div>
    </>
  );
};
