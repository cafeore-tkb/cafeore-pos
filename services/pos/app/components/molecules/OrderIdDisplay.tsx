import { Pencil2Icon } from "@radix-ui/react-icons";
import { useCallback, useState } from "react";
import { useFocusRef } from "../functional/useFocusRef";

type Props = {
  orderId: number;
  isNeedManualOrderId: boolean;
  manualOrderId: number | null;
  onOrderIdOverride: (orderId: number | null) => void;
};

/**
 * 注文番号の表示・編集UI
 * 接続状態にかかわらず、番号の横の編集アイコンから手動採番できる
 */
const OrderIdDisplay = ({
  orderId,
  isNeedManualOrderId,
  manualOrderId,
  onOrderIdOverride,
}: Props) => {
  const [isEditingOrderId, setIsEditingOrderId] = useState(false);
  const [orderIdInputValue, setOrderIdInputValue] = useState("");
  const orderIdInputRef = useFocusRef<HTMLInputElement>(isEditingOrderId);

  const handleOrderIdClick = useCallback(() => {
    setIsEditingOrderId(true);
    setOrderIdInputValue(orderId.toString());
  }, [orderId]);

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
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        // 上下キーで番号を増減させない
        e.preventDefault();
      } else if (e.key === "Enter") {
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
          <span className="font-extrabold text-[28px]">No.</span>
          <input
            ref={orderIdInputRef}
            type="number"
            aria-label="注文番号"
            value={orderIdInputValue}
            onChange={handleOrderIdChange}
            onBlur={handleOrderIdBlur}
            onKeyDown={handleOrderIdKeyDown}
            className="w-24 rounded border-2 border-theme-primary px-2 py-0.5 font-extrabold text-[28px]"
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={handleOrderIdClick}
          className="flex items-center gap-2 font-extrabold text-[28px] hover:text-theme-primary"
          aria-label={`注文番号 No.${orderId} を編集`}
          title="クリックして番号を手動指定"
        >
          No.{orderId}
          <Pencil2Icon className="h-5 w-5" aria-hidden="true" />
        </button>
      )}
      {isNeedManualOrderId && (
        <span className="rounded bg-yellow-500 px-2 py-0.5 font-bold text-white text-xs">
          オフライン
        </span>
      )}
      {manualOrderId !== null && (
        <button
          type="button"
          onClick={() => onOrderIdOverride(null)}
          className="rounded bg-stone-400 px-2 py-0.5 font-bold text-white text-xs hover:bg-stone-500"
        >
          自動に戻す
        </button>
      )}
    </div>
  );
};

export { OrderIdDisplay };
