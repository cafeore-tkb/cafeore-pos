import {
  AUTHOR_MARKS,
  type OrderEntity,
  type WithId,
  dripperLabel,
  orderElapsedTime,
  orderRepository,
  readableTextColor,
  resolveItemColor,
  squareRepository,
  useColorSettings,
} from "@cafeore/common";
import { ChevronLeftIcon } from "@radix-ui/react-icons";
import dayjs from "dayjs";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { cn } from "~/lib/utils";
import { formatYen } from "~/lib/yen";
import type { ConnectionIssue } from "../../functional/connectionIssues";
import { useCurrentTime } from "../../functional/useCurrentTime";
import { SquareRefundButton } from "../../molecules/SquareRefundButton";
import { squarePaymentTypeLabel } from "../SquarePaymentDialog";
import { ConnectionIssueDot } from "./PrinterStatusDot";

type props = {
  /** 出す注文。新しい順に並べる */
  orders: WithId<OrderEntity>[] | undefined;
  /** つながっていないもの。見出しの右に出す */
  connectionIssues: ConnectionIssue[];
  /** Square で払った注文に返金のボタン（注文を消す・残す）と返金の状態を出す */
  squareRefundable: boolean;
  /** 領収書を刷る。プリンターに送れたら true */
  onPrintFormalReceipt: (order: OrderEntity) => Promise<boolean>;
  /** レジに戻る */
  onBack: () => void;
};

const STATUS: Record<
  OrderEntity["status"],
  { text: string; className: string }
> = {
  served: { text: "提供済", className: "bg-stone-200 text-stone-700" },
  calling: { text: "提供待ち", className: "bg-yellow-100 text-yellow-700" },
  preparing: { text: "未提供", className: "bg-orange-100 text-orange-700" },
};

const REFUND_TAG: Partial<
  Record<NonNullable<OrderEntity["squareRefundStatus"]>, string>
> = {
  pending: "・返金待ち",
  refunded: "・返金済み",
  failed: "・返金失敗",
  unknown: "・返金確認中",
};

const paymentText = (order: OrderEntity) =>
  order.payments.length > 0
    ? `個別会計 ${order.payments.length}回`
    : order.paymentMethod === "square"
      ? "Square"
      : "現金";

/** 個別会計の支払いの決済手段（「現金」「カード」など） */
const splitPaymentText = (payment: OrderEntity["payments"][number]) =>
  payment.method === "cash"
    ? "現金"
    : ((payment.squarePaymentType &&
        squarePaymentTypeLabel[
          payment.squarePaymentType as keyof typeof squarePaymentTypeLabel
        ]) ??
      "Square");

/** 割引の内訳。番号の無い 1 杯分の割引は特殊な割引 */
const discountNote = (order: OrderEntity) => {
  if (order.discount === 0) return "";
  return order.discountOrderId !== null
    ? `（引換券 ${order.discountOrderId}）`
    : "（特殊な割引）";
};

/**
 * レジの「過去の注文」の画面。左に一覧（番号で探せる）、右に選んだ注文の詳細
 * （商品・コメント・会計・領収書・Square の返金）
 *
 * ↑↓ で選び、Esc でレジに戻る。
 */
export const PastOrdersView = ({
  orders,
  connectionIssues,
  squareRefundable,
  onPrintFormalReceipt,
  onBack,
}: props) => {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const sorted = useMemo(
    () => (orders ?? []).slice().sort((a, b) => b.orderId - a.orderId),
    [orders],
  );
  const rows = useMemo(
    () =>
      query === ""
        ? sorted
        : sorted.filter((order) => String(order.orderId).includes(query)),
    [sorted, query],
  );
  // 選んでいた注文が絞り込みで外れたら、一番上を選ぶ
  const selected =
    rows.find((order) => order.id === selectedId) ?? rows[0] ?? null;

  useEffect(() => {
    if (!selected) return;
    listRef.current
      ?.querySelector(`[data-row="${selected.id}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest("[role='dialog'], [role='alertdialog']")
      ) {
        return;
      }
      const typing =
        target instanceof HTMLElement &&
        target.closest("input, textarea") !== null;
      const arrow = event.key === "ArrowUp" || event.key === "ArrowDown";
      if (typing) {
        if (event.key === "Escape") {
          event.preventDefault();
          (target as HTMLElement).blur();
          return;
        }
        // 番号で探す欄からは、そのまま ↑↓ で選べる
        if (!(arrow && target.dataset.pastSearch !== undefined)) return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        onBack();
        return;
      }
      if (arrow && rows.length > 0) {
        event.preventDefault();
        const index = selected ? rows.indexOf(selected) : -1;
        const step = event.key === "ArrowDown" ? 1 : -1;
        const next = Math.max(0, Math.min(rows.length - 1, index + step));
        setSelectedId(rows[next].id);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [rows, selected, onBack]);

  return (
    <>
      <div className="flex h-14 flex-none items-center gap-3.5 border-stone-200 border-b pr-5 pl-3">
        <button
          type="button"
          onClick={onBack}
          className="flex h-11 items-center gap-1.5 rounded-lg border border-stone-300 bg-white pr-3.5 pl-2.5 font-bold text-sm hover:bg-stone-50"
        >
          <ChevronLeftIcon className="h-4 w-4" />
          レジに戻る
        </button>
        <span className="font-extrabold text-xl">過去の注文</span>
        <span className="text-[13px] text-stone-500">{sorted.length}件</span>
        <span className="ml-auto flex items-center gap-3.5 text-[13px]">
          {connectionIssues.map((issue) => (
            <ConnectionIssueDot key={issue.key} issue={issue} />
          ))}
        </span>
        <span className="text-stone-400 text-xs">
          ↑ ↓ で選ぶ ・ Esc でレジに戻る
        </span>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[520px_minmax(0,1fr)]">
        <div className="flex min-h-0 flex-col border-stone-200 border-r bg-stone-50">
          <div className="flex-none border-stone-200 border-b p-3">
            <div className="flex h-11 items-center gap-1.5 rounded-[10px] border border-stone-300 bg-white pr-1 pl-3">
              <span className="font-extrabold text-[13px] text-stone-500">
                No.
              </span>
              <input
                data-past-search
                aria-label="番号で探す"
                inputMode="numeric"
                value={query}
                onChange={(e) => setQuery(e.target.value.replace(/\D/g, ""))}
                placeholder="番号で探す"
                className="h-10 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-stone-400"
              />
              {query && (
                <button
                  type="button"
                  aria-label="クリア"
                  onClick={() => setQuery("")}
                  className="h-9 w-9 rounded-lg bg-stone-100 text-base text-stone-600"
                >
                  ×
                </button>
              )}
            </div>
          </div>
          <div
            ref={listRef}
            className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-auto px-3 pt-2 pb-3"
          >
            {rows.map((order) => (
              <OrderRow
                key={order.id}
                order={order}
                selected={order === selected}
                onSelect={() => setSelectedId(order.id)}
              />
            ))}
            {rows.length === 0 && (
              <div className="py-10 text-center text-sm text-stone-400">
                該当する注文はありません
              </div>
            )}
          </div>
        </div>
        {selected ? (
          <OrderDetail
            // 注文を変えたら、書きかけのコメントを消す
            key={selected.id}
            order={selected}
            squareRefundable={squareRefundable}
            onPrintFormalReceipt={onPrintFormalReceipt}
          />
        ) : (
          <div className="flex items-center justify-center text-[15px] text-stone-400">
            左の一覧から注文を選んでください
          </div>
        )}
      </div>
    </>
  );
};

const OrderRow = ({
  order,
  selected,
  onSelect,
}: {
  order: WithId<OrderEntity>;
  selected: boolean;
  onSelect: () => void;
}) => {
  const status = STATUS[order.status];
  const refundTag =
    order.squareRefundStatus && REFUND_TAG[order.squareRefundStatus];
  return (
    <button
      type="button"
      data-row={order.id}
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        "grid min-h-15 flex-none grid-cols-[84px_44px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-[10px] px-3 py-1.5 text-left",
        selected
          ? "bg-orange-50 shadow-[inset_0_0_0_3px_var(--color-orange-600)]"
          : "bg-white shadow-[inset_0_0_0_1px_var(--color-stone-200)]",
      )}
    >
      <span className="flex items-baseline gap-px font-black">
        <span className="text-[11px]">No.</span>
        <span className="text-[26px] leading-none">{order.orderId}</span>
      </span>
      <span className="flex flex-col text-[13px] tabular-nums">
        <span className="text-stone-600">
          {dayjs(order.createdAt).format("H:mm")}
        </span>
        <span className="font-bold">{order.getCups().length}杯</span>
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-bold text-sm">
          {order
            .getItems()
            .map((item) => item.abbr)
            .join("・")}
        </span>
        <span
          className={cn(
            "truncate text-xs tabular-nums",
            order.squareRefundStatus === "failed" ||
              order.squareRefundStatus === "unknown"
              ? "text-red-700"
              : "text-stone-500",
          )}
        >
          {formatYen(order.billingAmount)}　{paymentText(order)}
          {refundTag}
        </span>
      </span>
      <span
        className={cn(
          "whitespace-nowrap rounded-full px-2 py-1 font-bold text-xs",
          status.className,
        )}
      >
        {status.text}
      </span>
    </button>
  );
};

const OrderDetail = ({
  order,
  squareRefundable,
  onPrintFormalReceipt,
}: {
  order: WithId<OrderEntity>;
  squareRefundable: boolean;
  onPrintFormalReceipt: (order: OrderEntity) => Promise<boolean>;
}) => {
  const { colorSettings } = useColorSettings();
  const [comment, setComment] = useState("");
  // 提供までの時間（まだならいままで）を進める
  const now = useCurrentTime(1000);
  const status = STATUS[order.status];
  const elapsed = orderElapsedTime(order, now);
  const refundStatus = order.squareRefundStatus;
  const canRefund =
    squareRefundable &&
    order.paymentMethod === "square" &&
    refundStatus !== "pending" &&
    refundStatus !== "refunded";
  // 個別会計で返金するのは Square で払った分だけ（現金で払った分は手で返す）
  const squarePayments = order.payments.filter(
    (payment) => payment.method === "square",
  );
  const label =
    order.payments.length > 0
      ? `No.${order.orderId} の Square の支払い ${squarePayments.length}件（${formatYen(
          squarePayments.reduce((acc, payment) => acc + payment.amount, 0),
        )}）`
      : `No.${order.orderId}（${formatYen(order.billingAmount)}）`;

  const addComment = () => {
    const text = comment.trim();
    if (!text) return;
    setComment("");
    orderRepository.addComment(order.id, "cashier", text).catch((error) => {
      setComment(text);
      toast.error(
        `コメントを追加できませんでした: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  };

  const printFormalReceipt = async () => {
    if (await onPrintFormalReceipt(order)) {
      toast(`No.${order.orderId} の領収書を印刷しました`);
    } else {
      toast.error(
        "レシート用のプリンターにつながっていないため、領収書を印刷できません",
      );
    }
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-col">
      <div className="flex flex-none items-end gap-4.5 border-stone-200 border-b px-6 pt-3.5 pb-3">
        <span className="flex items-baseline gap-0.5 font-black">
          <span className="text-base">No.</span>
          <span className="text-[56px] leading-none">{order.orderId}</span>
        </span>
        <span className="flex flex-col gap-0.5 pb-1 text-sm tabular-nums">
          <span className="text-stone-600">
            受付 {dayjs(order.createdAt).format("H:mm")}
          </span>
          <span className="font-bold">{order.getCups().length}杯</span>
        </span>
        <span className="ml-auto flex items-center gap-2 pb-1.5">
          <span
            className={cn(
              "rounded-full px-2.5 py-1.25 font-bold text-[13px]",
              status.className,
            )}
          >
            {status.text}
          </span>
          <span
            className={cn(
              "rounded-lg px-2.5 py-1.25 font-bold text-sm tabular-nums",
              elapsed.overdue
                ? "bg-red-500 text-white"
                : "bg-slate-100 text-slate-700",
            )}
          >
            {order.servedAt === null
              ? "未提供"
              : `${elapsed.m}分${elapsed.ss}秒`}
          </span>
        </span>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_280px] content-start gap-6 overflow-auto px-6 py-4">
        <div className="flex min-w-0 flex-col gap-3">
          <div className="font-bold text-[13px] text-stone-600">商品</div>
          <div className="grid grid-cols-3 gap-2">
            {order.getItems().map((item, index) => {
              const color = resolveItemColor(
                colorSettings,
                item,
                "cashier_order",
              );
              const assign = [
                item.dripper !== null ? dripperLabel(item.dripper) : "",
                item.assignee ?? "",
              ]
                .filter(Boolean)
                .join("・");
              return (
                <div
                  key={`${index}-${item.id}`}
                  className={cn(
                    "flex min-h-16 flex-col items-center justify-center gap-0.5 rounded-[10px] border px-2.5 py-2",
                    color === undefined && "border-stone-300 bg-white",
                  )}
                  style={
                    color === undefined
                      ? undefined
                      : {
                          backgroundColor: color,
                          borderColor: color,
                          color: readableTextColor(color),
                        }
                  }
                >
                  <span className="font-extrabold text-[22px] leading-tight">
                    {item.abbr}
                  </span>
                  {assign && (
                    <span className="font-bold text-xs">指名:{assign}</span>
                  )}
                </div>
              );
            })}
          </div>
          <div className="mt-1.5 font-bold text-[13px] text-stone-600">
            コメント
          </div>
          {order.comments.map((c, index) => (
            <div
              key={`${index}-${c.author}`}
              className="flex items-start gap-2.5 rounded-lg bg-stone-100 px-2.5 py-2"
            >
              <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-stone-900 font-extrabold text-white text-xs">
                {AUTHOR_MARKS[c.author]}
              </span>
              <span className="whitespace-pre-wrap text-[15px] leading-relaxed">
                {c.text}
              </span>
            </div>
          ))}
          <div className="flex gap-2">
            <input
              aria-label="コメント"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  addComment();
                }
              }}
              placeholder="コメントを追加"
              className="h-11 min-w-0 flex-1 rounded-lg border border-stone-300 bg-white px-3 text-[15px] outline-none placeholder:text-stone-400 focus:border-theme-primary"
            />
            <button
              type="button"
              onClick={addComment}
              disabled={!comment.trim()}
              className="h-11 rounded-lg bg-stone-900 px-4 font-bold text-sm text-white disabled:opacity-40"
            >
              追加
            </button>
          </div>
        </div>
        <div className="flex flex-col gap-1 self-start rounded-xl bg-stone-50 px-4 py-3.5 tabular-nums shadow-[inset_0_0_0_1px_var(--color-stone-200)]">
          <div className="flex justify-between text-[13px] text-stone-500">
            <span>合計</span>
            <span>{formatYen(order.total)}</span>
          </div>
          <div
            className={cn(
              "flex justify-between text-[13px]",
              order.discount > 0 ? "text-green-700" : "text-stone-400",
            )}
          >
            <span>割引{discountNote(order)}</span>
            <span>{order.discount > 0 ? formatYen(-order.discount) : "—"}</span>
          </div>
          <div className="flex items-baseline justify-between border-stone-200 border-b pb-2">
            <span className="font-bold text-[15px]">小計</span>
            <span className="font-extrabold text-[26px]">
              {formatYen(order.billingAmount)}
            </span>
          </div>
          <div className="flex justify-between pt-1.5 text-sm">
            <span className="text-stone-600">支払い</span>
            <span
              className={cn(
                "font-bold",
                order.paymentMethod === "square" &&
                  order.payments.length === 0 &&
                  "text-sky-800",
              )}
            >
              {paymentText(order)}
            </span>
          </div>
          {order.payments.length > 0 && <SplitPayments order={order} />}
          {order.payments.length === 0 && order.paymentMethod !== "square" && (
            <>
              <div className="flex justify-between text-sm">
                <span className="text-stone-600">お預り</span>
                <span>{formatYen(order.received)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-stone-600">お釣り</span>
                <span>{formatYen(order.getCharge())}</span>
              </div>
            </>
          )}
          {order.paymentMethod === "square" && (
            <RefundNote status={refundStatus} />
          )}
        </div>
      </div>
      <div className="flex flex-none items-center gap-2.5 border-stone-200 border-t px-6 py-3">
        <button
          type="button"
          onClick={() => void printFormalReceipt()}
          className="h-12 rounded-[10px] border border-stone-400 bg-white px-5 font-bold text-[15px] hover:bg-stone-50"
        >
          領収書を印刷
        </button>
        {canRefund && (
          <div className="ml-auto flex gap-2.5">
            <SquareRefundButton
              label={label}
              orderOnRefund="keep"
              refund={() => squareRepository.refundOrderKeepingOrder(order.id)}
              triggerClassName="h-12 rounded-[10px] border-red-700 px-4.5 font-bold text-red-700 text-sm hover:bg-red-50 hover:text-red-700"
            >
              返金（キャンセルしない）
            </SquareRefundButton>
            <SquareRefundButton
              label={label}
              orderOnRefund="delete"
              refund={() => squareRepository.refundOrder(order.id)}
              triggerClassName="h-12 rounded-[10px] border-0 bg-red-500 px-5.5 font-bold text-[15px] text-white hover:bg-red-600 hover:text-white"
            />
          </div>
        )}
      </div>
    </div>
  );
};

/** 個別会計の支払いの内訳（払った順） */
const SplitPayments = ({ order }: { order: OrderEntity }) => (
  <div className="mt-1 flex flex-col gap-1.5">
    {order.payments.map((payment, index) => (
      <div
        // biome-ignore lint/suspicious/noArrayIndexKey: 払った順は変わらない
        key={index}
        className="flex flex-col gap-0.5 rounded-lg bg-white px-2.5 py-1.5 text-sm shadow-[inset_0_0_0_1px_var(--color-stone-200)]"
      >
        <div className="flex items-baseline gap-2">
          <span className="text-stone-500 text-xs">{index + 1}.</span>
          <span
            className={cn(
              "font-bold",
              payment.method === "square" && "text-sky-800",
            )}
          >
            {splitPaymentText(payment)}
          </span>
          {payment.squareRefundStatus &&
            REFUND_TAG[payment.squareRefundStatus] && (
              <span
                className={cn(
                  "text-xs",
                  payment.squareRefundStatus === "failed" ||
                    payment.squareRefundStatus === "unknown"
                    ? "text-red-700"
                    : "text-stone-500",
                )}
              >
                {REFUND_TAG[payment.squareRefundStatus]?.replace("・", "")}
              </span>
            )}
          <span className="ml-auto font-bold">{formatYen(payment.amount)}</span>
        </div>
        <span className="truncate text-stone-600 text-xs">
          {payment.menuIndexes
            .map((menuIndex) => order.menus[menuIndex]?.name)
            .filter(Boolean)
            .join("・")}
        </span>
        {(payment.method === "cash" || payment.discount > 0) && (
          <span className="text-stone-500 text-xs">
            {[
              payment.discount > 0 && `割引 ${formatYen(-payment.discount)}`,
              payment.method === "cash" &&
                `お預り ${formatYen(payment.received)}・お釣り ${formatYen(payment.received - payment.amount)}`,
            ]
              .filter(Boolean)
              .join("・")}
          </span>
        )}
      </div>
    ))}
    {order.paymentMethod === "square" &&
      order.payments.some((payment) => payment.method === "cash") && (
        <p className="text-stone-500 text-xs leading-normal">
          返金するのは Square
          で払った分だけです。現金で払った分は手で返してください
        </p>
      )}
  </div>
);

const RefundNote = ({
  status,
}: {
  status: OrderEntity["squareRefundStatus"];
}) => {
  switch (status) {
    case "pending":
      return (
        <p className="mt-1.5 text-stone-600 text-xs leading-normal">
          返金を受け付けました（Square で処理されると返金済みになります）
        </p>
      );
    case "refunded":
      return (
        <p className="mt-1.5 font-bold text-stone-600 text-xs">返金済み</p>
      );
    case "failed":
      return (
        <p className="mt-1.5 text-red-700 text-xs leading-normal">
          返金できませんでした。もう一度返金してください
        </p>
      );
    case "unknown":
      return (
        <p className="mt-1.5 text-red-700 text-xs leading-normal">
          返金できたか確かめられていません。もう一度返金を押すと確かめます（二重には返金されません）
        </p>
      );
    default:
      return null;
  }
};
