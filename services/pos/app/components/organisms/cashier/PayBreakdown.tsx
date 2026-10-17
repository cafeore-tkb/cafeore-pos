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
  /** いまの小計の説明（「個別小計 2点 · 残りの商品 ¥700」）。無ければ空 */
  context: string;
  /** 色分けの帯。出さなければ空 */
  bar: BreakdownBarSegment[];
  /** 先会計の行の ×。その小計で受け取った分をまとめて返金する */
  onRefundSubtotal: (subtotalId: number) => void;
  /** 列の下に出すキーの案内 */
  hints: ReactNode;
};

/**
 * 会計中のレジの左の列（商品の一覧の場所）。合計・割引・先会計と決済手段ごとの行、
 * いまの小計の説明、色分けの帯を出す
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
  onRefundSubtotal,
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
              onClick={() => onRefundSubtotal(tender.subtotalId)}
              title="この小計の先払いを取り消す"
              aria-label={`${tenderLabel(tender)} ${formatYen(tender.amount)} の小計の先払いを取り消す`}
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
    <div className="mt-auto">{hints}</div>
  </div>
);
