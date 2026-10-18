import type { OrderEntity } from "@cafeore/common";
import { orderRecordStatus, refundSections } from "./orderRecords";

export const recordTime = (value: Date | null | undefined) =>
  value
    ? new Intl.DateTimeFormat("ja-JP", {
        timeZone: "Asia/Tokyo",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      }).format(value)
    : "—";
const refundName = (value: string | undefined) =>
  (
    ({
      none: "返金なし",
      pending: "返金処理中",
      refunded: "返金済み",
      failed: "返金失敗",
      rejected: "返金拒否",
    }) as Record<string, string>
  )[value ?? ""] ??
  value ??
  "未記録";
const yen = (value: number) => `¥${value.toLocaleString("ja-JP")}`;
const paymentName = (value: string | undefined) =>
  (
    ({ cash: "現金", square: "Square（カード・QR等）" }) as Record<
      string,
      string
    >
  )[value ?? ""] ??
  value ??
  "未記録";

/** 注文の会計・商品・各杯の時刻・コメントを参照する。編集操作は置かない。 */
export function OrderDetail({ order }: { order: OrderEntity }) {
  const refunds = refundSections(order);
  return (
    <article
      className="space-y-5 rounded-xl border bg-white p-4"
      aria-label={`注文${order.orderId}の詳細`}
    >
      <header className="flex flex-wrap items-center justify-between gap-2 border-stone-200 border-b pb-3">
        <h2 className="font-black text-2xl">
          #{String(order.orderId).padStart(3, "0")}
        </h2>
        <span
          className={`rounded-full px-3 py-1 text-sm ${order.isCancelled() ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-900"}`}
        >
          {orderRecordStatus(order)}
        </span>
      </header>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        {[
          ["受付", recordTime(order.createdAt)],
          ["準備完了", recordTime(order.readyAt)],
          ["提供", recordTime(order.servedAt)],
          ["キャンセル", recordTime(order.cancelledAt)],
          ["商品合計", yen(order.total)],
          ["割引", yen(order.discount)],
          ["請求額", yen(order.billingAmount)],
          ["お預かり", yen(order.received)],
          ...(refunds.cash
            ? [["現金返金", recordTime(order.cashRefundedAt)]]
            : []),
          ...(refunds.square
            ? [["Square返金", refundName(order.squareRefundStatus)]]
            : []),
          [
            "支払い方法",
            order.payments.length
              ? "個別会計（下記）"
              : paymentName(order.paymentMethod),
          ],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="text-stone-500">{label}</dt>
            <dd className="break-words font-bold">{value}</dd>
          </div>
        ))}
      </dl>
      {order.payments.length > 0 && (
        <section>
          <h3 className="mb-2 font-bold">支払いの内訳</h3>
          <ul className="space-y-1 text-sm">
            {order.payments.map((payment, index) => (
              <li key={`${payment.method}-${index}`}>
                {paymentName(payment.method)} · {yen(payment.amount)}
                {payment.method === "square"
                  ? ` · ${refundName(payment.squareRefundStatus)}`
                  : ""}
              </li>
            ))}
          </ul>
        </section>
      )}
      <section>
        <h3 className="mb-2 font-bold">商品 · {order.getCups().length}杯</h3>
        <ul className="divide-y">
          {order.menus.map((menu, i) => (
            <li
              key={menu.orderMenuId ?? `${menu.id}-${i}`}
              className="py-2 text-sm"
            >
              <div className="flex justify-between gap-2">
                <span className="font-bold">{menu.name}</span>
                <span>{yen(menu.price)}</span>
              </div>
              <p className="text-stone-600">
                {menu.items
                  .map(({ item, quantity }) => `${item.name} × ${quantity}`)
                  .join("、")}
              </p>
              {(menu.assignee || menu.dripper) && (
                <p className="text-amber-800">
                  指名：
                  {[menu.dripper ? `${menu.dripper}番` : "", menu.assignee]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              )}
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h3 className="mb-2 font-bold">1杯ごとの記録</h3>
        {order.cups.length ? (
          <div className="space-y-2">
            {order.cups.map((cup, i) => (
              <div key={cup.id} className="rounded-lg bg-stone-50 p-3 text-sm">
                <p className="font-bold">
                  {i + 1}. {cup.item.name}
                  {cup.dripper ? ` · ${cup.dripper}番` : ""}
                </p>
                <dl className="mt-2 grid grid-cols-2 gap-2">
                  {[
                    ["マスターでの割り振り", cup.assignedAt],
                    ["抽出開始", cup.brewStartedAt],
                    ["抽出終了", cup.brewFinishedAt],
                    ["準備完了", cup.readyAt],
                    ["提供", cup.servedAt],
                  ].map(([label, value]) => (
                    <div key={String(label)}>
                      <dt className="text-stone-500">{String(label)}</dt>
                      <dd>{recordTime(value as Date | null)}</dd>
                    </div>
                  ))}
                </dl>
                {cup.emergencies.map((emergency) => (
                  <p
                    key={emergency.id}
                    className="mt-2 break-words text-red-700"
                  >
                    入れ直し · {recordTime(emergency.createdAt)} ·{" "}
                    {emergency.reason || "理由なし"}
                  </p>
                ))}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-stone-500">
            杯別の記録はありません。上の商品明細を確認してください。
          </p>
        )}
      </section>
      <section>
        <h3 className="mb-2 font-bold">コメント · {order.comments.length}件</h3>
        <div className="space-y-2">
          {order.comments.map((comment, i) => (
            <div
              key={`${comment.createdAt.getTime()}-${i}`}
              className="rounded-lg bg-amber-50 p-3 text-sm"
            >
              <p className="text-stone-500">
                {
                  {
                    cashier: "レジ",
                    master: "マスター",
                    serve: "提供",
                    others: "その他",
                  }[comment.author]
                }{" "}
                · {recordTime(comment.createdAt)}
              </p>
              <p className="whitespace-pre-wrap break-words">{comment.text}</p>
            </div>
          ))}
          {!order.comments.length && (
            <p className="text-sm text-stone-500">コメントはありません。</p>
          )}
        </div>
      </section>
      <p className="break-all text-stone-400 text-xs">記録ID：{order.id}</p>
    </article>
  );
}
