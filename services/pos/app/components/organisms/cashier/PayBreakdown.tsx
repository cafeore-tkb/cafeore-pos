import type { ReactNode } from "react";
import { cn } from "~/lib/utils";
import { formatYen } from "~/lib/yen";
import type { CashierTender } from "../../functional/cashierSplit";
import { tenderDot, tenderLabel } from "./tenderStyle";

/** 内訳の帯の 1 区切り（受け取った分・今払う分・残り） */
export type BreakdownBarSegment = {
  key: string;
  amount: number;
  color: string;
};

type props = {
  /** 注文の商品の数と合計・割引 */
  itemCount: number;
  total: number;
  discount: number;
  /** 割引の内訳（「（引換券 042）」）。割引が無ければ空 */
  discountNote: string;
  /** 先会計（受け取った額の合計）と、その内訳 */
  prepaid: number;
  tenders: CashierTender[];
  /** いまの小計の説明（「小計 ¥1,100 を分割 · このあと残り ¥800」）。無ければ空 */
  context: string;
  /** 色分けの帯。出さなければ空 */
  bar: BreakdownBarSegment[];
  /** 小計（今払う額） */
  due: number;
  /** 小計分割中なら、あとに回した額（この小計の残り − 今払う額）。分けていなければ null */
  deferred: number | null;
  /** 現金で払うか。Square の決済手段なら、受取金額とお釣りは出さない（—） */
  cash: boolean;
  /** 受取金額（数字だけ）。入れていなければ空 */
  received: string;
  /** 先会計の行の ×。受け取った分をまとめて返金する */
  onRefund: () => void;
  /** 小計分割をやめる */
  onCancelPart: () => void;
  /** 列の下に出すキーの案内 */
  hints: ReactNode;
};

/**
 * 会計中のレジの真ん中の列（商品の列を左に寄せた跡）。合計・割引・先会計と決済手段ごとの行、
 * いまの小計の説明、色分けの帯と、小計・受取金額・お釣りを出す
 */
export const PayBreakdown = ({
  itemCount,
  total,
  discount,
  discountNote,
  prepaid,
  tenders,
  context,
  bar,
  due,
  deferred,
  cash,
  received,
  onRefund,
  onCancelPart,
  hints,
}: props) => (
  <div className="flex min-h-0 flex-col px-5 pt-4 pb-3.5">
    <div className="flex flex-col pt-1">
      <div className="flex flex-col gap-0.5 text-[15px] text-stone-500 tabular-nums leading-[1.6]">
        <div className="flex justify-between">
          <span>{`合計（${itemCount}点）`}</span>
          <span>{formatYen(total)}</span>
        </div>
        <div
          className={cn(
            "flex justify-between",
            discount > 0 && "text-green-700",
          )}
        >
          <span>割引{discountNote}</span>
          <span>{discount > 0 ? formatYen(-discount) : "—"}</span>
        </div>
        <div className="flex justify-between">
          <span>先会計</span>
          <span className={cn(prepaid > 0 && "font-extrabold text-stone-900")}>
            {prepaid > 0 ? formatYen(prepaid) : "—"}
          </span>
        </div>
        {tenders.map((tender) => (
          <div
            key={tender.id}
            className="flex h-7.5 items-center gap-2.25 pl-3.5 text-sm text-stone-700"
          >
            <span
              className="h-2 w-2 flex-none rounded-[2px]"
              style={{ backgroundColor: tenderDot(tender) }}
            />
            <span className="flex-1">{tenderLabel(tender)}</span>
            <span className="font-bold">{formatYen(tender.amount)}</span>
            <button
              type="button"
              onClick={onRefund}
              title="先払いをすべて取り消す"
              aria-label={`${tenderLabel(tender)} ${formatYen(tender.amount)} を含む先払いをすべて取り消す`}
              className="flex h-6.5 w-6.5 items-center justify-center rounded-[5px] hover:bg-stone-100"
            >
              <svg
                width="11"
                height="11"
                viewBox="0 0 14 14"
                aria-hidden="true"
              >
                <path
                  d="M2 2l10 10M12 2L2 12"
                  stroke="#78716c"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
        ))}
      </div>
      {context && (
        <div className="mt-3.5 rounded-lg bg-prepay-soft px-3 py-2.5 font-bold text-[13px] text-prepay-ink leading-normal">
          {context}
        </div>
      )}
      {bar.length > 0 && (
        <div className="mt-3 flex h-1.5 gap-0.5 overflow-hidden rounded-[3px]">
          {bar.map((segment) => (
            <span
              key={segment.key}
              style={{ flex: segment.amount, backgroundColor: segment.color }}
            />
          ))}
        </div>
      )}
    </div>
    <PaySummary
      due={due}
      deferred={deferred}
      cash={cash}
      received={received}
      onCancelPart={onCancelPart}
    />
    <div className="mt-auto">{hints}</div>
  </div>
);

/** 小計・受取金額・お釣り。お釣りはお客さんに伝える額なので一番大きく出す */
const PaySummary = ({
  due,
  deferred,
  cash,
  received,
  onCancelPart,
}: Pick<props, "due" | "deferred" | "cash" | "received" | "onCancelPart">) => {
  const receivedAmount = !cash || received === "" ? null : Number(received);
  const change = receivedAmount === null ? null : receivedAmount - due;
  return (
    <div className="mt-4 flex flex-col border-stone-200 border-t pt-3">
      {deferred !== null && (
        <div className="flex h-7 items-center gap-2 font-bold text-prepay text-sm">
          <span>小計分割</span>
          <button
            type="button"
            onClick={onCancelPart}
            className="h-6 rounded-[5px] border border-stone-200 bg-white px-2 font-bold text-stone-600 text-xs"
          >
            やめる
          </button>
          <span className="flex-1" />
          <span className="font-extrabold text-[15px] tabular-nums">
            {formatYen(-deferred)}
          </span>
        </div>
      )}
      <div className="flex items-baseline gap-1.5">
        <span className="font-extrabold text-[15px]">小計</span>
        {deferred !== null && (
          <span className="self-center rounded-[5px] border border-prepay px-1.5 font-extrabold text-[11px] text-prepay">
            分割
          </span>
        )}
        <span className="flex-1" />
        <span className="font-extrabold text-[32px] tabular-nums leading-[1.25] tracking-[-.01em]">
          {formatYen(due)}
        </span>
      </div>
      <div className="flex items-baseline">
        <span className="font-bold text-[15px] text-stone-600">受取金額</span>
        <span className="flex-1" />
        <span
          className={cn(
            "font-extrabold text-[32px] tabular-nums leading-[1.25] tracking-[-.01em]",
            receivedAmount === null && "text-stone-300",
          )}
        >
          {receivedAmount === null ? "—" : formatYen(receivedAmount)}
        </span>
      </div>
      <div className="mt-3 flex items-baseline border-stone-200 border-t pt-2">
        <span className="font-extrabold text-[15px]">お釣り</span>
        <span className="flex-1" />
        <span
          className={cn(
            "font-black tabular-nums leading-[1.2] tracking-[-.01em]",
            change === null && "text-[44px] text-stone-300",
            change !== null && change >= 0 && "text-[44px] text-stone-900",
            change !== null && change < 0 && "text-[28px] text-red-700",
          )}
        >
          {change === null
            ? "—"
            : change < 0
              ? `不足 ${formatYen(-change)}`
              : formatYen(change)}
        </span>
      </div>
    </div>
  );
};
