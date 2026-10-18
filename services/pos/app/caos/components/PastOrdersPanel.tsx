import {
  type OrderEntity,
  type WithId,
  assignmentDisplay,
  jstClock,
  orderElapsedTime,
} from "@cafeore/common";
import { useState } from "react";
import { orderNoLabel } from "../logic/cards";
import { CommentList } from "./OrderComments";
import { SidePanel } from "./SidePanels";

const PAGE_SIZE = 20;

/** 提供済みの注文。未提供と同じ、番号・状態・内容・コメントの順で並べる。 */
export function PastOrdersPanel({
  orders,
  onClose,
}: {
  orders: readonly WithId<OrderEntity>[] | undefined;
  onClose: () => void;
}) {
  const [page, setPage] = useState(0);
  const served = (orders ?? [])
    .filter((order) => order.servedAt !== null)
    .sort((a, b) => b.orderId - a.orderId);
  const pages = Math.max(1, Math.ceil(served.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  return (
    <SidePanel title="過去の注文" onClose={onClose}>
      <p className="mb-2 font-bold text-slate-600 text-xs">
        提供済み {served.length}件 · 注文番号の新しい順
      </p>
      <div className="grid gap-1.5">
        {served
          .slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE)
          .map((order) => {
            const cups = order.getCups();
            const elapsed = orderElapsedTime(order);
            return (
              <article
                key={order.id}
                aria-label={`注文 ${orderNoLabel(order.orderId)}`}
                className="rounded-lg border-2 border-slate-300 bg-white p-1.5"
              >
                <header className="flex flex-wrap items-center gap-2">
                  <h3 className="font-black font-mono text-[24px] text-slate-950 leading-none">
                    {orderNoLabel(order.orderId)}
                  </h3>
                  <span className="rounded-md border border-slate-300 bg-slate-50 px-1.5 py-0.5 font-bold text-[12px] text-slate-800">
                    提供済み
                  </span>
                  <span className="font-bold text-[13px] text-slate-600">
                    {cups.length}杯
                  </span>
                  <span
                    className={`font-bold font-mono text-[14px] ${elapsed.overdue ? "text-red-600" : "text-slate-700"}`}
                  >
                    提供まで {elapsed.m}分{elapsed.ss}秒
                  </span>
                </header>
                <p className="mt-1 font-mono text-[12px] text-slate-500">
                  受付 {jstClock(order.createdAt.getTime())} · 提供{" "}
                  {order.servedAt && jstClock(order.servedAt.getTime())}
                </p>
                <ul className="mt-1.5 flex flex-wrap gap-1">
                  {cups.map((cup, index) => (
                    <li
                      key={cup.cupId ?? `${cup.id}:${index}`}
                      className="rounded-md border border-slate-200 bg-slate-100 px-2 py-1 font-bold text-[14px] text-slate-800"
                    >
                      <span title={cup.name}>{cup.abbr}</span>
                      {assignmentDisplay(cup) && (
                        <span className="ml-1 text-[11px] text-slate-600">
                          {assignmentDisplay(cup)}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
                <CommentList
                  className="mt-1.5"
                  comments={order.comments.map((comment) => ({
                    ...comment,
                    orderId: order.id,
                    orderNo: order.orderId,
                  }))}
                />
              </article>
            );
          })}
      </div>
      {orders === undefined ? (
        <p className="py-8 text-center text-slate-500 text-xs">
          注文を読み込み中です
        </p>
      ) : served.length === 0 ? (
        <p className="rounded-md border border-dashed py-8 text-center text-slate-400 text-xs">
          提供済みの注文はありません
        </p>
      ) : (
        pages > 1 && (
          <nav
            aria-label="過去の注文のページ"
            className="mt-3 flex items-center justify-between gap-2 font-bold text-xs"
          >
            <button
              type="button"
              disabled={current === 0}
              onClick={() => setPage(current - 1)}
              className="min-h-10 rounded-md border border-slate-300 px-3 disabled:opacity-40"
            >
              ← 前へ
            </button>
            <span>
              {current + 1} / {pages}
            </span>
            <button
              type="button"
              disabled={current === pages - 1}
              onClick={() => setPage(current + 1)}
              className="min-h-10 rounded-md border border-slate-300 px-3 disabled:opacity-40"
            >
              次へ →
            </button>
          </nav>
        )
      )}
    </SidePanel>
  );
}
