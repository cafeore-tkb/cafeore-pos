import { useColorSettings } from "@cafeore/common";
import { ArrowDownIcon } from "@radix-ui/react-icons";
import { useEffect, useRef } from "react";
import { KeyHint } from "~/components/atoms/KeyHint";
import { cn } from "~/lib/utils";
import { formatYen } from "~/lib/yen";
import type { CashierDraft, CashierLine } from "../../functional/cashierDraft";
import {
  type SplitBill,
  coffeeCupsOf,
  splitPaidLines,
  splitUpperLines,
} from "../../functional/cashierSplit";
import { menuColor } from "./MenuPanel";

type props = {
  draft: CashierDraft;
  /** 今回の会計（下の枠）の金額と、割引の割り振り */
  bill: SplitBill;
  /** 1 杯の割引額 */
  discountPerCup: number;
  /** 割引があるか。あれば「割引をここに」を出す */
  hasDiscount: boolean;
  /** 会計の段階。灰色にして押せなくする */
  disabled: boolean;
  onToggle: (key: number) => void;
  onPickAll: () => void;
  onPreferDiscount: (key: number) => void;
};

/**
 * 個別会計のときのレジの左の列。注文の商品を上下 2 つの枠に分けて出す
 *
 * 上の枠はまだ払っていない商品、下の枠は今回の会計で払う商品（小計するもの）。
 * 押すと上下の枠の間を動く。下の枠の小計を真ん中の列の「この分を会計」で払う。
 */
export const SplitPanel = ({
  draft,
  bill,
  discountPerCup,
  hasDiscount,
  disabled,
  onToggle,
  onPickAll,
  onPreferDiscount,
}: props) => {
  const listRef = useRef<HTMLDivElement>(null);
  const upper = splitUpperLines(draft);
  const paid = splitPaidLines(draft);
  const cursor = draft.split?.cursor ?? null;
  const paymentCount = draft.split?.payments.length ?? 0;

  // ↑↓ で選んだ行が見えるようにする
  useEffect(() => {
    if (cursor === null) return;
    listRef.current
      ?.querySelector(`[data-split-line="${cursor}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const row = (line: CashierLine) => (
    <SplitLineRow
      key={line.key}
      line={line}
      number={draft.lines.indexOf(line) + 1}
      cursor={cursor === line.key}
      discount={(bill.allocation.get(line.key) ?? 0) * discountPerCup}
      canPreferDiscount={
        hasDiscount &&
        !disabled &&
        !bill.allocation.has(line.key) &&
        coffeeCupsOf(line.menu) > 0
      }
      disabled={disabled}
      onToggle={onToggle}
      onPreferDiscount={onPreferDiscount}
    />
  );

  return (
    <div
      ref={listRef}
      aria-disabled={disabled}
      className={cn(
        "flex min-h-0 flex-col gap-2.5 px-5 pt-3.5 pb-3 transition-opacity duration-150",
        disabled && "pointer-events-none opacity-35 grayscale",
      )}
    >
      <div className="flex flex-none items-baseline gap-3 whitespace-nowrap">
        <span className="flex-none font-extrabold text-lg">個別会計</span>
        <span className="min-w-0 flex-1 truncate text-[13px] text-stone-500">
          押した商品が下の枠に入ります（もう一度押すと上に戻ります）
        </span>
        {paymentCount > 0 && (
          <span className="flex-none font-bold text-[13px] text-stone-600 tabular-nums">
            会計済み {paymentCount}回・{paid.length}点・
            {formatYen(bill.paidAmount)}
          </span>
        )}
      </div>

      <section className="flex min-h-0 flex-1 flex-col gap-2 rounded-xl bg-stone-50 px-3 pt-2.5 pb-3 shadow-[inset_0_0_0_1px_var(--color-stone-200)]">
        <div className="flex flex-none items-center gap-2.5 pl-0.5">
          <span className="font-bold text-[15px]">まだ払っていない商品</span>
          <span className="text-sm text-stone-600">{upper.length}点</span>
          <button
            type="button"
            onClick={onPickAll}
            disabled={upper.length === 0}
            className="ml-auto h-10 rounded-lg border border-stone-400 bg-white px-3.5 font-bold text-[13px] disabled:opacity-40"
          >
            残りを全部下へ
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-auto">
          {upper.map(row)}
          {upper.length === 0 && (
            <div className="flex flex-1 items-center justify-center text-sm text-stone-400">
              {paid.length > 0 && bill.lines.length === 0
                ? "全部払いました"
                : "残りは全部下の枠に入っています"}
            </div>
          )}
        </div>
      </section>

      <div className="flex flex-none items-center justify-center gap-1.5 text-orange-700 text-xs">
        <ArrowDownIcon className="h-4 w-4" />
        小計する商品を下の枠へ
      </div>

      <section className="flex min-h-0 flex-1 flex-col gap-2 rounded-xl bg-orange-50/60 px-3 pt-2.5 pb-3 shadow-[inset_0_0_0_2px_var(--color-orange-600)]">
        <div className="flex flex-none items-center gap-2.5 pl-0.5">
          <span className="font-bold text-[15px]">この会計で払う商品</span>
          <span className="text-sm text-stone-600">{bill.lines.length}点</span>
          {bill.last && (
            <span className="rounded bg-stone-900 px-1.5 py-0.5 font-bold text-white text-xs">
              最後の会計
            </span>
          )}
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-auto">
          {bill.lines.map(row)}
          {bill.lines.length === 0 && (
            <div className="flex flex-1 items-center justify-center text-sm text-stone-400">
              上の枠から、この会計で払う商品をタップ
            </div>
          )}
        </div>
        <div className="flex flex-none flex-col gap-px border-orange-200 border-t pt-1.5 tabular-nums">
          {bill.discount > 0 && (
            <>
              <div className="flex justify-between text-[13px] text-stone-500">
                <span>合計</span>
                <span>{formatYen(bill.total)}</span>
              </div>
              <div className="flex justify-between text-[13px] text-green-700">
                <span>割引</span>
                <span>{formatYen(-bill.discount)}</span>
              </div>
            </>
          )}
          <div className="flex items-baseline justify-between">
            <span className="font-bold text-[15px]">小計</span>
            <span className="font-extrabold text-2xl">
              {formatYen(bill.amount)}
            </span>
          </div>
        </div>
      </section>

      <div className="flex flex-none flex-wrap gap-x-4.5 gap-y-1.5 text-stone-500 text-xs">
        <span>↑ ↓ 商品を選ぶ・Space で上下の枠へ</span>
        <span>Enter 下の枠を会計</span>
        <span>Esc 取消</span>
      </div>
    </div>
  );
};

const SplitLineRow = ({
  line,
  number,
  cursor,
  discount,
  canPreferDiscount,
  disabled,
  onToggle,
  onPreferDiscount,
}: {
  line: CashierLine;
  /** 真ん中の列の商品と同じ番号 */
  number: number;
  /** ↑↓ で選んでいる */
  cursor: boolean;
  /** この行に割り振った割引の額 */
  discount: number;
  canPreferDiscount: boolean;
  disabled: boolean;
  onToggle: (key: number) => void;
  onPreferDiscount: (key: number) => void;
}) => {
  const { colorSettings } = useColorSettings();
  return (
    <div
      data-split-line={line.key}
      className={cn(
        "flex flex-none items-stretch rounded-lg",
        cursor
          ? "bg-orange-50 shadow-[inset_0_0_0_3px_var(--color-orange-600)]"
          : "bg-white shadow-[inset_0_0_0_1px_var(--color-stone-200)]",
      )}
    >
      <button
        type="button"
        onClick={() => onToggle(line.key)}
        disabled={disabled}
        className="flex min-h-12 min-w-0 flex-1 items-center gap-2 pr-3 pl-2.5 text-left"
      >
        <span className="w-4 flex-none text-right font-mono text-stone-400 text-xs">
          {number}
        </span>
        <span
          className="h-2 w-2 flex-none rounded-full"
          style={{
            backgroundColor: menuColor(colorSettings, line.menu) ?? "#a8a29e",
          }}
        />
        <span className="min-w-0 flex-1 truncate font-bold text-[15px]">
          {line.menu.name}
        </span>
        {discount > 0 && (
          <span className="flex-none rounded bg-green-50 px-1.5 py-0.5 font-bold text-green-700 text-xs tabular-nums">
            割引 {formatYen(-discount)}
          </span>
        )}
        <span className="flex-none font-medium text-[15px] tabular-nums">
          {formatYen(line.menu.price)}
        </span>
      </button>
      {canPreferDiscount && (
        <button
          type="button"
          onClick={() => onPreferDiscount(line.key)}
          title="割引をこの商品に付け替えます"
          className="my-1.5 mr-1.5 flex-none rounded-md border border-green-700 bg-white px-2 font-bold text-green-700 text-xs"
        >
          割引をここに
        </button>
      )}
      {cursor && !disabled && (
        <KeyHint className="my-auto mr-2 flex-none">Space</KeyHint>
      )}
    </div>
  );
};
