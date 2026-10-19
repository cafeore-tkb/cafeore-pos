import {
  type OrderEntity,
  type WithId,
  orderRepository,
  squareRepository,
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

/**
 * 返金したあとの注文
 * - keep: キャンセルしない（提供も続く）
 * - cancel: キャンセルする
 * - cancelled: もうキャンセルしている（返金だけする）
 */
export type RefundOrderMode = "keep" | "cancel" | "cancelled";

const BUTTON_LABEL: Record<RefundOrderMode, string> = {
  keep: "返金（キャンセルしない）",
  cancel: "返金＆キャンセル",
  cancelled: "返金",
};

/**
 * 返金のボタンで返す分。Square は Square で返金できるときだけ（このレジで Square 連携が有効なとき）。
 * どちらも無ければ null（ボタンを出さない）
 */
export const refundableAmounts = (
  order: OrderEntity,
  squareRefundable: boolean,
): { cash?: number; square?: number } | null => {
  const { cash, square } = order.getUnrefundedAmounts();
  const amounts = {
    cash,
    square: squareRefundable ? square : undefined,
  };
  return amounts.cash === undefined && amounts.square === undefined
    ? null
    : amounts;
};

type Props = {
  order: WithId<OrderEntity>;
  /** 確認に出す注文番号（分割して一括会計で分けた注文はまとめて返金するので全部）。省くと order の番号 */
  orderIds?: readonly number[];
  mode: RefundOrderMode;
  /** Square で返金できるか（このレジで Square 連携が有効か） */
  squareRefundable: boolean;
  /** 押すボタンの見た目を変える */
  triggerClassName?: string;
  /** mode が cancel で、返金して注文をキャンセルできたら呼ぶ（キャンセルのシールを刷る） */
  onCancelled?: () => void;
};

/**
 * 注文を返金するボタン。押すと確認を出す
 *
 * Square で払った分は Square で元の決済手段へ全額を返し、現金で払った分は手で返して、返したことを記録する。
 * 返金した分は売上に数えず、返金した注文の番号は引換券の割引に使えない。
 * mode が cancel なら、注文もキャンセルする（消さずに残し、番号は使ったまま）
 */
export const RefundOrderButton = ({
  order,
  orderIds = [order.orderId],
  mode,
  squareRefundable,
  triggerClassName,
  onCancelled,
}: Props) => {
  const [open, setOpen] = useState(false);
  const [refunding, setRefunding] = useState(false);
  const amounts = refundableAmounts(order, squareRefundable);
  if (amounts === null) return null;
  const label = `No.${orderIds.join("・")}（${formatYen(order.billingAmount)}）`;

  const run = async () => {
    setRefunding(true);
    try {
      let squarePending = false;
      if (amounts.square !== undefined) {
        // キャンセルするなら、Square が返金を受け付けた時点でサーバーがキャンセルもする
        const checkout =
          mode === "cancel"
            ? await squareRepository.refundOrder(order.id)
            : await squareRepository.refundOrderKeepingOrder(order.id);
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
        squarePending = checkout.refund_status !== "refunded";
      }
      if (amounts.cash !== undefined) {
        await orderRepository.refundCash(order.id);
      }
      if (mode === "cancel" && amounts.square === undefined) {
        await orderRepository.cancel(order.id);
      }
      const after =
        mode === "cancel"
          ? "。注文はキャンセルしました"
          : mode === "keep"
            ? "（注文は残しています）"
            : "";
      toast.success(
        squarePending
          ? `${label} の返金を受け付けました（Square で処理されると完了します）${after}`
          : `${label} を返金しました${after}`,
      );
      setOpen(false);
      if (mode === "cancel") onCancelled?.();
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
        <Button size="sm" variant="outline" className={triggerClassName}>
          {BUTTON_LABEL[mode]}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent
        // レジ画面は Esc で入力中の注文を消す。確認を閉じるだけの Esc で消さないよう、ここで止める。
        onEscapeKeyDown={(event) => event.stopPropagation()}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>
            {label} を返金しますか？
            {mode === "keep" && "（注文は残します）"}
            {mode === "cancel" && "（注文はキャンセルします）"}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-1">
              {amounts.square !== undefined && (
                <p>
                  Square の支払い {formatYen(amounts.square)}{" "}
                  は、支払いに使ったカード・電子マネー・QR
                  コードへ全額を返します。取り消せません。交通系 IC の支払いは
                  Square でも返金できません。
                </p>
              )}
              {amounts.cash !== undefined && (
                <p>
                  現金 {formatYen(amounts.cash)}{" "}
                  は手で返してください。返したことを記録します。
                </p>
              )}
              {mode === "keep" && (
                <p>注文は消さずに残します（提供もそのまま続きます）。</p>
              )}
              {mode === "cancel" && (
                <p>
                  注文はキャンセルします（作る画面から消えます。番号は使ったままです）。
                </p>
              )}
              <p>
                返金した分は売上に数えず、この番号の引換券では割引できなくなります。
              </p>
              {amounts.square !== undefined && (
                <p>
                  あとで Square
                  で返金が失敗したときは、過去の注文のこの注文に出ます。そこでもう一度返金してください。
                </p>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={refunding}>やめる</AlertDialogCancel>
          <AlertDialogAction
            className={buttonVariants({ variant: "destructive" })}
            disabled={refunding}
            onClick={(event) => {
              // 終わるまで閉じない
              event.preventDefault();
              void run();
            }}
          >
            {refunding
              ? "返金中..."
              : mode === "cancel"
                ? "返金＆キャンセルする"
                : "返金する"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
