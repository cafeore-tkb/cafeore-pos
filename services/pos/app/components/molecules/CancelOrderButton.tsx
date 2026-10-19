import {
  type OrderEntity,
  type WithId,
  orderRepository,
} from "@cafeore/common";
import { useState } from "react";
import { toast } from "sonner";
import { formatYen } from "~/lib/yen";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "../ui/alert-dialog";
import { Button, buttonVariants } from "../ui/button";

type Props = {
  order: WithId<OrderEntity>;
  /** 押すボタンの見た目を変える */
  triggerClassName?: string;
  /** キャンセルできたら呼ぶ（キャンセルのシールを刷る） */
  onCancelled?: () => void;
};

/**
 * 注文をキャンセルする（返金はしない）ボタン。押すと確認を出す
 *
 * 現金・Square・返金済みのどの注文にも使える。注文は消さずに残し（過去の注文に「キャンセル」と出す）、
 * 番号は使ったまま、使った在庫も戻さない。作る画面（マスター・提供・CaOS・呼び出し）からは消える。
 * 返金していなければ売上に数えたままにする（あとで「返金」で返せる）
 */
export const CancelOrderButton = ({
  order,
  triggerClassName,
  onCancelled,
}: Props) => {
  const [open, setOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const label = `No.${order.orderId}（${formatYen(order.billingAmount)}）`;
  const unrefunded = order.getUnrefundedAmounts();

  const run = async () => {
    setCancelling(true);
    try {
      await orderRepository.cancel(order.id);
      toast.success(`${label} をキャンセルしました`);
      setOpen(false);
      onCancelled?.();
    } catch (error) {
      toast.error(
        `キャンセルできませんでした: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setCancelling(false);
    }
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!cancelling) setOpen(next);
      }}
    >
      <AlertDialogTrigger asChild>
        <Button size="sm" variant="outline" className={triggerClassName}>
          キャンセル
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent
        // レジ画面は Esc で入力中の注文を消す。確認を閉じるだけの Esc で消さないよう、ここで止める。
        onEscapeKeyDown={(event) => event.stopPropagation()}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{label} をキャンセルしますか？</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-1">
              <p>
                作る画面から消え、過去の注文に「キャンセル」と残ります。番号は使ったままです。取り消せません。
              </p>
              {(unrefunded.cash !== undefined ||
                unrefunded.square !== undefined) && (
                <p>
                  返金はしません（売上に数えたままです）。返すときは「返金＆キャンセル」を使うか、キャンセルしたあとに「返金」を押してください。
                </p>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={cancelling}>やめる</AlertDialogCancel>
          <AlertDialogAction
            className={buttonVariants({ variant: "destructive" })}
            disabled={cancelling}
            onClick={(event) => {
              // 終わるまで閉じない
              event.preventDefault();
              void run();
            }}
          >
            {cancelling ? "キャンセル中..." : "キャンセルする"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
