import type { OrderEntity, WithId } from "@cafeore/common";
import { useId, useMemo, useState } from "react";
import { Input } from "~/components/ui/input";
import { OrderDetail, recordTime } from "./OrderDetail";
import {
  filterOrderRecords,
  orderRecordPage,
  orderRecordStatus,
  orderServiceTime,
} from "./orderRecords";

interface OrderListProps {
  orders: WithId<OrderEntity>[] | undefined;
}

const orderRowTone = (order: OrderEntity) => {
  switch (orderRecordStatus(order)) {
    case "キャンセル":
      return "bg-red-50 hover:bg-red-100";
    case "提供済み":
      return "bg-emerald-50 hover:bg-emerald-100";
    case "お渡し待ち":
      return "bg-amber-50 hover:bg-amber-100";
    default:
      return "bg-sky-50 hover:bg-sky-100";
  }
};

/** 選択期間の注文記録。記録の参照のみで、注文や提供状態は変更しない。 */
export function OrderList({ orders }: OrderListProps) {
  const searchId = useId();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("すべて");
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const filtered = useMemo(
    () => filterOrderRecords(orders ?? [], query, status),
    [orders, query, status],
  );
  const { lastPage, shownPage, shown } = orderRecordPage(filtered, page);
  const selected = filtered.find((order) => order.id === selectedId);
  return (
    <section className="space-y-4" aria-label="注文記録">
      <p className="text-sm text-stone-600">
        選択した期間に受けた注文です。キャンセル済みを含み、現在の記録を表示します。
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label htmlFor={searchId} className="min-w-48 flex-1 space-y-1 text-sm">
          <span className="font-bold">注文を探す</span>
          <Input
            id={searchId}
            type="search"
            value={query}
            placeholder="注文番号・商品・指名・コメント"
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(0);
            }}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="block font-bold">状態</span>
          <select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(0);
            }}
            className="min-h-10 rounded-md border bg-white px-3"
          >
            {["すべて", "準備中", "お渡し待ち", "提供済み", "キャンセル"].map(
              (value) => (
                <option key={value}>{value}</option>
              ),
            )}
          </select>
        </label>
        <button
          type="button"
          className="min-h-10 rounded-md border px-3 text-sm"
          onClick={() => {
            setQuery("");
            setStatus("すべて");
            setPage(0);
          }}
        >
          検索をクリア
        </button>
      </div>
      <p aria-live="polite" className="text-sm text-stone-600">
        {orders === undefined
          ? "注文を読み込んでいます…"
          : `${filtered.length}件 / 期間内 ${orders.length}件`}
      </p>
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(20rem,0.9fr)]">
        <div className="min-w-0 space-y-3">
          <div className="max-h-[65vh] overflow-auto rounded-xl border bg-white">
            <table className="w-full whitespace-nowrap text-left text-sm">
              <caption className="sr-only">
                注文の行を選ぶと詳細を表示します
              </caption>
              <thead className="sticky top-0 z-10 bg-stone-100">
                <tr>
                  {[
                    "オーダーNo.",
                    "状態",
                    "杯数",
                    "請求額",
                    "受付",
                    "提供",
                    "提供時間",
                  ].map((label) => (
                    <th key={label} scope="col" className="px-3 py-3">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((order) => (
                  <tr
                    key={order.id}
                    tabIndex={0}
                    aria-selected={selected?.id === order.id}
                    className={`cursor-pointer border-t transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-stone-700 focus-visible:outline-offset-[-2px] ${orderRowTone(order)} ${selected?.id === order.id ? "ring-2 ring-stone-700 ring-inset" : ""}`}
                    onClick={() => setSelectedId(order.id)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      setSelectedId(order.id);
                    }}
                  >
                    <td className="px-5 py-3 font-bold text-stone-900">
                      #{String(order.orderId).padStart(3, "0")}
                    </td>
                    <td
                      className={`px-3 py-2 ${order.isCancelled() ? "text-red-700" : ""}`}
                    >
                      {orderRecordStatus(order)}
                    </td>
                    <td className="px-3 py-2">{order.getCups().length}</td>
                    <td className="px-3 py-2">
                      ¥{order.billingAmount.toLocaleString("ja-JP")}
                    </td>
                    <td className="px-3 py-2">{recordTime(order.createdAt)}</td>
                    <td className="px-3 py-2">{recordTime(order.servedAt)}</td>
                    <td
                      className={`px-3 py-2 tabular-nums ${orderServiceTime(order).overdue ? "font-bold text-red-700" : ""}`}
                    >
                      {orderServiceTime(order).label}
                    </td>
                  </tr>
                ))}
                {orders !== undefined && filtered.length === 0 && (
                  <tr>
                    <td colSpan={7} className="p-6 text-center text-stone-500">
                      該当する注文はありません。検索や期間を変えてください。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <nav
            aria-label="注文一覧のページ"
            className="flex items-center justify-between gap-2 text-sm"
          >
            <button
              type="button"
              disabled={shownPage === 0}
              onClick={() => setPage(shownPage - 1)}
              className="min-h-11 rounded border px-4 disabled:opacity-40"
            >
              前へ
            </button>
            <span>
              {shownPage + 1} / {lastPage + 1} ページ
            </span>
            <button
              type="button"
              disabled={shownPage === lastPage}
              onClick={() => setPage(shownPage + 1)}
              className="min-h-11 rounded border px-4 disabled:opacity-40"
            >
              次へ
            </button>
          </nav>
        </div>
        <div
          className="min-w-0 lg:max-h-[75vh] lg:overflow-y-auto"
          aria-live="polite"
        >
          {selected ? (
            <OrderDetail order={selected} />
          ) : (
            <div className="rounded-xl border border-dashed p-8 text-center text-stone-500">
              注文の行を選ぶと詳細が表示されます。
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
