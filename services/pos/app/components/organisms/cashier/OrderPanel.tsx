import { dripperLabel, useColorSettings } from "@cafeore/common";
import {
  CheckCircledIcon,
  CrossCircledIcon,
  Pencil2Icon,
} from "@radix-ui/react-icons";
import { useEffect, useRef } from "react";
import { KeyHint } from "~/components/atoms/KeyHint";
import { cn } from "~/lib/utils";
import { formatYen } from "~/lib/yen";
import {
  COUPON_DIGITS,
  type CashierDraft,
  type CashierLine,
  type CouponStatus,
  canAssignSelected,
  canEditCoupon,
  canEditLines,
  canGoPay,
  isDiscountLocked,
} from "../../functional/cashierDraft";
import {
  type CashierSplitPayment,
  type SplitBill,
  canCancelSplit,
  canStartSplit,
  unpaidLines,
} from "../../functional/cashierSplit";
import { squarePaymentTypeLabel } from "../SquarePaymentDialog";
import { menuColor } from "./MenuPanel";

type props = {
  draft: CashierDraft;
  couponStatus: CouponStatus;
  /** 入力中の注文の割引額と、割引の対象の杯数 */
  discount: number;
  coffeeCups: number;
  /** ドリッパーを 3 人以上確保する注文。分けるよう知らせる */
  needsSplit: boolean;
  /** 一括会計・個別会計で先に刷ったシールの番号。刷っていなければ null */
  printedOrderId: number | null;
  /** 個別会計の今回の会計（下の枠）の金額。個別会計でなければ null */
  splitBill: SplitBill | null;
  /** 1 杯の割引額 */
  discountPerCup: number;
  onSelect: (index: number) => void;
  onToggleVoid: (index: number) => void;
  onOpenAssign: () => void;
  onVoidAll: () => void;
  onFocusCoupon: () => void;
  onToggleSpecial: () => void;
  onOpenMemo: () => void;
  onGoPay: () => void;
  onBackToEntry: () => void;
  onStartSplit: () => void;
  onCancelSplit: () => void;
};

/** 指名の表示（「1st・たなか」） */
const assignText = (line: CashierLine) =>
  [
    line.menu.dripper !== null ? dripperLabel(line.menu.dripper) : "",
    line.menu.assignee ?? "",
  ]
    .filter(Boolean)
    .join("・");

/**
 * レジの真ん中の列。商品（削除・指名）、割引、備考、一括会計・個別会計
 *
 * 個別会計の間は、商品の代わりに払い終えた会計と残りを出す（商品は左の列の上下の枠に出す）。
 */
export const OrderPanel = (props: props) => {
  const { draft, splitBill } = props;
  const splitPaid = (draft.split?.payments.length ?? 0) > 0;
  return (
    <div className="flex min-h-0 flex-col border-stone-200 border-l bg-stone-50">
      {draft.split === null ? (
        <LinesSection {...props} />
      ) : (
        <SplitPaymentsSection {...props} />
      )}
      <DiscountSection {...props} />
      <MemoSection {...props} />
      <div className="flex-none border-stone-200 border-t px-3.5 pt-3 pb-3.5">
        {draft.step === "entry" ? (
          <div className="flex gap-2">
            {draft.split === null ? (
              <button
                type="button"
                onClick={props.onStartSplit}
                disabled={!canStartSplit(draft)}
                title="商品を分けて、何回かに分けて払います"
                className="h-15 flex-[0_0_112px] rounded-xl border border-stone-400 bg-white font-bold text-[15px] text-stone-900 hover:bg-stone-50 disabled:cursor-not-allowed disabled:border-stone-200 disabled:bg-stone-100 disabled:text-stone-400"
              >
                個別会計
              </button>
            ) : (
              <button
                type="button"
                onClick={props.onCancelSplit}
                disabled={!canCancelSplit(draft)}
                title={
                  splitPaid
                    ? "払い始めたので、やめられません"
                    : "商品の一覧に戻ります"
                }
                className="h-15 flex-[0_0_112px] rounded-xl border border-stone-400 bg-white font-bold text-[13px] text-stone-900 leading-tight hover:bg-stone-50 disabled:cursor-not-allowed disabled:border-stone-200 disabled:bg-stone-100 disabled:text-stone-400"
              >
                個別会計を
                <br />
                やめる
              </button>
            )}
            <button
              type="button"
              onClick={props.onGoPay}
              disabled={!canGoPay(draft)}
              className="relative flex h-15 min-w-0 flex-1 items-center justify-center rounded-xl bg-stone-900 pr-14 pl-2 font-extrabold text-[22px] text-white disabled:cursor-not-allowed disabled:bg-stone-300"
            >
              {splitBill === null ? (
                "一括会計"
              ) : (
                <span className="flex min-w-0 flex-col items-center leading-tight">
                  <span className="text-lg">この分を会計</span>
                  <span className="font-bold text-[13px] tabular-nums opacity-80">
                    {splitBill.lines.length}点・{formatYen(splitBill.amount)}
                  </span>
                </span>
              )}
              <KeyHint
                inverted
                className="-translate-y-1/2 absolute top-1/2 right-3.5 px-1.5 py-1 text-xs"
              >
                Enter
              </KeyHint>
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            <p className="text-stone-500 text-xs leading-normal">
              {props.printedOrderId !== null &&
                `No.${props.printedOrderId} のシールを印刷しました。`}
              {splitBill === null
                ? "商品を変えるときは会計取消"
                : "この会計で払う商品を選び直すときは会計取消"}
              {props.printedOrderId !== null &&
                !splitPaid &&
                "（取り消しのシールを刷ります）"}
            </p>
            <button
              type="button"
              onClick={props.onBackToEntry}
              className="h-15 w-full rounded-xl border border-stone-400 bg-white font-bold text-[17px] text-stone-900 hover:bg-stone-50"
            >
              会計取消
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

/** 決済手段の表示（「現金」「カード」など） */
const paymentLabel = (payment: CashierSplitPayment) =>
  payment.method === "cash"
    ? "現金"
    : payment.squarePaymentType
      ? squarePaymentTypeLabel[payment.squarePaymentType]
      : "Square";

/** 個別会計の間の真ん中の列の上。払い終えた会計と、残り */
const SplitPaymentsSection = ({ draft, splitBill, discountPerCup }: props) => {
  const payments = draft.split?.payments ?? [];
  const remaining = unpaidLines(draft);
  const remainingAmount =
    remaining.reduce((acc, line) => acc + line.menu.price, 0) -
    [...(splitBill?.allocation.values() ?? [])].reduce(
      (acc, cups) => acc + cups * discountPerCup,
      0,
    );
  const names = (keys: number[]) =>
    keys
      .flatMap((key) => draft.lines.filter((line) => line.key === key))
      .map((line) => line.menu.name)
      .join("・");

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 px-3 pt-3 pb-2.5">
      <div className="flex flex-none items-center gap-2.5 pl-0.5">
        <span className="font-bold text-[15px]">個別会計</span>
        <span className="ml-auto text-sm text-stone-600 tabular-nums">
          残り {remaining.length}点・{formatYen(remainingAmount)}
        </span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-auto">
        {payments.map((payment, index) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: 払った順は変わらない
            key={index}
            className="flex flex-none flex-col gap-0.5 rounded-lg bg-white px-3 py-2 shadow-[inset_0_0_0_1px_var(--color-stone-200)]"
          >
            <div className="flex items-center gap-2">
              <span className="rounded bg-stone-200 px-1.5 py-0.5 font-bold text-stone-700 text-xs">
                {index + 1}回目
              </span>
              <span
                className={cn(
                  "font-bold text-sm",
                  payment.method === "square" && "text-sky-800",
                )}
              >
                {paymentLabel(payment)}
              </span>
              <span className="ml-auto font-extrabold text-[17px] tabular-nums">
                {formatYen(payment.amount)}
              </span>
            </div>
            <span className="truncate text-stone-600 text-xs">
              {names(payment.lineKeys)}
            </span>
            {(payment.method === "cash" || payment.discount > 0) && (
              <span className="text-stone-500 text-xs tabular-nums">
                {[
                  payment.discount > 0 &&
                    `割引 ${formatYen(-payment.discount)}`,
                  payment.method === "cash" &&
                    `お預り ${formatYen(payment.received)}・お釣り ${formatYen(payment.received - payment.amount)}`,
                ]
                  .filter(Boolean)
                  .join("・")}
              </span>
            )}
          </div>
        ))}
        {payments.length === 0 && (
          <div className="flex flex-1 items-center justify-center px-4 text-center text-sm text-stone-400 leading-relaxed">
            左の下の枠に入れた商品を「この分を会計」で払います。
            <br />
            全部払い終えたら注文を送ります
          </div>
        )}
      </div>
    </div>
  );
};

const LinesSection = ({
  draft,
  needsSplit,
  onSelect,
  onToggleVoid,
  onOpenAssign,
  onVoidAll,
}: props) => {
  const { colorSettings } = useColorSettings();
  const listRef = useRef<HTMLDivElement>(null);
  const { lines, selected } = draft;
  const activeCount = lines.filter((line) => !line.voided).length;
  const voidedCount = lines.length - activeCount;
  const selectedLine = selected === null ? null : lines[selected];
  const canAssign = canAssignSelected(draft);

  // ↑↓ で選んだ行が見えるようにする
  useEffect(() => {
    if (selected === null) return;
    listRef.current
      ?.querySelector(`[data-line="${selected}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 px-3 pt-3 pb-2.5">
      <div className="flex flex-none items-center gap-2.5 pl-0.5">
        <span className="font-bold text-[15px]">商品</span>
        {needsSplit && (
          <span className="rounded bg-red-50 px-1.5 py-0.5 font-bold text-red-700 text-xs">
            分割を推奨
          </span>
        )}
        {lines.length > 0 && (
          <span className="ml-auto text-sm text-stone-600">
            {activeCount}点{voidedCount > 0 && `（削除 ${voidedCount}）`}
          </span>
        )}
      </div>
      <div
        ref={listRef}
        className="relative flex min-h-0 flex-1 flex-col gap-1.5 overflow-auto"
      >
        {lines.map((line, index) => {
          const isSelected = selected === index;
          const assign = assignText(line);
          return (
            <div
              key={line.key}
              data-line={index}
              className={cn(
                "flex flex-none rounded-lg",
                isSelected
                  ? "bg-orange-50 shadow-[inset_0_0_0_3px_var(--color-orange-600)]"
                  : "bg-white shadow-[inset_0_0_0_1px_var(--color-stone-200)]",
              )}
            >
              <button
                type="button"
                aria-pressed={isSelected}
                onClick={() => onSelect(index)}
                // 会計の段階ではシールを先に刷っているので、商品は変えない
                disabled={!canEditLines(draft)}
                className="flex min-h-12 min-w-0 flex-1 items-center gap-2 pr-3.5 pl-2.5 text-left disabled:cursor-default"
              >
                <span className="w-3.5 flex-none text-right font-mono text-stone-400 text-xs">
                  {index + 1}
                </span>
                <span
                  className="h-2 w-2 flex-none rounded-full"
                  style={{
                    backgroundColor:
                      menuColor(colorSettings, line.menu) ?? "#a8a29e",
                  }}
                />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span
                    className={cn(
                      "font-bold text-[15px] leading-[1.3]",
                      line.voided &&
                        "text-stone-400 line-through decoration-red-700 decoration-double",
                    )}
                  >
                    {line.menu.name}
                  </span>
                  {assign && (
                    <span className="truncate font-bold text-[11px] text-theme-primary">
                      指名 {assign}
                    </span>
                  )}
                </span>
                <span
                  className={cn(
                    "font-medium text-[15px] tabular-nums",
                    line.voided &&
                      "text-stone-400 line-through decoration-red-700 decoration-double",
                  )}
                >
                  {formatYen(line.menu.price)}
                </span>
              </button>
            </div>
          );
        })}
        {lines.length === 0 && (
          <div className="flex flex-1 items-center justify-center text-sm text-stone-400">
            左のメニューから商品をタップ
          </div>
        )}
      </div>
      <div className="flex flex-none gap-2">
        <button
          type="button"
          onClick={onOpenAssign}
          disabled={!canAssign}
          className={cn(
            "flex h-12 min-w-0 flex-1 items-center justify-center gap-2 rounded-[10px] border font-bold text-sm",
            canAssign
              ? "border-theme-primary bg-white text-theme-primary"
              : "cursor-not-allowed border-stone-200 bg-stone-100 text-stone-400",
          )}
        >
          指名
          <KeyHint className="border-current bg-transparent text-current opacity-70">
            Space
          </KeyHint>
        </button>
        <button
          type="button"
          onClick={() => selected !== null && onToggleVoid(selected)}
          disabled={selectedLine === null}
          className={cn(
            "h-12 min-w-0 flex-1 rounded-[10px] border font-bold text-sm leading-tight",
            selectedLine === null
              ? "cursor-not-allowed border-stone-200 bg-stone-100 text-stone-400"
              : selectedLine.voided
                ? "border-stone-400 bg-white text-stone-900"
                : "border-red-700 bg-white text-red-700",
          )}
        >
          {selectedLine?.voided ? "削除を戻す" : "削除"}
        </button>
        <button
          type="button"
          onClick={onVoidAll}
          disabled={activeCount === 0 || !canEditLines(draft)}
          className={cn(
            "h-12 min-w-0 flex-1 rounded-[10px] border font-bold text-sm leading-tight",
            activeCount > 0 && canEditLines(draft)
              ? "border-red-700 bg-white text-red-700"
              : "cursor-not-allowed border-stone-200 bg-stone-100 text-stone-400",
          )}
        >
          全削除
        </button>
      </div>
    </div>
  );
};

/** 割引の欄の下に出す、引換券・特殊な割引の結果 */
const discountMessage = ({
  draft,
  couponStatus,
  discount,
  coffeeCups,
}: props): { text: string; tone: "ok" | "bad" | "neutral" } => {
  if (draft.special) {
    return {
      text:
        discount > 0
          ? `特殊な割引：1杯分 −${formatYen(discount)}`
          : "特殊な割引：ドリンクがありません",
      tone: "ok",
    };
  }
  switch (couponStatus.kind) {
    case "empty":
      return {
        text: "3桁を入れると前回の注文を照合します（1杯 −¥100）",
        tone: "neutral",
      };
    case "partial":
      return { text: `あと ${couponStatus.remaining} 桁`, tone: "neutral" };
    case "available": {
      const cups = couponStatus.order.getCoffeeCups();
      const names = cups.map((cup) => cup.name).join("・");
      const limit =
        cups.length > coffeeCups ? ` 今回は${coffeeCups}杯まで` : "";
      return {
        text: `${cups.length}杯分 −${formatYen(discount)}（${names}）${limit}`,
        tone: "ok",
      };
    }
    case "already_used":
      return {
        text: "使用済みの番号です。割引は適用できません",
        tone: "bad",
      };
    case "unserved":
      return {
        text: "まだ提供されていない番号です。割引は適用できません",
        tone: "bad",
      };
  }
};

const DiscountSection = (props: props) => {
  const { draft, couponStatus, onFocusCoupon, onToggleSpecial } = props;
  const editable = canEditCoupon(draft);
  const couponApplied = couponStatus.kind === "available";
  // 個別会計で払い始めたら、割引は変えない
  const locked = isDiscountLocked(draft);
  const specialBlocked = (!draft.special && couponApplied) || locked;
  const message = discountMessage(props);
  const complete = draft.coupon.length === COUPON_DIGITS;

  return (
    <div className="flex flex-none flex-col gap-2 border-stone-200 border-t px-3.5 py-2.5">
      <div className="flex items-center gap-2.5">
        <span className="font-bold text-[15px]">割引</span>
        <button
          type="button"
          onClick={onToggleSpecial}
          disabled={specialBlocked}
          title={
            locked
              ? "個別会計で払い始めたので変えられません"
              : specialBlocked
                ? "引換券で割引しているときは使えません"
                : "今年以外の引換券があるときは、1杯分に限り割引できます"
          }
          className={cn(
            "ml-auto h-11 rounded-[10px] border px-3.5 font-bold text-[13px] disabled:opacity-40",
            draft.special
              ? "border-stone-900 bg-stone-900 text-white"
              : "border-stone-400 bg-white text-stone-900",
          )}
        >
          {draft.special ? "特殊な割引を解除" : "特殊な割引"}（今年以外の券）
        </button>
      </div>
      <div className="flex items-center gap-2.5">
        <span className="w-9.5 text-stone-600 text-xs leading-tight">
          引換券番号
        </span>
        <button
          type="button"
          aria-label={`引換券番号 ${draft.coupon || "未入力"}`}
          onClick={onFocusCoupon}
          disabled={draft.special || locked}
          className={cn(
            "flex flex-none gap-1.5",
            (draft.special || locked) && "opacity-40",
          )}
        >
          {Array.from({ length: COUPON_DIGITS }, (_, i) => {
            const current =
              editable &&
              i === Math.min(draft.coupon.length, COUPON_DIGITS - 1);
            const ring = !editable
              ? "1px var(--color-stone-300)"
              : `${current && !complete ? "3px" : "1.5px"} var(--color-orange-600)`;
            return (
              <span
                // biome-ignore lint/suspicious/noArrayIndexKey: 桁の位置そのものが key
                key={i}
                className={cn(
                  "flex h-14 w-12 items-center justify-center rounded-lg bg-white font-bold font-mono text-3xl",
                  complete
                    ? couponApplied
                      ? "text-green-700"
                      : "text-red-700"
                    : "text-stone-900",
                )}
                style={{ boxShadow: `inset 0 0 0 ${ring}` }}
              >
                {draft.coupon[i] ?? ""}
              </span>
            );
          })}
        </button>
        <div
          className={cn(
            "flex min-w-0 flex-1 items-start gap-1.5 text-xs leading-normal",
            message.tone === "ok" && "text-green-700",
            message.tone === "bad" && "text-red-700",
            message.tone === "neutral" && "text-stone-500",
          )}
        >
          {message.tone === "ok" && (
            <CheckCircledIcon className="mt-px h-4 w-4 flex-none" />
          )}
          {message.tone === "bad" && (
            <CrossCircledIcon className="mt-px h-4 w-4 flex-none" />
          )}
          <span>
            {message.text}
            {draft.split !== null &&
              props.discount > 0 &&
              (locked
                ? "。払い始めたので変えられません"
                : "。左の「割引をここに」で付ける商品を選べます")}
          </span>
        </div>
      </div>
    </div>
  );
};

const MemoSection = ({ draft, onOpenMemo }: props) => {
  const focused =
    draft.step === "entry" && draft.selected === null && draft.zone === "memo";
  return (
    <div className="flex flex-none items-center gap-2.5 border-stone-200 border-t px-3.5 py-2">
      <span className="font-bold text-[15px]">備考</span>
      <button
        type="button"
        onClick={onOpenMemo}
        className={cn(
          "flex h-11 min-w-0 flex-1 items-center gap-2 rounded-lg bg-white px-3 text-left",
          focused ? "border-2 border-orange-600" : "border border-stone-300",
        )}
      >
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-[15px]",
            draft.memo ? "text-stone-900" : "text-stone-400",
          )}
        >
          {draft.memo ? draft.memo.replace(/\n/g, " ") : "特記事項（任意）"}
        </span>
        {focused && <KeyHint className="flex-none">Space</KeyHint>}
        <Pencil2Icon className="h-4 w-4 flex-none text-stone-500" />
      </button>
    </div>
  );
};
