import { type SquareCheckout, squareRepository } from "@cafeore/common";
import { ExclamationTriangleIcon } from "@radix-ui/react-icons";
import { useState } from "react";
import useSWR from "swr";
import { Button } from "../ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "../ui/sheet";
import { squarePaymentTypeLabel } from "./SquarePaymentDialog";

const REFRESH_INTERVAL_MS = 30_000;

const timeFormat = new Intl.DateTimeFormat("ja-JP", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

type Props = {
  /** 入力中の注文の請求額 */
  currentBillingAmount: number;
  /** 入力中の注文を今送れるか（商品があり、通信できる） */
  canSubmit: boolean;
  /** 入力中の注文を、この決済で支払い済みとして送る */
  onSubmitWithCheckout: (checkout: SquareCheckout) => void;
};

/**
 * Square で支払い済みなのに注文が無い決済があるときだけ出す警告
 *
 * 決済中にレジが落ちた・注文の送信に失敗した・Square で払った注文を消した、のどれか。
 * 同じ注文を入力し直して、その決済に結び付けて送れる（Square で二重に決済しない）。
 */
export const SquareUnlinkedNotice = ({
  currentBillingAmount,
  canSubmit,
  onSubmitWithCheckout,
}: Props) => {
  const [open, setOpen] = useState(false);
  const { data: unlinked, mutate } = useSWR(
    "square-unlinked",
    squareRepository.findUnlinked,
    { refreshInterval: REFRESH_INTERVAL_MS },
  );

  if (!unlinked || unlinked.length === 0) {
    return null;
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="destructive" className="h-8 gap-1 px-3">
          <ExclamationTriangleIcon />
          未登録の Square 決済 {unlinked.length} 件
        </Button>
      </SheetTrigger>
      <SheetContent
        className="overflow-y-auto"
        // レジ画面は Esc で入力中の注文を消す。照合のために入力し直した注文を、
        // シートを閉じるだけの Esc で消さないよう、ここで止める。
        onEscapeKeyDown={(event) => event.stopPropagation()}
      >
        <SheetHeader>
          <SheetTitle>未登録の Square 決済</SheetTitle>
          <SheetDescription>
            お金は受け取っていますが、注文がありません。同じ商品をレジに入力してから「この決済で登録」を押すと、Square
            で二重に決済せずに注文を送れます。返金するときは Square
            の管理画面から行ってください。
          </SheetDescription>
        </SheetHeader>
        <ul className="mt-4 space-y-3">
          {unlinked.map((checkout) => {
            const usable =
              checkout.outcome === "paid" &&
              canSubmit &&
              currentBillingAmount === checkout.amount;
            return (
              <li key={checkout.id} className="rounded border p-3 text-sm">
                <div className="flex justify-between font-bold text-lg">
                  <span>
                    {checkout.order_number != null
                      ? `No.${checkout.order_number}`
                      : "番号なし"}
                  </span>
                  <span>&yen;{checkout.paid_amount ?? checkout.amount}</span>
                </div>
                <div className="flex justify-between text-stone-500">
                  <span>
                    {timeFormat.format(new Date(checkout.created_at))}
                  </span>
                  <span>
                    {squarePaymentTypeLabel[
                      checkout.payment_type as keyof typeof squarePaymentTypeLabel
                    ] ?? checkout.payment_type}
                  </span>
                </div>
                {checkout.checkout_id && (
                  <div className="break-all text-stone-400 text-xs">
                    {checkout.checkout_id}
                  </div>
                )}
                {checkout.outcome === "paid" ? (
                  <div className="mt-2 flex flex-col items-end gap-1">
                    <Button
                      size="sm"
                      disabled={!usable}
                      onClick={() => {
                        onSubmitWithCheckout(checkout);
                        setOpen(false);
                        void mutate();
                      }}
                    >
                      この決済で登録
                    </Button>
                    {!usable && (
                      <span className="text-stone-400 text-xs">
                        入力中の注文（&yen;{currentBillingAmount}
                        ）と金額が合うと押せます
                      </span>
                    )}
                  </div>
                ) : (
                  <p className="mt-2 text-red-700 text-xs">
                    受取額を確かめられていません。Square
                    の管理画面で確認してください。
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      </SheetContent>
    </Sheet>
  );
};
