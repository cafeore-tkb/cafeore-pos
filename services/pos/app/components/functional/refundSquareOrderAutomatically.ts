import {
  type OrderEntity,
  type WithId,
  squareRepository,
} from "@cafeore/common";
import { toast } from "sonner";

/**
 * Square で払って登録した注文を、すぐに全額返金する（注文は残す）。レジの「常に返金（キャンセルしない）」用
 *
 * 結果はトーストで知らせる。返金できなかったら、閉じるまで消えないトーストで知らせる。
 * 返金の状態は過去の注文のカードにも出るので、そこから頼み直せる。
 */
export const refundSquareOrderAutomatically = async (
  order: WithId<OrderEntity>,
) => {
  const label = `No.${order.orderId}（¥${order.billingAmount}）`;
  let reason: string;
  try {
    const checkout = await squareRepository.refundOrderKeepingOrder(order.id);
    if (checkout.refund_status === "refunded") {
      toast.success(`${label} を自動で返金しました（注文は残しています）`);
      return;
    }
    if (checkout.refund_status === "pending") {
      toast.success(
        `${label} の返金を自動で頼みました（Square で処理されると完了します。注文は残しています）`,
      );
      return;
    }
    reason =
      checkout.refund_status === "unknown"
        ? `返金できたか確かめられませんでした: ${checkout.refund_error ?? ""}`
        : (checkout.refund_error ?? "Square が受け付けませんでした");
  } catch (error) {
    reason = error instanceof Error ? error.message : String(error);
  }
  toast.error(`${label} を自動で返金できませんでした`, {
    description: `過去の注文のこの注文から、もう一度返金してください。${reason}`,
    duration: Number.POSITIVE_INFINITY,
    action: { label: "閉じる", onClick: () => {} },
  });
};
