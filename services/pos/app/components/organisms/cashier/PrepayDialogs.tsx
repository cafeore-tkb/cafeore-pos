import * as DialogPrimitive from "@radix-ui/react-dialog";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { cn } from "~/lib/utils";
import { formatYen } from "~/lib/yen";
import { checkPart } from "../../functional/cashierSplit";
import { BackspaceIcon } from "./PayPanel";

/**
 * 先払い（個別小計・小計分割）のダイアログ
 *
 * どれもキーで操作できる（数字・Backspace で金額、Enter で主のボタン、Esc で戻る）。
 * 開いている間はレジのキー操作を止めているので、キーはここで受け取る。
 */

// --------------------------------------------------
// 共通の部品
// --------------------------------------------------

/** 開いている間、押したキーを受け取る。handle が true を返したキーは既定の動きを止める */
const useDialogKeys = (open: boolean, handle: (key: string) => boolean) => {
  const handleRef = useRef(handle);
  handleRef.current = handle;
  useEffect(() => {
    if (!open) return;
    const listener = (event: KeyboardEvent) => {
      if (event.isComposing || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      if (handleRef.current(event.key)) {
        event.preventDefault();
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [open]);
};

/** 金額の入力（6 桁まで、頭の 0 は付けない） */
const pressAmount = (amount: string, key: string) => {
  if (key === "back") return amount.slice(0, -1);
  const next = (amount + key).replace(/^0+/, "");
  return next.length > 6 ? amount : next;
};

/** 数字・Backspace を金額の入力にする。扱ったら true */
const amountKey = (
  key: string,
  setAmount: (update: (amount: string) => string) => void,
) => {
  if (/^[0-9]$/.test(key)) {
    setAmount((amount) => pressAmount(amount, key));
    return true;
  }
  if (key === "Backspace") {
    setAmount((amount) => pressAmount(amount, "back"));
    return true;
  }
  return false;
};

type ShellProps = {
  open: boolean;
  /** デザインの幅（440 / 540） */
  width: 440 | 540;
  title: ReactNode;
  /** 題の下の説明 */
  sub?: string;
  /** 題の右に出すもの（決済手段・注文番号） */
  aside?: ReactNode;
  icon?: ReactNode;
  /** 題の大きさ。確かめる・選ぶダイアログは 20px、結果のダイアログは 22px */
  large?: boolean;
  children: ReactNode;
};

/** 先払いのダイアログの枠。外側のクリック・Esc では閉じない（Esc は useDialogKeys で扱う） */
const PrepayDialogShell = ({
  open,
  width,
  title,
  sub,
  aside,
  icon,
  large,
  children,
}: ShellProps) => (
  <DialogPrimitive.Root open={open}>
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[rgba(28,25,23,.42)]" />
      <DialogPrimitive.Content
        aria-describedby={undefined}
        onEscapeKeyDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
        // 開いた瞬間にボタンへフォーカスを移さない（Enter はキーで扱う）
        onOpenAutoFocus={(event) => event.preventDefault()}
        className="-translate-x-1/2 -translate-y-1/2 fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-32px)] max-w-[calc(100vw-32px)] flex-col gap-3.5 overflow-auto rounded-xl bg-white p-6 font-noto text-stone-900 shadow-[0_20px_50px_rgba(0,0,0,.25)] outline-none"
        style={{ width }}
      >
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2.5">
            {icon}
            <DialogPrimitive.Title
              className={cn(
                "font-extrabold",
                large ? "text-[22px]" : "text-xl",
              )}
            >
              {title}
            </DialogPrimitive.Title>
            {aside && (
              <>
                <span className="flex-1" />
                {aside}
              </>
            )}
          </div>
          {sub && <span className="text-[13px] text-stone-500">{sub}</span>}
        </div>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  </DialogPrimitive.Root>
);

const CheckIcon = () => (
  <svg
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
    className="flex-none"
  >
    <circle cx="12" cy="12" r="10" stroke="#15803d" strokeWidth="2" />
    <path
      d="M7.5 12.5l3 3 6-6.5"
      stroke="#15803d"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const WarningIcon = () => (
  <svg
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
    className="flex-none"
  >
    <path
      d="M12 3.5l9.5 16.5h-19z"
      stroke="#ea580c"
      strokeWidth="2"
      strokeLinejoin="round"
    />
    <path
      d="M12 10v4.5"
      stroke="#ea580c"
      strokeWidth="2"
      strokeLinecap="round"
    />
    <circle cx="12" cy="17.2" r="1.1" fill="#ea580c" />
  </svg>
);

const Spinner = () => (
  <span className="inline-block h-3 w-3 flex-none animate-spin rounded-full border-2 border-stone-200 border-t-stone-900" />
);

/** ボタンに添える Enter の札 */
const EnterTag = () => (
  <span className="rounded border border-white/60 px-1 font-bold text-[10px] leading-[15px]">
    Enter
  </span>
);

const buttonClass = {
  /** 「戻る」「閉じる」など */
  secondary:
    "h-10 rounded-lg border border-stone-300 bg-white px-3.5 font-bold text-sm text-stone-900 disabled:cursor-not-allowed disabled:opacity-40",
  /** 主のボタン（黒）。押せないときは灰色 */
  primary:
    "flex h-10 items-center gap-2 rounded-lg bg-stone-900 px-4 font-extrabold text-sm text-white disabled:cursor-default disabled:bg-stone-300",
};

/** 先に払う金額の入力欄 */
const AmountField = ({ label, amount }: { label: string; amount: string }) => (
  <div className="flex flex-col gap-1">
    <span className="font-medium text-stone-500 text-xs">{label}</span>
    <div className="flex h-13 items-center justify-end gap-2 rounded-lg border-2 border-prepay px-3">
      <span className="font-bold text-lg text-stone-400">¥</span>
      <span
        className={cn(
          "font-extrabold text-[32px] tabular-nums leading-none",
          amount === "" ? "text-stone-300" : "text-stone-900",
        )}
      >
        {amount === "" ? "0" : Number(amount).toLocaleString("ja-JP")}
      </span>
    </div>
  </div>
);

const AMOUNT_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "00", "0"];

/** 金額のテンキー（ダイアログの右） */
const AmountPad = ({ onPress }: { onPress: (key: string) => void }) => (
  <div className="grid auto-rows-[44px] grid-cols-3 gap-1.5">
    {AMOUNT_KEYS.map((key) => (
      <button
        key={key}
        type="button"
        onClick={() => onPress(key)}
        className="rounded-lg border border-stone-200 bg-white p-0 font-bold text-lg text-stone-900 active:bg-stone-200"
      >
        {key}
      </button>
    ))}
    <button
      type="button"
      onClick={() => onPress("back")}
      className="flex items-center justify-center rounded-lg border border-stone-200 bg-stone-100 p-0 active:bg-stone-200"
    >
      <BackspaceIcon />
    </button>
  </div>
);

/** 先に払う額と、このあとの残り・理由 */
const PartSummary = ({
  amount,
  limit,
  afterPayment,
}: {
  amount: string;
  limit: number;
  afterPayment: boolean;
}) => {
  const value = amount === "" ? 0 : Number(amount);
  const check = checkPart(value, limit, afterPayment);
  return (
    <>
      <div className="flex justify-between font-bold text-[13px] text-prepay">
        <span>このあと残り</span>
        <span className="font-extrabold tabular-nums">
          {value > 0 && value <= limit ? formatYen(limit - value) : "—"}
        </span>
      </div>
      {check.message && (
        <p className="m-0 text-red-700 text-xs">{check.message}</p>
      )}
    </>
  );
};

/** 受け取った額・決済手段・お釣りの見出し */
const ReceivedChange = ({
  received,
  change,
}: {
  received: number;
  change: number;
}) => (
  <div className="flex items-center justify-between rounded-lg border border-stone-200 bg-stone-50 px-3.5 py-3">
    <span className="text-[13px] text-stone-600">
      現金の受取 {formatYen(received)}
    </span>
    <span className="flex items-baseline gap-2">
      <span className="font-bold text-[13px]">お釣り</span>
      <span className="font-black text-[28px] tabular-nums">
        {formatYen(change)}
      </span>
    </span>
  </div>
);

// --------------------------------------------------
// 個別小計（商品を選ぶ）
// --------------------------------------------------

/** 個別小計で選べる商品の行 */
export type SubtotalItemRow = {
  key: number;
  /** 真ん中の列の番号（数字キーで選ぶ） */
  number: number;
  name: string;
  price: number;
  /** 割り振った割引の額。無ければ 0 */
  discount: number;
  /** 「割引をここに」を出す（割引があり、コーヒーで、まだ割り振っていない行） */
  canPreferDiscount: boolean;
};

export const SubtotalItemsDialog = ({
  open,
  rows,
  remaining,
  onPreferDiscount,
  onConfirm,
  onClose,
}: {
  open: boolean;
  /** まだ払っていない商品 */
  rows: SubtotalItemRow[];
  /** 注文の残り（先会計を引いた額） */
  remaining: number;
  onPreferDiscount: (key: number) => void;
  onConfirm: (keys: number[]) => void;
  onClose: () => void;
}) => {
  const [selected, setSelected] = useState<number[]>([]);
  useEffect(() => {
    if (open) setSelected([]);
  }, [open]);
  const toggle = (key: number) =>
    setSelected((current) =>
      current.includes(key)
        ? current.filter((k) => k !== key)
        : [...current, key],
    );
  const picked = rows.filter((row) => selected.includes(row.key));
  const amount = picked.reduce((acc, row) => acc + row.price - row.discount, 0);
  const ok = picked.length > 0;
  const confirm = () => {
    if (ok) onConfirm(picked.map((row) => row.key));
  };

  useDialogKeys(open, (key) => {
    if (/^[1-9]$/.test(key)) {
      const row = rows.find((candidate) => candidate.number === Number(key));
      if (row) toggle(row.key);
      return true;
    }
    if (key === "Enter") {
      confirm();
      return true;
    }
    if (key === "Escape") {
      onClose();
      return true;
    }
    return false;
  });

  return (
    <PrepayDialogShell
      open={open}
      width={440}
      title="個別小計"
      sub="先に会計する商品を選んでください（数字キーでも選べます）"
    >
      <div className="flex max-h-[260px] flex-col gap-1.5 overflow-auto">
        {rows.map((row) => {
          const on = selected.includes(row.key);
          return (
            <div
              key={row.key}
              className={cn(
                "flex h-11.5 flex-none items-center rounded-lg border-[1.5px]",
                on
                  ? "border-prepay bg-prepay-tint"
                  : "border-stone-200 bg-white",
              )}
            >
              <button
                type="button"
                aria-pressed={on}
                onClick={() => toggle(row.key)}
                className="flex h-full min-w-0 flex-1 items-center gap-3 pr-3.5 pl-3.5 text-left"
              >
                <span
                  className={cn(
                    "flex h-5 w-5 flex-none items-center justify-center rounded-[5px] border-2",
                    on
                      ? "border-prepay bg-prepay"
                      : "border-stone-300 bg-white",
                  )}
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 16 16"
                    fill="none"
                    aria-hidden="true"
                  >
                    <path
                      d="M3 8.5l3 3 7-7"
                      stroke="#fff"
                      strokeWidth="2.4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
                <span className="w-2.5 text-[11px] text-stone-400">
                  {row.number}
                </span>
                <span className="min-w-0 flex-1 truncate font-extrabold text-[15px]">
                  {row.name}
                </span>
                {row.discount > 0 && (
                  <span className="flex-none rounded bg-green-50 px-1.5 py-0.5 font-bold text-green-700 text-xs tabular-nums">
                    割引 {formatYen(-row.discount)}
                  </span>
                )}
                <span className="flex-none font-bold text-[15px] tabular-nums">
                  {formatYen(row.price)}
                </span>
              </button>
              {row.canPreferDiscount && (
                <button
                  type="button"
                  onClick={() => onPreferDiscount(row.key)}
                  title="割引をこの商品に付け替えます"
                  className="mr-2 h-8 flex-none rounded-md border border-green-700 bg-white px-2 font-bold text-green-700 text-xs"
                >
                  割引をここに
                </button>
              )}
            </div>
          );
        })}
      </div>
      <div className="grid grid-cols-[1fr_auto] items-baseline gap-x-3 gap-y-0.5 rounded-lg border border-stone-200 bg-stone-50 px-3.5 py-3 tabular-nums">
        <span className="font-extrabold text-sm">個別小計</span>
        <span className="text-right font-extrabold text-2xl">
          {formatYen(amount)}
        </span>
        <span className="font-bold text-prepay text-xs">残りの商品</span>
        <span className="text-right font-extrabold text-[13px] text-prepay">
          {formatYen(remaining - amount)}
        </span>
      </div>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className={buttonClass.secondary}
        >
          戻る
        </button>
        <button
          type="button"
          onClick={confirm}
          disabled={!ok}
          className={buttonClass.primary}
        >
          この小計で会計
          <EnterTag />
        </button>
      </div>
    </PrepayDialogShell>
  );
};

// --------------------------------------------------
// 小計分割・一部金額先払い（金額を入れる）
// --------------------------------------------------

export const PartAmountDialog = ({
  open,
  baseLabel,
  base,
  presetLabel,
  onConfirm,
  onClose,
}: {
  open: boolean;
  /** 分ける小計の見出し（「小計」「個別小計の残り」など） */
  baseLabel: string;
  /** 分ける小計（の残り） */
  base: number;
  /** 端末で決済できなかったときの決済手段（「QR コード」）。その手段で先に払う。無ければ null */
  presetLabel: string | null;
  onConfirm: (amount: number) => void;
  onClose: () => void;
}) => {
  const [amount, setAmount] = useState("");
  useEffect(() => {
    if (open) setAmount("");
  }, [open]);
  const value = amount === "" ? 0 : Number(amount);
  const ok = checkPart(value, base, false).ok;
  const confirm = () => {
    if (ok) onConfirm(value);
  };

  useDialogKeys(open, (key) => {
    if (amountKey(key, setAmount)) return true;
    if (key === "Enter") {
      confirm();
      return true;
    }
    if (key === "Escape") {
      onClose();
      return true;
    }
    return false;
  });

  return (
    <PrepayDialogShell
      open={open}
      width={540}
      title="小計分割・一部金額先払い"
      sub="いまの小計のうち、先に払う金額を入れてください"
    >
      {presetLabel && (
        <div className="rounded-lg bg-prepay-soft px-3 py-2.5 font-medium text-[13px] text-prepay-ink leading-[1.6]">
          お客さんに{presetLabel}
          の残高を聞いて、使える額を入れてください。この額を
          {presetLabel}で払い、残りは別の方法で受け取ります。
        </div>
      )}
      <div className="grid grid-cols-[minmax(0,1fr)_200px] gap-4">
        <div className="flex flex-col gap-2.5">
          <div className="flex justify-between text-[13px] text-stone-600 tabular-nums">
            <span>{baseLabel}</span>
            <span className="font-extrabold text-stone-900">
              {formatYen(base)}
            </span>
          </div>
          <AmountField label="先に払う金額" amount={amount} />
          <PartSummary amount={amount} limit={base} afterPayment={false} />
        </div>
        <AmountPad
          onPress={(key) => setAmount((current) => pressAmount(current, key))}
        />
      </div>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className={buttonClass.secondary}
        >
          戻る
        </button>
        <button
          type="button"
          onClick={confirm}
          disabled={!ok}
          className={buttonClass.primary}
        >
          この小計で会計
          <EnterTag />
        </button>
      </div>
    </PrepayDialogShell>
  );
};

// --------------------------------------------------
// 割り勘の分け方を選ぶ（お客さんが端末で「割り勘」を選んだ）
// --------------------------------------------------

/** 分け方のボタン。押せないときは理由を出す */
const SplitChoiceButton = ({
  keyLabel,
  title,
  sub,
  blocked,
  onClick,
}: {
  /** 押すキー（1・2） */
  keyLabel: string;
  /** 題。行を折るときは、ここで分けたところだけで折る */
  title: string[];
  sub: string;
  /** 押せない理由。押せれば null */
  blocked: string | null;
  onClick: () => void;
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={blocked !== null}
    className="flex min-h-28 flex-col items-start gap-1.5 rounded-[10px] border border-prepay-line bg-white px-4 py-3.5 text-left hover:bg-prepay-tint disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-white"
  >
    <span className="flex w-full items-start gap-2">
      <span className="font-extrabold text-base text-prepay">
        {title.map((part) => (
          <span key={part} className="inline-block">
            {part}
          </span>
        ))}
      </span>
      <span className="flex-1" />
      <span className="mt-0.5 rounded border border-prepay-line px-1 font-bold text-[10px] text-prepay leading-[15px]">
        {keyLabel}
      </span>
    </span>
    <span className="text-[13px] text-stone-600 leading-[1.5]">{sub}</span>
    {blocked && (
      <span className="font-bold text-red-700 text-xs">{blocked}</span>
    )}
  </button>
);

/**
 * お客さんが端末で「割り勘」を選んだ。分け方を「個別小計」（商品で分ける）か
 * 「小計分割・一部金額先払い」（金額で分ける）から選ぶ。1・2 のキーでも選べる
 */
export const SplitChoiceDialog = ({
  open,
  due,
  itemsBlocked,
  partBlocked,
  onItems,
  onPart,
  onClose,
}: {
  open: boolean;
  /** 今払う額 */
  due: number;
  /** 個別小計・小計分割を選べない理由。選べれば null */
  itemsBlocked: string | null;
  partBlocked: string | null;
  onItems: () => void;
  onPart: () => void;
  onClose: () => void;
}) => {
  useDialogKeys(open, (key) => {
    if (key === "1") {
      if (itemsBlocked === null) onItems();
      return true;
    }
    if (key === "2") {
      if (partBlocked === null) onPart();
      return true;
    }
    if (key === "Escape") {
      onClose();
      return true;
    }
    return false;
  });

  return (
    <PrepayDialogShell
      open={open}
      width={540}
      title="割り勘"
      sub="お客さんが端末で選びました。分け方を選んでください"
      aside={
        <span className="font-bold text-sm text-stone-600 tabular-nums">
          小計 {formatYen(due)}
        </span>
      }
    >
      <div className="grid grid-cols-2 gap-2.5">
        <SplitChoiceButton
          keyLabel="1"
          title={["個別小計"]}
          sub="先に払う商品を選んで、その分を会計します"
          blocked={itemsBlocked}
          onClick={onItems}
        />
        <SplitChoiceButton
          keyLabel="2"
          title={["小計分割・", "一部金額先払い"]}
          sub="いまの小計を金額で分けて、先に払う額を入れます"
          blocked={partBlocked}
          onClick={onPart}
        />
      </div>
      <div className="flex items-center justify-end gap-3">
        <span className="text-stone-500 text-xs">
          戻ると、端末にまた決済手段を出します
        </span>
        <button
          type="button"
          onClick={onClose}
          className={buttonClass.secondary}
        >
          戻る
        </button>
      </div>
    </PrepayDialogShell>
  );
};

// --------------------------------------------------
// 受け取ったあと（金額で分けた・個別小計を払い終えた）
// --------------------------------------------------

/** 受け取った支払い */
export type ReceivedTender = {
  amount: number;
  methodLabel: string;
  /** 現金のときのお預かりとお釣り。Square なら null */
  cash: { received: number; change: number } | null;
};

/**
 * 小計分割で受け取ったあと。お釣りと小計の残りを出し、続けて次の金額を入れられる。
 * 金額を入れずに Enter（「残りを全て会計」）で、小計の残りをそのまま払う
 */
export const PartPaidDialog = ({
  open,
  tender,
  remainingLabel,
  remaining,
  final,
  onSplit,
  onPayRest,
}: {
  open: boolean;
  tender: ReceivedTender | null;
  /** 「残り」「個別小計の残り」 */
  remainingLabel: string;
  /** 小計の残り */
  remaining: number;
  /** 小計の残りが注文全体の残り（最後の会計） */
  final: boolean;
  onSplit: (amount: number) => void;
  onPayRest: () => void;
}) => {
  const [amount, setAmount] = useState("");
  useEffect(() => {
    if (open) setAmount("");
  }, [open]);
  const value = amount === "" ? 0 : Number(amount);
  const ok = checkPart(value, remaining, true).ok;
  const typed = amount !== "";

  useDialogKeys(open, (key) => {
    if (amountKey(key, setAmount)) return true;
    if (key === "Enter") {
      if (ok) onSplit(value);
      else if (!typed) onPayRest();
      return true;
    }
    return key === "Escape";
  });

  return (
    <PrepayDialogShell
      open={open}
      width={540}
      large
      icon={<CheckIcon />}
      title={`${formatYen(tender?.amount ?? 0)} を受け取りました`}
      aside={
        <span className="font-bold text-sm text-stone-600">
          {tender?.methodLabel}
        </span>
      }
    >
      {tender?.cash && tender.cash.change > 0 && (
        <ReceivedChange
          received={tender.cash.received}
          change={tender.cash.change}
        />
      )}
      <div className="flex items-baseline justify-between rounded-lg bg-prepay-soft px-3.5 py-3 text-prepay-ink">
        <span className="font-extrabold text-sm">{remainingLabel}</span>
        <span className="font-black text-2xl text-prepay tabular-nums">
          {formatYen(remaining)}
        </span>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_200px] gap-4">
        <div className="flex flex-col gap-2.5">
          <AmountField label="続けて分割する金額（次の小計）" amount={amount} />
          <PartSummary amount={amount} limit={remaining} afterPayment />
          <p className="m-0 text-stone-500 text-xs leading-[1.6]">
            金額を入れずに Enter で、残りを全て会計します。
          </p>
        </div>
        <AmountPad
          onPress={(key) => setAmount((current) => pressAmount(current, key))}
        />
      </div>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onPayRest}
          className={cn(
            "flex h-10 items-center gap-2 rounded-lg border px-4 font-extrabold text-sm",
            typed
              ? "border-stone-300 bg-white text-stone-900"
              : "border-stone-900 bg-stone-900 text-white",
          )}
        >
          {final ? "残りを全て会計（最終割勘）" : "残りを全て会計"}
          {!typed && <EnterTag />}
        </button>
        <button
          type="button"
          onClick={() => ok && onSplit(value)}
          disabled={!ok}
          className={buttonClass.primary}
        >
          この小計で会計
          {ok && <EnterTag />}
        </button>
      </div>
    </PrepayDialogShell>
  );
};

/** 個別小計を払い終えたあと。続けて個別小計か、残りを全て会計を選ぶ */
export const SubtotalPaidDialog = ({
  open,
  tender,
  remainingCount,
  remaining,
  canMoreItems,
  onMoreItems,
  onPayRest,
}: {
  open: boolean;
  tender: ReceivedTender | null;
  /** まだ払っていない商品の数と、注文の残り */
  remainingCount: number;
  remaining: number;
  /** 続けて個別小計を選べるか（まだ払っていない商品が 2 点以上） */
  canMoreItems: boolean;
  onMoreItems: () => void;
  onPayRest: () => void;
}) => {
  useDialogKeys(open, (key) => {
    if (key === "Enter") {
      onPayRest();
      return true;
    }
    return key === "Escape";
  });

  return (
    <PrepayDialogShell
      open={open}
      width={440}
      large
      icon={<CheckIcon />}
      title={`${formatYen(tender?.amount ?? 0)} を受け取りました`}
      aside={
        <span className="font-bold text-sm text-stone-600">
          {tender?.methodLabel}
        </span>
      }
    >
      {tender?.cash && tender.cash.change > 0 && (
        <ReceivedChange
          received={tender.cash.received}
          change={tender.cash.change}
        />
      )}
      <div className="flex items-baseline justify-between rounded-lg bg-prepay-soft px-3.5 py-3 text-prepay-ink">
        <span className="font-extrabold text-sm">
          残りの商品 {remainingCount}点
        </span>
        <span className="font-black text-2xl text-prepay tabular-nums">
          {formatYen(remaining)}
        </span>
      </div>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onMoreItems}
          disabled={!canMoreItems}
          className={buttonClass.secondary}
        >
          続けて個別小計
        </button>
        <button
          type="button"
          onClick={onPayRest}
          className={buttonClass.primary}
        >
          残りを全て会計
          <EnterTag />
        </button>
      </div>
    </PrepayDialogShell>
  );
};

// --------------------------------------------------
// 先払いの返金（取り消し）
// --------------------------------------------------

/** 返金する支払い */
export type RefundRow = {
  id: number;
  label: string;
  amount: number;
  dot: string;
  /** Square の決済依頼の ID。現金なら null（手で返す） */
  squareCheckoutId: string | null;
};

/** Square の返金の結果。受け付けられなければ理由 */
export type SquareRefundResult = { ok: true } | { ok: false; message: string };

type RefundStatus =
  | { kind: "wait" }
  | { kind: "refunding" }
  | { kind: "done" }
  | { kind: "failed"; message: string };

export const RefundDialog = ({
  open,
  all,
  rows,
  refundSquare,
  onFinish,
  onClose,
}: {
  open: boolean;
  /** 先払いをすべて返金する（「先払いを取り消す」）。でなければ、その小計の分だけ（先会計の ×） */
  all: boolean;
  rows: RefundRow[];
  /** Square の決済を全額返金する */
  refundSquare: (checkoutId: string) => Promise<SquareRefundResult>;
  /** 全部返し終えて閉じた。返した支払いを外す */
  onFinish: () => void;
  onClose: () => void;
}) => {
  const [stage, setStage] = useState<"confirm" | "running">("confirm");
  const [statuses, setStatuses] = useState<Record<number, RefundStatus>>({});
  useEffect(() => {
    if (open) {
      setStage("confirm");
      setStatuses({});
    }
  }, [open]);
  const finished =
    stage === "running" &&
    rows.every((row) => statuses[row.id]?.kind === "done");

  const setStatus = (id: number, status: RefundStatus) =>
    setStatuses((current) => ({ ...current, [id]: status }));

  const refund = async (row: RefundRow) => {
    if (row.squareCheckoutId === null) return;
    setStatus(row.id, { kind: "refunding" });
    const result = await refundSquare(row.squareCheckoutId);
    setStatus(
      row.id,
      result.ok
        ? { kind: "done" }
        : { kind: "failed", message: result.message },
    );
  };

  const start = () => {
    if (stage !== "confirm") return;
    setStage("running");
    setStatuses(
      Object.fromEntries(
        rows.map((row) => [
          row.id,
          row.squareCheckoutId === null
            ? ({ kind: "wait" } as const)
            : ({ kind: "refunding" } as const),
        ]),
      ),
    );
    for (const row of rows) {
      void refund(row);
    }
  };

  useDialogKeys(open, (key) => {
    if (key === "Enter") {
      if (stage === "confirm") start();
      else if (finished) onFinish();
      return true;
    }
    if (key === "Escape") {
      if (stage === "confirm") onClose();
      return true;
    }
    return false;
  });

  return (
    <PrepayDialogShell
      open={open}
      width={440}
      icon={<WarningIcon />}
      title={
        all ? "先払いをすべて返金しますか" : "この小計の先払いを取り消しますか"
      }
    >
      <div className="flex flex-col gap-px overflow-hidden rounded-lg border border-stone-200 bg-stone-200">
        {rows.map((row) => {
          const status = statuses[row.id];
          const cash = row.squareCheckoutId === null;
          return (
            <div
              key={row.id}
              className="flex min-h-9 items-center gap-2.5 bg-white py-2.75 pr-3 pl-3.5"
            >
              <span
                className="h-2 w-2 flex-none rounded-[2px]"
                style={{ backgroundColor: row.dot }}
              />
              <div className="flex flex-1 flex-col gap-px">
                <span className="font-extrabold text-[15px] tabular-nums">
                  {row.label}　{formatYen(row.amount)}
                </span>
                <span className="text-stone-500 text-xs">
                  {cash ? "お客さんに手で返します" : "Square で返金します"}
                </span>
                {status?.kind === "failed" && (
                  <span className="text-red-700 text-xs leading-normal">
                    返金できませんでした: {status.message}
                  </span>
                )}
              </div>
              {status?.kind === "refunding" && (
                <span className="flex items-center gap-1.5 font-bold text-stone-600 text-xs">
                  <Spinner />
                  返金しています
                </span>
              )}
              {status?.kind === "done" && (
                <span className="flex items-center gap-1.25 font-extrabold text-green-700 text-xs">
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 16 16"
                    fill="none"
                    aria-hidden="true"
                  >
                    <path
                      d="M3 8.5l3 3 7-7"
                      stroke="#15803d"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  {cash ? "返しました" : "返金しました"}
                </span>
              )}
              {status?.kind === "wait" && (
                <button
                  type="button"
                  onClick={() => setStatus(row.id, { kind: "done" })}
                  className="h-8 rounded-[7px] border border-stone-900 bg-white px-3 font-extrabold text-[13px] text-stone-900"
                >
                  返した
                </button>
              )}
              {status?.kind === "failed" && (
                <div className="flex flex-none flex-col gap-1">
                  <button
                    type="button"
                    onClick={() => void refund(row)}
                    className="h-8 rounded-[7px] border border-stone-900 bg-white px-2.5 font-extrabold text-stone-900 text-xs"
                  >
                    もう一度
                  </button>
                  <button
                    type="button"
                    onClick={() => setStatus(row.id, { kind: "done" })}
                    title="Square で返金できない（交通系 IC など）ときは、現金で返して押す"
                    className="h-8 rounded-[7px] border border-stone-300 bg-white px-2.5 font-bold text-stone-700 text-xs"
                  >
                    現金で返した
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="m-0 text-[13px] text-stone-500 leading-[1.6]">
        {finished
          ? "返金が済みました。残りの額が戻っています。"
          : all
            ? "注文はまだ登録していません。返金が済むと、商品を変えられるようになります。"
            : "この小計で受け取った分をまとめて返します。ほかの小計の先払いはそのままです。"}
      </p>
      <div className="flex justify-end gap-2">
        {stage === "confirm" && (
          <>
            <button
              type="button"
              onClick={onClose}
              className={buttonClass.secondary}
            >
              戻る
            </button>
            <button
              type="button"
              onClick={start}
              className="flex h-10 items-center gap-2 rounded-lg bg-red-600 px-4 font-extrabold text-sm text-white"
            >
              返金する
              <EnterTag />
            </button>
          </>
        )}
        {finished && (
          <button
            type="button"
            onClick={onFinish}
            className={buttonClass.primary}
          >
            閉じる
            <EnterTag />
          </button>
        )}
      </div>
    </PrepayDialogShell>
  );
};

// --------------------------------------------------
// 注文全体を払い終えた
// --------------------------------------------------

/** 会計しましたに出す支払いの行 */
export type SettledRow = {
  id: number;
  label: string;
  amount: number;
  dot: string;
};

export const SettledDialog = ({
  open,
  orderId,
  rows,
  total,
  lastCash,
  onClose,
}: {
  open: boolean;
  orderId: number;
  rows: SettledRow[];
  /** 支払いの合計（請求額） */
  total: number;
  /** 最後の支払いが現金なら、そのお預かりとお釣り */
  lastCash: { received: number; change: number } | null;
  onClose: () => void;
}) => {
  useDialogKeys(open, (key) => {
    if (key === "Enter") {
      onClose();
      return true;
    }
    return key === "Escape";
  });

  return (
    <PrepayDialogShell
      open={open}
      width={440}
      large
      icon={<CheckIcon />}
      title="会計しました"
      aside={
        <span className="font-bold text-[15px] text-stone-600">
          No.{orderId}
        </span>
      }
    >
      <div className="flex flex-col gap-1.5 text-sm text-stone-700 tabular-nums">
        {rows.map((row) => (
          <div key={row.id} className="flex items-center gap-2">
            <span
              className="h-2 w-2 rounded-[2px]"
              style={{ backgroundColor: row.dot }}
            />
            <span className="flex-1">{row.label}</span>
            <span className="font-bold">{formatYen(row.amount)}</span>
          </div>
        ))}
        <div className="mt-0.5 flex justify-between border-stone-200 border-t pt-2 font-extrabold text-[15px] text-stone-900">
          <span>合計</span>
          <span>{formatYen(total)}</span>
        </div>
      </div>
      {lastCash && (
        <ReceivedChange received={lastCash.received} change={lastCash.change} />
      )}
      <div className="flex justify-end">
        <button type="button" onClick={onClose} className={buttonClass.primary}>
          次の注文へ
          <EnterTag />
        </button>
      </div>
    </PrepayDialogShell>
  );
};
