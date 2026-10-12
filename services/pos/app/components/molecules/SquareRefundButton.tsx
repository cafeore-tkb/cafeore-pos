import type { SquareCheckout } from "@cafeore/common";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
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
  /** 確認に出す決済（「No.12（¥600）」など） */
  label: string;
  /** 結び付いた注文を、返金したら消すか残すか。注文の無い決済なら渡さない */
  orderOnRefund?: "delete" | "keep";
  /** 返金を頼む */
  refund: () => Promise<SquareCheckout>;
  /** Square が返金を受け付けたあと */
  onRefunded?: (checkout: SquareCheckout) => void;
  children?: ReactNode;
};

/**
 * Square の決済を全額返金するボタン。押すと確認を出す
 *
 * 返金先は支払いに使ったカード・電子マネー・QR コード。交通系 IC は Square でも返金できない。
 */
export const SquareRefundButton = ({
  label,
  orderOnRefund,
  refund,
  onRefunded,
  children = "返金",
}: Props) => {
  const [open, setOpen] = useState(false);
  const [refunding, setRefunding] = useState(false);

  const run = async () => {
    setRefunding(true);
    try {
      const checkout = await refund();
      if (checkout.refund_status === "failed") {
        toast.error(
          `返金できませんでした: ${checkout.refund_error ?? "Square が受け付けませんでした"}`,
        );
        return;
      }
      if (checkout.refund_status === "unknown") {
        toast.error(
          `返金できたか確かめられませんでした。もう一度押すと確かめます（二重には返金されません）: ${checkout.refund_error ?? ""}`,
        );
        return;
      }
      const kept = orderOnRefund === "keep" ? "（注文は残しています）" : "";
      toast.success(
        checkout.refund_status === "refunded"
          ? `${label} を返金しました${kept}`
          : `${label} の返金を受け付けました（Square で処理されると完了します）${kept}`,
      );
      setOpen(false);
      onRefunded?.(checkout);
    } catch (error) {
      toast.error(
        `返金できませんでした: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setRefunding(false);
    }
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!refunding) setOpen(next);
      }}
    >
      <AlertDialogTrigger asChild>
        <Button size="sm" variant="outline">
          {children}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent
        // レジ画面は Esc で入力中の注文を消す。確認を閉じるだけの Esc で消さないよう、ここで止める。
        onEscapeKeyDown={(event) => event.stopPropagation()}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>
            {label} を返金しますか？
            {orderOnRefund === "keep" && "（注文は残します）"}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-1">
              <p>
                支払いに使ったカード・電子マネー・QR
                コードへ全額を返します。取り消せません。
                {orderOnRefund === "delete" &&
                  "Square が受け付けたら注文は消えます。"}
                {orderOnRefund === "keep" &&
                  "注文は消さずに残します（提供もそのまま続きます）。"}
              </p>
              {orderOnRefund === "delete" && (
                <p>
                  あとで Square で返金が失敗したときは「未登録の Square
                  決済」に理由付きで出ます。そこでもう一度返金するか、注文を登録し直してください。
                </p>
              )}
              {orderOnRefund === "keep" && (
                <p>
                  あとで Square
                  で返金が失敗したときは、過去の注文のこの注文のカードに出ます。そこでもう一度返金してください。
                </p>
              )}
              <p>交通系 IC の支払いは Square でも返金できません。</p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={refunding}>キャンセル</AlertDialogCancel>
          <AlertDialogAction
            className={buttonVariants({ variant: "destructive" })}
            disabled={refunding}
            onClick={(event) => {
              // 終わるまで閉じない
              event.preventDefault();
              void run();
            }}
          >
            {refunding ? "返金中..." : "返金する"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
