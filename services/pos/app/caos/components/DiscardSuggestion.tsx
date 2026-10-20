import type { CaosCard } from "@cafeore/common";
import { useState } from "react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";
import discardBrewIcon from "../icons/discard-brew.svg";
import { orderNoLabel } from "../logic/cards";

/** 元の抽出を破棄する候補と確認画面。保存方法の合意前なので確定操作は未接続。 */
export const DiscardSuggestion = ({
  cups,
  inset,
}: {
  cups: CaosCard["cups"];
  inset: string;
}) => {
  const [open, setOpen] = useState(false);
  if (cups.length === 0) return null;
  return (
    <>
      <button
        type="button"
        aria-label={`入れ直し登録済み：元の${cups.length}杯の破棄を確認`}
        title={`入れ直し登録済み：元の${cups.length}杯の破棄を確認`}
        style={{ left: `max(calc(${inset} + 4px), calc(50% - 20px))` }}
        className="absolute bottom-0 z-[90] flex h-10 w-10 touch-manipulation items-center justify-center rounded-full bg-white shadow-lg active:scale-90"
        onClick={(event) => {
          event.stopPropagation();
          setOpen(true);
        }}
      >
        <img
          src={discardBrewIcon}
          alt=""
          className="h-full w-full rounded-full bg-white"
          draggable={false}
        />
      </button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent
          className="z-[200]"
          overlayClassName="z-[199] bg-black/40"
          onClick={(event) => event.stopPropagation()}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>元の抽出を破棄しますか？</AlertDialogTitle>
            <AlertDialogDescription>
              入れ直しを登録した、次の{cups.length}杯が対象です。
              新しい入れ直しカップと、対象外のカップは残ります。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="space-y-2 font-bold">
            {cups.map((cup) => (
              <li key={cup.id}>
                #{orderNoLabel(cup.orderNo)}　{cup.item.abbr}　1杯
              </li>
            ))}
          </ul>
          <AlertDialogFooter>
            <AlertDialogCancel>戻る</AlertDialogCancel>
            <Button variant="destructive" disabled>
              元の{cups.length}杯を破棄
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
