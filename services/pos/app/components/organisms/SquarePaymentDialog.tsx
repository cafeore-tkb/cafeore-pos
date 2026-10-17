import type { SquarePaymentType } from "@cafeore/common";
import {
  CheckCircledIcon,
  CrossCircledIcon,
  ExclamationTriangleIcon,
  UpdateIcon,
} from "@radix-ui/react-icons";
import { cn } from "~/lib/utils";
import { formatYen } from "~/lib/yen";
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
import { dialogButton } from "./cashier/CashierDialog";

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
  submitting: "注文を登録しています",
  failed: "決済できませんでした",
  attention: "確認が必要です",
  conflict: "別の決済が進行中です",
};

type Props = {
  state: SquarePaymentState | null;
  /** 決済画面を出している端末の名前 */
  deviceName?: string;
  canSubmitOrder: boolean;
  /** 小計分割の 1 回分なら、このあと残る小計の額。でなければ undefined */
  remainingAfter?: number;
  onCancel: () => void;
  onRetry: () => void;
  onCancelConflicting: () => void;
  onSubmitPaid: () => void;
  onClose: () => void;
  /** 決済できなかったときの「一部金額を先払い」（残高不足など）。出さなければ undefined */
  onSplit?: () => void;
};

/**
 * Square Terminal で決済している間に出すダイアログ
 *
 * お金の扱いが決まるまで閉じられない。Esc やダイアログの外のクリックでは閉じない。
 */
export const SquarePaymentDialog = ({
  state,
  deviceName,
  canSubmitOrder,
  remainingAfter,
  onCancel,
  onRetry,
  onCancelConflicting,
  onSubmitPaid,
  onClose,
  onSplit,
}: Props) => {
  if (state === null) {
    return null;
  }
  const { phase, order, amount, paymentType, checkout, message, started } =
    state;
  // 結果がいつまでも決まらない（受取額を確かめられないなど）ときの逃げ道。
  // 閉じた後に支払いが確定したら「未登録の Square 決済」に出る。
  const stuck =
    phase === "waiting" &&
    checkout !== null &&
    Date.now() - new Date(checkout.created_at).getTime() > STUCK_AFTER_MS;
  // 支払い済みなのに注文の登録に失敗した。送り直しても通らないとき
  // （登録できていたのに応答だけ失われた、など）のために閉じられるようにする。
  const submitFailed = phase === "paid" && message !== null;
  const closable =
    phase === "failed" ||
    phase === "attention" ||
    phase === "conflict" ||
    stuck ||
    submitFailed;

  return (
    <AlertDialog open>
      <AlertDialogContent
        onEscapeKeyDown={(event) => event.preventDefault()}
        // 開いた瞬間に「取り消す」へフォーカスを移さない（Enter の押し過ぎで取り消さないように）
        onOpenAutoFocus={(event) => event.preventDefault()}
        overlayClassName="bg-stone-900/50"
        className="w-[460px] max-w-[calc(100vw-32px)] gap-0 overflow-hidden rounded-xl border-0 p-0 font-noto text-stone-900 shadow-[0_0_0_1px_rgba(0,0,0,.08),0_24px_64px_-12px_rgba(0,0,0,.45)] sm:rounded-xl"
      >
        <div className="flex h-12 items-center gap-2.5 border-stone-200 border-b bg-stone-100 px-4">
          <span className="font-bold text-[13px] text-sky-800">
            Square 端末
          </span>
          {deviceName && (
            <span className="text-[13px] text-stone-500">{deviceName}</span>
          )}
        </div>
        <AlertDialogHeader className="gap-3 space-y-0 px-5 pt-4.5 pb-2 text-left sm:text-left">
          <AlertDialogTitle className="flex items-center gap-2.5 font-extrabold text-[22px]">
            {(phase === "creating" ||
              phase === "waiting" ||
              phase === "canceling" ||
              phase === "submitting") && (
              <UpdateIcon className="h-6 w-6 flex-none animate-spin" />
            )}
            {phase === "paid" && (
              <CheckCircledIcon className="h-6 w-6 flex-none text-green-700" />
            )}
            {phase === "failed" && (
              <CrossCircledIcon className="h-6 w-6 flex-none text-red-700" />
            )}
            {(phase === "attention" || phase === "conflict") && (
              <ExclamationTriangleIcon className="h-6 w-6 flex-none text-orange-600" />
            )}
            {phaseTitle[phase]}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="flex flex-col gap-3 text-[13px] text-stone-500 leading-relaxed">
              <div className="flex justify-between text-base text-stone-700">
                <span>No.{order.orderId}</span>
                <span>{squarePaymentTypeLabel[paymentType]}</span>
              </div>
              <div className="flex items-baseline justify-between font-extrabold text-stone-900 tabular-nums">
                <span className="text-[22px]">請求額</span>
                <span className="text-3xl">{formatYen(amount)}</span>
              </div>
              {remainingAfter !== undefined && remainingAfter > 0 && (
                <div className="flex justify-between font-bold text-[13px] text-prepay">
                  <span>分割の 1 回分（このあと残り）</span>
                  <span className="tabular-nums">
                    {formatYen(remainingAfter)}
                  </span>
                </div>
              )}
              {phase === "waiting" && (
                <p>
                  端末の画面でお客さんに操作してもらってください。5
                  分で自動的に取り消されます。
                </p>
              )}
              {phase === "waiting" && started && <p>シールは印刷しました。</p>}
              {phase === "waiting" && paymentType === "FELICA_ALL" && (
                <p>
                  電子マネーで端末にエラーが出たときは、レジからは取り消せません。端末の画面で取り消してください。
                </p>
              )}
              {phase === "canceling" && checkout?.cancel_reason == null && (
                <p>
                  お客さんが操作中のときは、端末で取り消されるまで待ちます。
                </p>
              )}
              {phase === "paid" && !canSubmitOrder && (
                <p className="font-bold text-red-700">
                  お金は受け取っています。通信が戻ったら「注文を送信」を押してください。現金で取り直さないでください。
                </p>
              )}
              {submitFailed && canSubmitOrder && (
                <p className="font-bold text-red-700">
                  お金は受け取っています。現金で取り直さず、「注文を送信」で送り直してください。送り直しても登録できないときは、閉じて注文の一覧を確かめてください。登録されていなければ、右上の「未登録の
                  Square 決済」から登録できます。
                </p>
              )}
              {phase === "failed" && (
                <p className="text-stone-700">
                  お金は受け取っていません。もう一度端末で決済するか、現金で受け取ってください。
                </p>
              )}
              {phase === "failed" && onSplit && (
                <p className="rounded-lg bg-prepay-soft px-3.5 py-3 font-medium text-prepay-ink">
                  残高が足りないときは、使える分だけ
                  {squarePaymentTypeLabel[paymentType]}
                  で先に払ってもらい、残りを別の方法で受け取れます。
                </p>
              )}
              {phase === "failed" && started && (
                <p className="font-bold text-stone-900">
                  先に印刷した No.{order.orderId}
                  のシールは、同じ注文で会計し直すならそのまま使います（刷り直しません）。注文をやめる・変えるときは「会計取消」を押してください（取り消しのシールを刷ります）。
                </p>
              )}
              {message && <p className="text-red-700">{message}</p>}
              {stuck && (
                <p className="font-bold text-red-700">
                  結果を確かめられません。端末と Square
                  の管理画面を確認してください。閉じた後に支払いが確定したら、右上の「未登録の
                  Square 決済」に出ます。
                </p>
              )}
              {phase === "conflict" && state.conflicting && (
                <p>
                  進行中: {formatYen(state.conflicting.amount)}
                  {state.conflicting.order_number != null &&
                    `（No.${state.conflicting.order_number}）`}
                </p>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="min-h-12 gap-2 px-5 pt-3 pb-4.5 sm:space-x-0">
          {phase === "waiting" && (
            <button
              type="button"
              onClick={onCancel}
              className={dialogButton.destructive}
            >
              取り消す
            </button>
          )}
          {phase === "failed" && (
            <button
              type="button"
              onClick={onRetry}
              className={dialogButton.cancel}
            >
              もう一度送る
            </button>
          )}
          {phase === "failed" && onSplit && (
            <button
              type="button"
              onClick={onSplit}
              className="h-12 rounded-[10px] bg-prepay px-5 font-bold text-[15px] text-white"
            >
              一部金額を先払い
            </button>
          )}
          {phase === "conflict" && (
            <button
              type="button"
              onClick={onCancelConflicting}
              className={dialogButton.destructive}
            >
              進行中の決済を取り消す
            </button>
          )}
          {phase === "paid" && (
            <button
              type="button"
              onClick={onSubmitPaid}
              disabled={!canSubmitOrder}
              className={cn(dialogButton.primary, "disabled:opacity-40")}
            >
              注文を送信
            </button>
          )}
          {closable && (
            <button
              type="button"
              onClick={onClose}
              className={dialogButton.cancel}
            >
              閉じる
            </button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
