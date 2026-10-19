import { useColorSettings } from "@cafeore/common";
import { useEffect, useState } from "react";
import { cn } from "~/lib/utils";
import { formatYen } from "~/lib/yen";
import type { CashierLine } from "../../functional/cashierDraft";
import {
  MAX_ORDER_SPLIT,
  type OrderSplit,
  orderSplitGroups,
  splitGroupOf,
} from "../../functional/cashierOrderSplit";
import { menuColor } from "./MenuPanel";
import {
  EnterTag,
  PrepayDialogShell,
  buttonClass,
  useDialogKeys,
} from "./PrepayDialogs";

/**
 * 分け方を編集（分割して一括会計）
 *
 * 商品ごとに注文番号を選ぶ。注文は 4 件まで足せ、商品の無い注文は外せる（2 件より少なくはしない）。
 * 商品の無い注文があるときは決められない。まだ分割を推奨する注文があっても決められる（知らせるだけ）。
 * 数字キーで、その番号の商品の注文を次に切り替える。Enter で決め、Esc で戻る。
 */
export const OrderSplitDialog = ({
  open,
  lines,
  initial,
  firstOrderId,
  total,
  onConfirm,
  onClose,
}: {
  open: boolean;
  lines: readonly CashierLine[];
  /** 今の分け方 */
  initial: OrderSplit | null;
  /** 1 つ目の注文番号 */
  firstOrderId: number;
  /** 小計（全額） */
  total: number;
  onConfirm: (split: OrderSplit) => void;
  onClose: () => void;
}) => {
  const { colorSettings } = useColorSettings();
  const [split, setSplit] = useState<OrderSplit | null>(initial);
  useEffect(() => {
    if (open) setSplit(initial);
  }, [open, initial]);

  const groups =
    split === null ? [] : orderSplitGroups(lines, split, firstOrderId);
  const empty = groups.some((group) => group.lines.length === 0);
  const warned = groups.filter((group) => group.needsSplit);
  const message = empty
    ? "商品の無い注文があります。商品を移すか、注文を外してください"
    : warned.length > 0
      ? `${warned.map((group) => `No.${group.orderId}`).join("・")} はまだドリッパーを 3 人以上使います。このまま会計もできます`
      : "";

  const setGroup = (key: number, group: number) =>
    setSplit((current) =>
      current === null
        ? current
        : { ...current, assign: { ...current.assign, [key]: group } },
    );
  const addGroup = () =>
    setSplit((current) =>
      current === null || current.count >= MAX_ORDER_SPLIT
        ? current
        : { ...current, count: current.count + 1 },
    );
  const removeGroup = (group: number) =>
    setSplit((current) =>
      current === null || current.count <= 2
        ? current
        : {
            count: current.count - 1,
            assign: Object.fromEntries(
              Object.entries(current.assign).map(([key, value]) => [
                key,
                value > group ? value - 1 : value,
              ]),
            ),
          },
    );
  const confirm = () => {
    if (split !== null && !empty) onConfirm(split);
  };

  useDialogKeys(open, (key) => {
    if (/^[1-9]$/.test(key)) {
      const line = lines[Number(key) - 1];
      if (line && split !== null) {
        setGroup(line.key, (splitGroupOf(split, line.key) + 1) % split.count);
      }
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
      width={600}
      title="分け方を編集"
      sub="商品を注文番号ごとに分けます。会計は全額まとめて 1 回です（数字キーで注文を切り替えられます）"
    >
      <div className="flex gap-2">
        {groups.map((group) => {
          const isEmpty = group.lines.length === 0;
          return (
            <div
              key={group.index}
              className={cn(
                "flex min-w-0 flex-1 basis-0 flex-col gap-0.5 rounded-lg border-[1.5px] px-3 pt-2.25 pb-2.5",
                group.needsSplit
                  ? "border-red-200 bg-red-50"
                  : isEmpty
                    ? "border-stone-200 bg-stone-50"
                    : "border-stone-200 bg-white",
              )}
            >
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-[11px] text-stone-500">
                  注文{group.index + 1}
                </span>
                <span className="flex-1" />
                {isEmpty && groups.length > 2 && (
                  <button
                    type="button"
                    onClick={() => removeGroup(group.index)}
                    className="h-5.5 rounded-[5px] border border-stone-300 bg-white px-1.75 font-bold text-[11px] text-stone-600"
                  >
                    外す
                  </button>
                )}
              </div>
              <span className="font-extrabold text-[17px] tabular-nums">
                No.{group.orderId}
              </span>
              <span className="text-stone-600 text-xs tabular-nums">
                {isEmpty
                  ? "商品なし"
                  : `${group.lines.length}点 · ${group.cups}杯`}
              </span>
              {(isEmpty || group.needsSplit) && (
                <span
                  className={cn(
                    "font-bold text-xs",
                    isEmpty ? "text-stone-500" : "text-red-700",
                  )}
                >
                  {isEmpty ? "商品を移してください" : "まだ分割を推奨"}
                </span>
              )}
            </div>
          );
        })}
        {split !== null && split.count < MAX_ORDER_SPLIT && (
          <button
            type="button"
            onClick={addGroup}
            className="flex w-22 flex-none items-center justify-center rounded-lg border-[1.5px] border-stone-300 border-dashed bg-white font-bold text-[13px] text-stone-600 leading-[1.4] hover:bg-stone-50"
          >
            ＋ 注文を
            <br />
            追加
          </button>
        )}
      </div>

      <div className="flex max-h-[300px] flex-col gap-1.5 overflow-auto">
        {split !== null &&
          lines.map((line, index) => {
            const current = splitGroupOf(split, line.key);
            return (
              <div
                key={line.key}
                className="flex h-12 flex-none items-center gap-2.5 rounded-lg border-[1.5px] border-stone-200 bg-white pr-1.5 pl-3.5"
              >
                <span className="w-3 flex-none font-mono text-[11px] text-stone-400">
                  {index + 1}
                </span>
                <span
                  className="h-2 w-2 flex-none rounded-full"
                  style={{
                    backgroundColor:
                      menuColor(colorSettings, line.menu) ?? "#a8a29e",
                  }}
                />
                <span className="min-w-0 flex-1 truncate font-extrabold text-[15px]">
                  {line.menu.name}
                </span>
                <span className="flex-none font-bold text-[15px] tabular-nums">
                  {formatYen(line.menu.price)}
                </span>
                <div className="flex flex-none gap-0.5 rounded-lg bg-stone-100 p-0.75">
                  {groups.map((group) => {
                    const on = current === group.index;
                    return (
                      <button
                        key={group.index}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setGroup(line.key, group.index)}
                        className={cn(
                          "h-7.5 min-w-16 rounded-md px-2 font-extrabold text-xs tabular-nums",
                          on
                            ? "bg-stone-900 text-white"
                            : "bg-transparent text-stone-600",
                        )}
                      >
                        No.{group.orderId}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
      </div>

      <div className="grid grid-cols-[1fr_auto] items-baseline gap-x-3 gap-y-0.5 rounded-lg border border-stone-200 bg-stone-50 px-3.5 py-3 tabular-nums">
        <span className="font-extrabold text-sm">小計（全額）</span>
        <span className="text-right font-extrabold text-2xl">
          {formatYen(total)}
        </span>
      </div>

      {message && (
        <p
          className={cn(
            "m-0 text-xs",
            empty ? "text-red-700" : "text-stone-600",
          )}
        >
          {message}
        </p>
      )}

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
          disabled={split === null || empty}
          className={buttonClass.primary}
        >
          この分け方にする
          <EnterTag />
        </button>
      </div>
    </PrepayDialogShell>
  );
};
