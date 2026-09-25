import { toast } from "sonner";

const SUBMIT_FAILED_TOAST_ID = "cashier-submit-failed";

/**
 * 注文を保存できなかったことを知らせる
 *
 * 見落とさないよう、閉じるか次の注文を保存できるまで出し続ける
 */
const notifySubmitFailed = (orderId: number, error: unknown) => {
  const reason = error instanceof Error ? error.message : String(error);
  toast.error(`No.${orderId} の注文を保存できませんでした`, {
    id: SUBMIT_FAILED_TOAST_ID,
    description: `ラベルは印刷していません。入力はそのまま残っているので、内容を確かめてもう一度送信してください（${reason}）`,
    duration: Number.POSITIVE_INFINITY,
    closeButton: true,
    richColors: true,
  });
};

/**
 * 保存できたら、前に失敗した知らせを閉じる
 */
const dismissSubmitFailed = () => {
  toast.dismiss(SUBMIT_FAILED_TOAST_ID);
};

export { dismissSubmitFailed, notifySubmitFailed };
