import type { SquarePaymentType } from "@cafeore/common";
import { cn } from "~/lib/utils";
import { formatYen } from "~/lib/yen";
import {
  type CashierDraft,
  type CashierPayment,
  canInputCoupon,
} from "../../functional/cashierDraft";
import type { SquarePaymentSelectStatus } from "../../functional/useSquarePaymentSelect";
import { squarePaymentTypeLabel } from "../SquarePaymentDialog";

type props = {
  draft: CashierDraft;
  /** 小計。会計の段階は今払う額、入れる段階は注文の残り */
  due: number;
  /** 個別小計の会計中（小計に「個別」の札を付ける） */
  itemsSubtotal: boolean;
  /** 小計分割中なら、あとに回した額（この小計の残り − 今払う額）。分けていなければ null */
  deferred: number | null;
  /** 確定ボタンに添える説明（「分割 · この小計の残り ¥400」）。無ければ空 */
  note: string;
  /** 出す Square の決済手段。Square を使わないレジでは空 */
  squarePaymentTypes: readonly SquarePaymentType[];
  /** お客さんが Square 端末で決済手段を選ぶ画面を出しているか */
  terminalSelect: SquarePaymentSelectStatus;
  /** その画面を出せなかった理由（terminalSelect が failed のとき） */
  terminalSelectMessage: string | null;
  /** Square で決済を始められるか（つながっている・1 円以上） */
  canStartSquare: boolean;
  /** 注文を送れるか（つながっている、または番号を手で付けた） */
  canSubmit: boolean;
  /** 小計分割・一部金額先払いを押せるか */
  canSplit: boolean;
  onCash: () => void;
  /** Square の決済手段を押した。押すとすぐ小計の額で端末に送る */
  onSquare: (paymentType: SquarePaymentType) => void;
  onDigits: (digits: string) => void;
  onDeleteDigit: () => void;
  onClearDigits: () => void;
  onAddReceived: (amount: number) => void;
  onExactReceived: () => void;
  onSubmitCash: () => void;
  onOpenSplit: () => void;
  onCancelPart: () => void;
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
  kind: "digit" | "back" | "clear" | "exact";
};

const PAD_KEYS: PadKey[] = [
  { label: "1", column: "1", row: "1", kind: "digit" },
  { label: "2", column: "2", row: "1", kind: "digit" },
  { label: "3", column: "3", row: "1", kind: "digit" },
  { label: "⌫", column: "4", row: "1", kind: "back" },
  { label: "4", column: "1", row: "2", kind: "digit" },
  { label: "5", column: "2", row: "2", kind: "digit" },
  { label: "6", column: "3", row: "2", kind: "digit" },
  { label: "C", column: "4", row: "2", kind: "clear" },
  { label: "7", column: "1", row: "3", kind: "digit" },
  { label: "8", column: "2", row: "3", kind: "digit" },
  { label: "9", column: "3", row: "3", kind: "digit" },
  { label: "ちょうど", column: "4", row: "3 / span 2", kind: "exact" },
  { label: "0", column: "1 / span 2", row: "4", kind: "digit" },
  { label: "00", column: "3", row: "4", kind: "digit" },
];

/** 決済手段のボタンの色。現金は橙、Square は theme-primary */
const methodColor = (payment: CashierPayment) =>
  payment === "cash"
    ? { color: "var(--color-cash)", tint: "var(--color-cash-tint)" }
    : {
        color: "var(--color-theme-primary)",
        tint: "var(--color-square-tint)",
      };

/**
 * レジの右の列。小計、決済手段、受取金額（テンキー）、お釣り、小計分割・確定
 *
 * テンキーは、入れる段階では引換券番号、会計の段階では受取金額に打つ。
 * Square の決済手段は押すとすぐ小計の額で端末に送る（↑↓ で選んで Enter でも送る）。
 * Square 端末でお客さんが決済手段を選べる間は、受取金額の欄の右にそう出す。
 */
export const PayPanel = ({
  draft,
  due,
  itemsSubtotal,
  deferred,
  note,
  squarePaymentTypes,
  terminalSelect,
  terminalSelectMessage,
  canStartSquare,
  canSubmit,
  canSplit,
  onCash,
  onSquare,
  onDigits,
  onDeleteDigit,
  onClearDigits,
  onAddReceived,
  onExactReceived,
  onSubmitCash,
  onOpenSplit,
  onCancelPart,
}: props) => {
  const paying = draft.step === "pay";
  const cash = draft.payment === "cash";
  const received = draft.received === "" ? null : Number(draft.received);
  const change = received === null ? null : received - due;
  const cashReady =
    paying && canSubmit && cash && change !== null && change >= 0 && due >= 0;
  const squareReady = paying && !cash && canStartSquare;
  const padEnabled = paying ? cash : canInputCoupon(draft);
  const selected = methodColor(draft.payment);
  const methods: CashierPayment[] = ["cash", ...squarePaymentTypes];
  const squareLabel = cash
    ? ""
    : squarePaymentTypeLabel[draft.payment as SquarePaymentType];

  const primary = cash
    ? {
        label: "現金会計確定",
        sub: note,
        ready: cashReady,
        background: "var(--color-stone-900)",
        size: note ? "text-[19px]" : "text-[21px]",
      }
    : {
        label: "端末に送る",
        sub: note || `${squareLabel} · ${formatYen(due)}`,
        ready: squareReady,
        background: "var(--color-theme-primary)",
        size: "text-[19px]",
      };

  return (
    <div className="flex min-h-0 flex-col border-stone-200 border-l px-3.75 py-3">
      <div
        className={cn(
          "flex flex-none flex-col transition-opacity duration-200",
          !paying && "pointer-events-none opacity-38",
        )}
      >
        {deferred !== null && (
          <div className="flex h-5.5 items-center gap-2 font-bold text-prepay text-xs">
            <span>小計分割</span>
            <button
              type="button"
              onClick={onCancelPart}
              className="h-5 rounded-[5px] border border-stone-200 bg-white px-1.75 font-bold text-[10.5px] text-stone-600"
            >
              やめる
            </button>
            <span className="flex-1" />
            <span className="font-extrabold text-[13px] tabular-nums">
              {formatYen(-deferred)}
            </span>
          </div>
        )}
        <div className="mt-1 flex items-baseline gap-1.5">
          <span className="font-extrabold text-sm">小計</span>
          {paying && itemsSubtotal && (
            <span className="self-center rounded-[5px] bg-prepay px-1.75 py-px font-extrabold text-[11px] text-white">
              個別
            </span>
          )}
          {deferred !== null && (
            <span className="self-center rounded-[5px] border border-prepay px-1.5 font-extrabold text-[11px] text-prepay">
              分割
            </span>
          )}
          <span className="flex-1" />
          <span className="font-extrabold text-[27px] tabular-nums leading-[1.15] tracking-[-.01em]">
            {formatYen(due)}
          </span>
        </div>
        <div className="mt-2.25 mb-2.5 h-px bg-stone-200" />

        <div
          className="grid gap-2"
          style={{
            gridTemplateColumns: `repeat(${methods.length}, minmax(0, 1fr))`,
          }}
        >
          {methods.map((payment) => {
            const on = paying && draft.payment === payment;
            const { color, tint } = methodColor(payment);
            const disabled = payment !== "cash" && !canStartSquare;
            return (
              <button
                key={payment}
                type="button"
                aria-pressed={on}
                onClick={() =>
                  payment === "cash" ? onCash() : onSquare(payment)
                }
                disabled={!paying || disabled}
                className="relative h-12 whitespace-nowrap rounded-lg border-2 p-0 font-extrabold text-[13.5px] tracking-[-.03em] disabled:cursor-not-allowed"
                style={
                  disabled
                    ? {
                        borderColor: "var(--color-stone-400)",
                        backgroundColor: "var(--color-stone-400)",
                        color: "white",
                      }
                    : {
                        borderColor: color,
                        backgroundColor: on ? tint : color,
                        color: on ? color : "white",
                      }
                }
              >
                {payment === "cash" ? "現金" : squarePaymentTypeLabel[payment]}
                {on && (
                  <span
                    className="-bottom-1.75 -ml-1.25 absolute left-1/2 h-2.5 w-2.5 rotate-45 border-r-2 border-b-2"
                    style={{ backgroundColor: tint, borderColor: color }}
                  />
                )}
              </button>
            );
          })}
        </div>

        <div className="mt-3 flex h-6 items-center gap-2 font-medium text-stone-500 text-xs">
          <span>{cash ? "受取金額" : "請求額"}</span>
          <span className="flex-1" />
          {paying && terminalSelect === "showing" && (
            <span className="flex min-w-0 items-center gap-1.5 truncate font-bold text-theme-primary">
              <span className="h-1.5 w-1.5 flex-none animate-pulse rounded-full bg-theme-primary" />
              お客さんが端末で選べます
            </span>
          )}
          {paying && terminalSelect === "failed" && (
            <span
              className="min-w-0 truncate text-stone-400"
              title={terminalSelectMessage ?? undefined}
            >
              端末に決済手段の選択を出せませんでした
            </span>
          )}
        </div>
        <div
          className="mt-1 flex h-10.5 items-center justify-end gap-2 rounded-lg border-2 bg-white px-3 transition-colors duration-150"
          style={{
            borderColor: paying ? selected.color : "var(--color-stone-200)",
          }}
        >
          <span className="font-bold text-[17px] text-stone-400">¥</span>
          <span
            className={cn(
              "font-extrabold text-[28px] tabular-nums leading-none tracking-[-.01em]",
              cash && received === null ? "text-stone-300" : "text-stone-900",
            )}
          >
            {(cash ? (received ?? 0) : due).toLocaleString("ja-JP")}
          </span>
        </div>

        {cash && (
          <div className="mt-2 grid grid-cols-4 gap-1.75">
            {QUICK_AMOUNTS.map(({ label, amount }) => (
              <button
                key={label}
                type="button"
                onClick={() => onAddReceived(amount)}
                disabled={!paying}
                className="h-9 rounded-lg border border-stone-200 bg-white p-0 font-bold text-stone-600 text-xs active:bg-stone-100"
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div
        className={cn(
          "mt-2 grid min-h-0 flex-1 grid-cols-4 grid-rows-[repeat(4,minmax(40px,1fr))] gap-3 transition-opacity duration-200",
          !padEnabled && "pointer-events-none",
          !padEnabled && (paying ? "opacity-30" : "opacity-38"),
        )}
      >
        {PAD_KEYS.map((key) => {
          // ちょうど は受取金額にだけ使う
          const off = !padEnabled || (key.kind === "exact" && !paying);
          return (
            <button
              key={key.label}
              type="button"
              disabled={off}
              onClick={() => {
                if (key.kind === "back") onDeleteDigit();
                else if (key.kind === "clear") onClearDigits();
                else if (key.kind === "exact") onExactReceived();
                else onDigits(key.label);
              }}
              className={cn(
                "flex items-center justify-center rounded-lg border border-stone-200 p-0 tabular-nums",
                padEnabled && "disabled:opacity-35",
                // 押せるキーだけ浮かせ、押すと沈める
                !off &&
                  "shadow-[0_2px_0_var(--color-stone-300),0_3px_6px_rgba(28,25,23,.1)] active:translate-y-0.5 active:shadow-none",
                key.kind === "digit" &&
                  "bg-white font-bold text-[22px] text-stone-900 active:bg-stone-100",
                key.kind === "back" && "bg-stone-100 active:bg-stone-200",
                key.kind === "clear" &&
                  "bg-stone-100 font-extrabold text-[22px] text-red-700 active:bg-stone-200",
                key.kind === "exact" &&
                  "bg-white font-extrabold text-base text-stone-900 active:bg-stone-100",
              )}
              style={{ gridColumn: key.column, gridRow: key.row }}
            >
              {key.kind === "back" ? <BackspaceIcon /> : key.label}
            </button>
          );
        })}
      </div>

      <div
        className={cn(
          "flex flex-none flex-col transition-opacity duration-200",
          !paying && "pointer-events-none opacity-38",
        )}
      >
        <div className="mt-2.5 flex h-6.5 items-center justify-between">
          <span className="font-medium text-stone-500 text-xs">お釣り</span>
          <span
            className={cn(
              "font-extrabold tabular-nums",
              cash && change !== null && change >= 0
                ? "text-[22px] text-stone-900"
                : "text-lg",
              cash && change !== null && change < 0 && "text-red-700",
              (!cash || change === null) && "text-stone-300",
            )}
          >
            {!cash || change === null
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
        <div className="mt-2 grid grid-cols-[104px_minmax(0,1fr)] gap-2">
          <button
            type="button"
            onClick={onOpenSplit}
            disabled={!canSplit}
            className="flex h-14 flex-col items-center justify-center rounded-[10px] border border-prepay-line bg-white p-0 font-extrabold text-prepay text-xs leading-[1.35] hover:bg-prepay-tint disabled:opacity-45 disabled:hover:bg-white"
          >
            <span>小計分割・</span>
            <span>一部金額先払い</span>
          </button>
          <button
            type="button"
            onClick={() => {
              if (!primary.ready) return;
              if (cash) onSubmitCash();
              else onSquare(draft.payment as SquarePaymentType);
            }}
            disabled={!primary.ready}
            className="flex h-14 items-center justify-center gap-2.5 rounded-[10px] px-3 text-white transition-colors duration-150 disabled:cursor-default"
            style={{
              backgroundColor: primary.ready
                ? primary.background
                : "var(--color-stone-200)",
            }}
          >
            <span className="flex min-w-0 flex-col items-start gap-px">
              <span
                className={cn(
                  "whitespace-nowrap font-black leading-[1.2]",
                  primary.size,
                )}
              >
                {primary.label}
              </span>
              {primary.sub && (
                <span className="whitespace-nowrap font-medium text-[11px] opacity-90">
                  {primary.sub}
                </span>
              )}
            </span>
            <span className="flex-none rounded border border-white/60 px-1.25 py-px font-bold text-[10px]">
              Enter
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};

/** テンキーの 1 桁消すキー */
export const BackspaceIcon = () => (
  <svg
    width="26"
    height="20"
    viewBox="0 0 26 20"
    fill="none"
    aria-label="1 桁消す"
    role="img"
  >
    <path
      d="M8 2h15a1.5 1.5 0 0 1 1.5 1.5v13A1.5 1.5 0 0 1 23 18H8l-6.5-8z"
      stroke="#1c1917"
      strokeWidth="2"
      strokeLinejoin="round"
    />
    <path
      d="M12.5 6.5l7 7M19.5 6.5l-7 7"
      stroke="#1c1917"
      strokeWidth="2"
      strokeLinecap="round"
    />
  </svg>
);
