import { useCallback, useState } from "react";
import { cn } from "~/lib/utils";
import { useFocusRef } from "../functional/useFocusRef";

type Props = {
  orderId: number;
  isNeedManualOrderId: boolean;
  manualOrderId: number | null;
  onOrderIdOverride: (orderId: number | null) => void;
  onClearOverride: () => void;
};

/**
 * 注文番号の表示・編集UI
 * オフライン時や手動採番時はクリックで番号を編集できる
 */
const OrderIdDisplay = ({
  orderId,
  isNeedManualOrderId,
  manualOrderId,
  onOrderIdOverride,
  onClearOverride,
}: Props) => {
  const [isEditingOrderId, setIsEditingOrderId] = useState(false);
  const [orderIdInputValue, setOrderIdInputValue] = useState("");
  const orderIdInputRef = useFocusRef<HTMLInputElement>(isEditingOrderId);

  const handleOrderIdClick = useCallback(() => {
    if (isNeedManualOrderId || manualOrderId !== null) {
      setIsEditingOrderId(true);
      setOrderIdInputValue(orderId.toString());
    }
  }, [isNeedManualOrderId, manualOrderId, orderId]);

  const handleOrderIdChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setOrderIdInputValue(e.target.value);
    },
    [],
  );

  const handleOrderIdBlur = useCallback(() => {
    const trimmed = orderIdInputValue.trim();
    const parsed = Number.parseInt(trimmed, 10);
    // 先頭だけ数値の "12abc" などを弾く: 整数として正しい文字列のみ受け付ける
    if (
      trimmed !== "" &&
      !Number.isNaN(parsed) &&
      parsed > 0 &&
      String(parsed) === trimmed
    ) {
      onOrderIdOverride(parsed);
    }
    setIsEditingOrderId(false);
  }, [orderIdInputValue, onOrderIdOverride]);

  const handleOrderIdKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        handleOrderIdBlur();
      } else if (e.key === "Escape") {
        setIsEditingOrderId(false);
      }
    },
    [handleOrderIdBlur],
  );

  return (
    <div className="flex items-center gap-2">
      {isEditingOrderId ? (
        <div className="flex items-center gap-1">
          <span className="font-extrabold text-3xl">No.</span>
          <input
            ref={orderIdInputRef}
            type="number"
            value={orderIdInputValue}
            onChange={handleOrderIdChange}
            onBlur={handleOrderIdBlur}
            onKeyDown={handleOrderIdKeyDown}
            className="w-24 rounded border-2 border-theme px-2 py-1 font-extrabold text-3xl"
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={handleOrderIdClick}
          className={cn(
            "font-extrabold text-3xl",
            (isNeedManualOrderId || manualOrderId !== null) &&
              "cursor-pointer underline decoration-dotted hover:text-theme",
          )}
          title={
            isNeedManualOrderId
              ? "オフラインモード: クリックして番号を指定"
              : manualOrderId !== null
                ? "番号を手動指定中: クリックして変更"
                : undefined
          }
        >
          No.{orderId}
        </button>
      )}
      {isNeedManualOrderId && (
        <span className="rounded bg-yellow-500 px-2 py-1 text-sm text-white">
          オフライン
        </span>
      )}
      {manualOrderId !== null && (
        <button
          type="button"
          onClick={onClearOverride}
          className="rounded bg-gray-400 px-2 py-1 text-sm text-white hover:bg-gray-500"
        >
          自動に戻す
        </button>
      )}
    </div>
  );
};

export { OrderIdDisplay };
