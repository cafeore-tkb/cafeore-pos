import type { SquarePaymentType } from "@cafeore/common";
import { EnterIcon } from "@radix-ui/react-icons";
import { KeyHint } from "~/components/atoms/KeyHint";
import { cn } from "~/lib/utils";
import { formatYen } from "~/lib/yen";
import {
  type CashierDraft,
  canInputCoupon,
} from "../../functional/cashierDraft";
import { squarePaymentTypeLabel } from "../SquarePaymentDialog";

type props = {
  draft: CashierDraft;
  /** 削除していない商品の数と合計 */
  itemCount: number;
  total: number;
  discount: number;
  /** 割引の内訳（「（引換券 042）」「（特殊な割引）」）。割引が無ければ空 */
  discountNote: string;
  billing: number;
  /** 出す Square の決済手段。Square を使わないレジでは空 */
  squarePaymentTypes: readonly SquarePaymentType[];
  /** Square で決済を始められるか（つながっている・商品がある） */
  canStartSquare: boolean;
  /** 注文を送れるか（つながっている、または番号を手で付けた） */
  canSubmit: boolean;
  onCash: () => void;
  onSquare: (paymentType: SquarePaymentType) => void;
  onDigits: (digits: string) => void;
  onDeleteDigit: () => void;
  onClearDigits: () => void;
  onAddReceived: (amount: number) => void;
  onExactReceived: () => void;
  onSubmitExact: () => void;
  onSubmitCash: () => void;
};

const QUICK_AMOUNTS = [
  { label: "+1千", amount: 1000 },
  { label: "+2千", amount: 2000 },
  { label: "+5千", amount: 5000 },
  { label: "+1万", amount: 10000 },
];

type PadKey = {
  label: string;
  column: string;
  row: string;
  kind: "digit" | "function" | "amount";
};

const PAD_KEYS: PadKey[] = [
  { label: "1", column: "1", row: "1", kind: "digit" },
  { label: "2", column: "2", row: "1", kind: "digit" },
  { label: "3", column: "3", row: "1", kind: "digit" },
  { label: "⌫", column: "4", row: "1", kind: "function" },
  { label: "4", column: "1", row: "2", kind: "digit" },
  { label: "5", column: "2", row: "2", kind: "digit" },
  { label: "6", column: "3", row: "2", kind: "digit" },
  { label: "C", column: "4", row: "2", kind: "function" },
  { label: "7", column: "1", row: "3", kind: "digit" },
  { label: "8", column: "2", row: "3", kind: "digit" },
  { label: "9", column: "3", row: "3", kind: "digit" },
  { label: "+1万", column: "4", row: "3 / span 2", kind: "amount" },
  { label: "0", column: "1 / span 2", row: "4", kind: "digit" },
  { label: "00", column: "3", row: "4", kind: "digit" },
];

/**
 * レジの右の列。小計、決済手段、受取金額（テンキー）、お釣り、確定
 *
 * テンキーは、入れる段階では引換券番号、会計の段階では受取金額に打つ。
 */
export const PayPanel = ({
  draft,
  itemCount,
  total,
  discount,
  discountNote,
  billing,
  squarePaymentTypes,
  canStartSquare,
  canSubmit,
  onCash,
  onSquare,
  onDigits,
  onDeleteDigit,
  onClearDigits,
  onAddReceived,
  onExactReceived,
  onSubmitExact,
  onSubmitCash,
}: props) => {
  const paying = draft.step === "pay";
  const cash = draft.payment === "cash";
  const received = draft.received === "" ? null : Number(draft.received);
  const change = received === null ? null : received - billing;
  const cashReady =
    paying && canSubmit && itemCount > 0 && change !== null && change >= 0;
  const exactReady = paying && canSubmit && itemCount > 0 && billing >= 0;
  const padEnabled = paying || canInputCoupon(draft);
  // Enter で押すボタン。現金で受取金額が空ならちょうど、入っていれば確定
  const enterExact = paying && cash && received === null;
  const enterSubmit = paying && cash && received !== null;

  return (
    <div className="flex min-h-0 flex-col border-stone-200 border-l">
      <div className="flex min-h-0 flex-1 flex-col gap-2 px-4 pt-2.5 pb-2">
        <div className="flex flex-col gap-px border-stone-200 border-b pb-1 tabular-nums">
          <div className="flex justify-between text-[13px] text-stone-500">
            <span>{itemCount > 0 ? `合計（${itemCount}点）` : "合計"}</span>
            <span>{formatYen(total)}</span>
          </div>
          <div
            className={cn(
              "flex justify-between text-[13px]",
              discount > 0 ? "text-green-700" : "text-stone-400",
            )}
          >
            <span>割引{discountNote}</span>
            <span>{discount > 0 ? formatYen(-discount) : "—"}</span>
          </div>
          <div className="flex justify-between text-[13px] text-stone-400">
            <span>先会計</span>
            <span>—</span>
          </div>
          <div className="flex items-baseline justify-between">
            <span className="font-bold text-[15px]">小計</span>
            <span className="font-extrabold text-[26px]">
              {formatYen(billing)}
            </span>
          </div>
        </div>

        <div
          className={cn(
            "flex items-center gap-1.5",
            !paying && "pointer-events-none opacity-35",
          )}
        >
          <div className="relative min-w-0 flex-1">
            <button
              type="button"
              aria-pressed={cash}
              onClick={onCash}
              disabled={!paying}
              className={cn(
                "h-14 w-full rounded-[10px] font-extrabold text-[17px]",
                cash
                  ? "bg-orange-50 text-orange-700 shadow-[inset_0_0_0_2px_var(--color-orange-600)]"
                  : "bg-white text-stone-700 shadow-[inset_0_0_0_1px_var(--color-stone-300)]",
              )}
            >
              現金
            </button>
            {cash && (
              <span className="-bottom-2 -translate-x-1/2 absolute left-1/2 h-0 w-0 border-t-[9px] border-t-orange-600 border-r-[9px] border-r-transparent border-l-[9px] border-l-transparent" />
            )}
          </div>
          {squarePaymentTypes.map((paymentType) => {
            const selected = paying && draft.payment === paymentType;
            return (
              <button
                key={paymentType}
                type="button"
                onClick={() => onSquare(paymentType)}
                disabled={!paying || !canStartSquare}
                className={cn(
                  "h-14 min-w-0 flex-1 rounded-[10px] font-bold text-base text-white",
                  canStartSquare
                    ? "bg-sky-800 hover:brightness-110"
                    : "cursor-not-allowed bg-stone-400",
                  selected &&
                    "shadow-[inset_0_0_0_3px_var(--color-orange-600),0_0_0_2px_var(--color-orange-300)]",
                )}
              >
                {squarePaymentTypeLabel[paymentType]}
              </button>
            );
          })}
        </div>

        <div
          className={cn(
            "-mb-1 text-[13px] text-stone-600",
            !paying && "opacity-35",
          )}
        >
          受取金額
        </div>
        <div
          className={cn(
            "flex h-11 items-center justify-end gap-2 rounded-xl bg-white px-4.5",
            !paying && "opacity-35",
          )}
          style={{
            boxShadow:
              paying && cash
                ? "inset 0 0 0 2px var(--color-orange-600)"
                : "inset 0 0 0 1px var(--color-stone-300)",
          }}
        >
          <span className="font-bold text-stone-500 text-xl">¥</span>
          <span
            className={cn(
              "font-extrabold text-3xl tabular-nums leading-none",
              received === null ? "text-stone-300" : "text-stone-900",
            )}
          >
            {(received ?? 0).toLocaleString("ja-JP")}
          </span>
        </div>
        <div
          className={cn(
            "grid grid-cols-5 gap-1.5",
            !paying && "pointer-events-none opacity-35",
          )}
        >
          <QuickButton
            label="ちょうど"
            dim={false}
            enter={enterExact}
            disabled={!paying}
            onClick={onExactReceived}
          />
          {QUICK_AMOUNTS.map(({ label, amount }) => (
            <QuickButton
              key={label}
              label={label}
              dim={amount < billing}
              enter={false}
              disabled={!paying}
              onClick={() => onAddReceived(amount)}
            />
          ))}
        </div>

        <div
          className={cn(
            "grid min-h-0 flex-1 grid-cols-4 grid-rows-[repeat(4,minmax(44px,1fr))] gap-2",
            !padEnabled && "pointer-events-none opacity-35",
          )}
        >
          {PAD_KEYS.map((key) => {
            // +1万 は受取金額にだけ使う
            const off = !padEnabled || (key.kind === "amount" && !paying);
            return (
              <button
                key={key.label}
                type="button"
                disabled={off}
                onClick={() => {
                  if (key.label === "⌫") onDeleteDigit();
                  else if (key.label === "C") onClearDigits();
                  else if (key.kind === "amount") onAddReceived(10000);
                  else onDigits(key.label);
                }}
                className={cn(
                  "rounded-[10px] border tabular-nums active:bg-stone-200",
                  // テンキーごと使えないときは、列の側で薄くする
                  padEnabled && "disabled:opacity-35",
                  key.kind === "digit" &&
                    "border-stone-200 bg-white font-semibold text-[22px]",
                  key.kind === "function" &&
                    "border-stone-200 bg-stone-100 font-bold text-[22px]",
                  key.kind === "amount" &&
                    "border-stone-400 bg-white font-bold text-xl",
                  key.label === "C" ? "text-red-700" : "text-stone-900",
                )}
                style={{ gridColumn: key.column, gridRow: key.row }}
              >
                {key.label}
              </button>
            );
          })}
        </div>
      </div>

      <div
        className={cn(
          "flex flex-none flex-col gap-2 px-4 pb-3.5",
          !paying && "pointer-events-none opacity-35",
        )}
      >
        <div className="flex items-center gap-2.5">
          <span className="font-bold text-sm text-stone-600">お釣り</span>
          <span
            className={cn(
              "ml-auto font-extrabold text-3xl tabular-nums",
              change !== null && change < 0
                ? "text-red-700"
                : change === null || itemCount === 0
                  ? "text-stone-400"
                  : "text-stone-900",
            )}
          >
            {itemCount === 0 || change === null
              ? "—"
              : change < 0
                ? `不足 ${formatYen(-change)}`
                : formatYen(change)}
          </span>
        </div>
        {paying && !canSubmit && (
          <p className="font-bold text-red-700 text-xs">
            オフラインです。左上の No. を押して番号を指定すると送信できます
          </p>
        )}
        <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-2">
          <button
            type="button"
            onClick={onSubmitExact}
            disabled={!exactReady}
            className="h-16 rounded-[10px] border border-stone-400 bg-white font-bold text-sm text-stone-900 leading-snug hover:bg-stone-50 disabled:opacity-40"
          >
            お釣り0で
            <br />
            送信
          </button>
          <button
            type="button"
            onClick={onSubmitCash}
            disabled={!cashReady}
            className={cn(
              "relative h-16 rounded-[10px] pr-12 pl-2 font-extrabold text-[22px] text-white",
              cashReady
                ? "bg-stone-900 shadow-[0_0_0_4px_rgb(44_91_127/0.25)]"
                : "cursor-not-allowed bg-stone-300",
            )}
          >
            現金会計確定
            {(enterSubmit || !paying) && (
              <KeyHint
                inverted
                className="-translate-y-1/2 absolute top-1/2 right-2.5"
              >
                Enter
              </KeyHint>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

const QuickButton = ({
  label,
  dim,
  enter,
  disabled,
  onClick,
}: {
  label: string;
  /** 足しても請求額に届かない */
  dim: boolean;
  /** Enter で押せる。印を添える */
  enter: boolean;
  disabled: boolean;
  onClick: () => void;
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    title={enter ? "Enter でちょうど" : undefined}
    className={cn(
      "flex h-11 items-center justify-center gap-0.5 rounded-lg border border-stone-300 bg-white p-0 font-bold text-[13px] tabular-nums active:bg-stone-100",
      dim ? "text-stone-400" : "text-stone-900",
    )}
  >
    {label}
    {enter && (
      <EnterIcon
        aria-label="Enter"
        className="h-3.5 w-3.5 flex-none text-theme-primary"
      />
    )}
  </button>
);
