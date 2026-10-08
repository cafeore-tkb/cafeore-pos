import { type OrderEntity, markCaosEmergency } from "@cafeore/common";
import { useEffect, useState } from "react";
import { LuTriangleAlert } from "react-icons/lu";
import { toast } from "sonner";
import { cn } from "~/lib/utils";

// 確かめの表示を出しておく長さ
const CONFIRM_MS = 4000;

/**
 * マスターの緊急ボタン（カップ 1 杯ずつ）。押すと「緊急にする」に変わり、もう一度押すとカップを緊急（入れ直し）にする
 * （POST /api/caos/emergency。CaOS の入れ直しのパネルと同じ API）。
 * 緊急にしたカップは CaOS の未割当のいちばん上に出て、プリンターにつないだレジが緊急のシールを印刷する。
 * もう緊急のカップは、シールを印刷したかを出す（同じカップは 2 回緊急にしない）。抽出が要らないカップには出さない。
 */
export const EmergencyCupButton = ({
  order,
  cupId,
}: {
  order: OrderEntity;
  cupId: string;
}) => {
  const cup = order.cups.find((c) => c.id === cupId);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!confirming) return;
    const timer = window.setTimeout(() => setConfirming(false), CONFIRM_MS);
    return () => window.clearTimeout(timer);
  }, [confirming]);

  if (!cup || !cup.item.item_type.needs_brew) return null;

  if ((cup.emergencyAt ?? null) !== null) {
    return (
      <p className="flex items-center justify-center gap-1 rounded-md bg-red-100 py-1 font-bold text-red-700 text-xs">
        <LuTriangleAlert className="h-3.5 w-3.5 shrink-0" />
        {cup.emergencyPrintedAt ? "緊急・シール済み" : "緊急・シール待ち"}
      </p>
    );
  }

  const onClick = async () => {
    if (busy) return;
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    setBusy(true);
    const { error } = await markCaosEmergency([cupId], false);
    setBusy(false);
    if (error) {
      toast.error(error);
      return;
    }
    toast(`緊急 No.${order.orderId} ${cup.item.abbr}`, {
      description: "CaOS の未割当のいちばん上に出ます",
    });
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-label={confirming ? "緊急にする" : "緊急"}
      className={cn(
        "flex w-full items-center justify-center gap-1 rounded-md border py-1 font-bold text-xs transition-colors",
        confirming
          ? "border-red-600 bg-red-600 text-white"
          : "border-red-300 bg-white text-red-700 hover:bg-red-50",
        busy && "cursor-wait opacity-60",
      )}
    >
      <LuTriangleAlert className="h-3.5 w-3.5 shrink-0" />
      {confirming ? "緊急にする" : "緊急"}
    </button>
  );
};
