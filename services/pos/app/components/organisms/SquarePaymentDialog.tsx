import type { SquarePaymentType } from "@cafeore/common";
import {
  CheckCircledIcon,
  CrossCircledIcon,
  ExclamationTriangleIcon,
  UpdateIcon,
} from "@radix-ui/react-icons";
import type {
  SquarePaymentPhase,
  SquarePaymentState,
} from "../functional/useSquarePayment";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";

export const squarePaymentTypeLabel: Record<SquarePaymentType, string> = {
  CARD_PRESENT: "カード",
  FELICA_ALL: "電子マネー",
  QR_CODE: "QR コード",
};

// Square は 5 分で自動的に取り消す。期限の直後は支払い済みに変わることがあるので、
// サーバーはさらに 1 分待つ。それも過ぎて決まらないときは、閉じられるようにする。
const STUCK_AFTER_MS = 7 * 60 * 1000;

const phaseTitle: Record<SquarePaymentPhase, string> = {
  creating: "端末に送っています",
  waiting: "端末でお支払いください",
  canceling: "取り消しています",
  paid: "お支払いが完了しました",
  failed: "決済できませんでした",
  attention: "確認が必要です",
  conflict: "別の決済が進行中です",
};

type Props = {
  state: SquarePaymentState | null;
  canSubmitOrder: boolean;
  onCancel: () => void;
  onRetry: () => void;
  onCancelConflicting: () => void;
  onSubmitPaid: () => void;
  onClose: () => void;
};

/**
 * Square Terminal で決済している間に出すダイアログ
 *
 * お金の扱いが決まるまで閉じられない。Esc やダイアログの外のクリックでは閉じない。
 */
export const SquarePaymentDialog = ({
  state,
  canSubmitOrder,
  onCancel,
  onRetry,
  onCancelConflicting,
  onSubmitPaid,
  onClose,
}: Props) => {
  if (state === null) {
    return null;
  }
  const { phase, order, paymentType, checkout, message } = state;
  // 結果がいつまでも決まらない（受取額を確かめられないなど）ときの逃げ道。
  // 閉じた後に支払いが確定したら「未登録の Square 決済」に出る。
  const stuck =
    phase === "waiting" &&
    checkout !== null &&
    Date.now() - new Date(checkout.created_at).getTime() > STUCK_AFTER_MS;
  const closable =
    phase === "failed" ||
    phase === "attention" ||
    phase === "conflict" ||
    stuck;

  return (
    <AlertDialog open>
      <AlertDialogContent
        onEscapeKeyDown={(event) => event.preventDefault()}
        // 開いた瞬間に「取り消す」へフォーカスを移さない（Enter の押し過ぎで取り消さないように）
        onOpenAutoFocus={(event) => event.preventDefault()}
        className="max-w-md"
      >
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-2xl">
            {(phase === "creating" ||
              phase === "waiting" ||
              phase === "canceling") && (
              <UpdateIcon className="h-6 w-6 animate-spin" />
            )}
            {phase === "paid" && (
              <CheckCircledIcon className="h-6 w-6 text-green-700" />
            )}
            {phase === "failed" && (
              <CrossCircledIcon className="h-6 w-6 text-red-700" />
            )}
            {(phase === "attention" || phase === "conflict") && (
              <ExclamationTriangleIcon className="h-6 w-6 text-orange-600" />
            )}
            {phaseTitle[phase]}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-base text-stone-700">
              <div className="flex justify-between">
                <span>No.{order.orderId}</span>
                <span>{squarePaymentTypeLabel[paymentType]}</span>
              </div>
              <div className="flex justify-between font-bold text-2xl text-black">
                <span>請求額</span>
                <span>&yen;{order.billingAmount}</span>
              </div>
              {phase === "waiting" && (
                <p className="text-sm text-stone-500">
                  端末の画面でお客さんに操作してもらってください。5
                  分で自動的に取り消されます。
                </p>
              )}
              {phase === "waiting" && paymentType === "FELICA_ALL" && (
                <p className="text-sm text-stone-500">
                  電子マネーで端末にエラーが出たときは、レジからは取り消せません。端末の画面で取り消してください。
                </p>
              )}
              {phase === "canceling" && checkout?.cancel_reason == null && (
                <p className="text-sm text-stone-500">
                  お客さんが操作中のときは、端末で取り消されるまで待ちます。
                </p>
              )}
              {phase === "paid" && !canSubmitOrder && (
                <p className="font-bold text-red-700 text-sm">
                  お金は受け取っています。通信が戻ったら「注文を送信」を押してください。現金で取り直さないでください。
                </p>
              )}
              {phase === "failed" && (
                <p className="text-sm">
                  お金は受け取っていません。もう一度端末で決済するか、現金で受け取ってください。
                </p>
              )}
              {message && <p className="text-red-700 text-sm">{message}</p>}
              {stuck && (
                <p className="font-bold text-red-700 text-sm">
                  結果を確かめられません。端末と Square
                  の管理画面を確認してください。閉じた後に支払いが確定したら、右上の「未登録の
                  Square 決済」に出ます。
                </p>
              )}
              {phase === "conflict" && state.conflicting && (
                <p className="text-sm text-stone-500">
                  進行中: &yen;{state.conflicting.amount}
                  {state.conflicting.order_number != null &&
                    `（No.${state.conflicting.order_number}）`}
                </p>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2">
          {phase === "waiting" && (
            <Button variant="destructive" onClick={onCancel}>
              取り消す
            </Button>
          )}
          {phase === "failed" && checkout === null && (
            <Button onClick={onRetry}>もう一度送る</Button>
          )}
          {phase === "conflict" && (
            <Button variant="destructive" onClick={onCancelConflicting}>
              進行中の決済を取り消す
            </Button>
          )}
          {phase === "paid" && (
            <Button onClick={onSubmitPaid} disabled={!canSubmitOrder}>
              注文を送信
            </Button>
          )}
          {closable && (
            <Button variant="outline" onClick={onClose}>
              閉じる
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
