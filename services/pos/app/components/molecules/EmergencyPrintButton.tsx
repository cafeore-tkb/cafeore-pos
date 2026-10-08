import { enqueueEmergencyPrint } from "@cafeore/common";
import { useState } from "react";
import { toast } from "sonner";
import { cn } from "~/lib/utils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "../ui/alert-dialog";

type props = {
  orderId: string;
  orderNo: number;
  cupId: string;
  /** カップの説明（「ケニア 2/3」など。そのカップのシールと同じ） */
  cupLabel: string;
  className?: string;
};

/**
 * マスターの緊急ボタン。押したカップの緊急の印刷（「緊急」のシール → そのカップの本物と同じシール）を印刷キューに積む。
 * カップを押す（準備完了の切り替え）と取り違えないよう、確かめてから積む
 */
export const EmergencyPrintButton = ({
  orderId,
  orderNo,
  cupId,
  cupLabel,
  className,
}: props) => {
  const [sending, setSending] = useState(false);

  const send = async () => {
    setSending(true);
    const { error } = await enqueueEmergencyPrint(orderId, cupId);
    setSending(false);
    if (error !== undefined) {
      toast.error(`緊急の印刷を積めませんでした：${error}`);
      return;
    }
    toast(`緊急 No.${orderNo} ${cupLabel}`, {
      description: "「緊急」のシールと、このカップと同じシールを印刷します",
    });
  };

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <button
          type="button"
          disabled={sending}
          aria-label={`No.${orderNo} ${cupLabel} の緊急のシールを印刷`}
          className={cn(
            "rounded-md border border-red-600 bg-white px-2 py-1 font-bold text-red-700 text-xs shadow-sm hover:bg-red-50 disabled:opacity-50",
            className,
          )}
        >
          緊急
        </button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            No.{orderNo} {cupLabel} の緊急のシールを印刷しますか？
          </AlertDialogTitle>
          <AlertDialogDescription>
            「緊急」とだけ書いたシールのあとに、このカップと全く同じシールが出ます。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>やめる</AlertDialogCancel>
          <AlertDialogAction
            className="bg-red-600 hover:bg-red-700"
            onClick={() => void send()}
          >
            印刷する
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
