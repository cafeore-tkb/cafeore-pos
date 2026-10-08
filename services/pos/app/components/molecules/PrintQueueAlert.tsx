import {
  type OrderEntity,
  type PrintJob,
  cancelPrintJob,
  isStalePrintJob,
  orderCupLabels,
  printJobSourceLabel,
  retryPrintJob,
} from "@cafeore/common";
import { AlertTriangle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useCurrentTime } from "~/components/functional/useCurrentTime";
import { usePrintStation } from "~/label/PrintStation";
import { useOrdersWSContext } from "~/routes/context/OrdersWSContext";
import { Button } from "../ui/button";

// 待ちのまま、この時間たっても印刷されない仕事があれば知らせる（印刷する端末がいない・プリンターが止まっているなど）
const QUEUED_TOO_LONG_MS = 30_000;

/** 仕事の説明（「No.12 緊急 ケニア 3/3（マスター）」など）。カップの名前は今の注文から引く */
export const describePrintJob = (
  job: PrintJob,
  orders: OrderEntity[] | undefined,
): string => {
  const source = `（${printJobSourceLabel(job.source)}）`;
  if (job.kind === "order") return `No.${job.orderNo} のラベル${source}`;
  const order = orders?.find((o) => o.id === job.orderId);
  const label =
    order && job.cupId
      ? orderCupLabels(order).find((l) => l.cupId === job.cupId)
      : undefined;
  const cup = label ? ` ${label.name} ${label.index}/${label.total}` : "";
  return `No.${job.orderNo} 緊急${cup}${source}`;
};

/**
 * 印刷キューの困りごと（失敗・印刷中のまま止まった仕事・長く待っている仕事・プリンター未接続）を画面の隅に出す。
 * 失敗と止まった仕事は「もう一度印刷」か「取り消す」を選べる
 */
export const PrintQueueAlert = () => {
  const { printJobs, orders } = useOrdersWSContext();
  const { enabled, printerStatus, reconnect, lastError } = usePrintStation();
  const now = useCurrentTime(5000).getTime();
  const [busy, setBusy] = useState<number | null>(null);

  const jobs = printJobs ?? [];
  const problems = jobs.filter(
    (job) => job.status === "failed" || isStalePrintJob(job, now),
  );
  const waiting = jobs.filter(
    (job) =>
      job.status === "queued" &&
      now - job.createdAt.getTime() > QUEUED_TOO_LONG_MS,
  );
  const printerDown = enabled && printerStatus === "disconnected";

  if (
    problems.length === 0 &&
    waiting.length === 0 &&
    !printerDown &&
    !lastError
  )
    return null;

  const act = async (
    job: PrintJob,
    action: typeof retryPrintJob,
    done: string,
  ) => {
    setBusy(job.id);
    const { error } = await action(job.id);
    setBusy(null);
    if (error !== undefined) toast.error(error);
    else toast(`${describePrintJob(job, orders)}：${done}`);
  };

  return (
    <aside
      aria-label="印刷キューの知らせ"
      className="fixed bottom-4 left-4 z-[200] w-[min(440px,calc(100vw-2rem))] space-y-2 rounded-lg border-2 border-red-500 bg-white p-3 text-sm shadow-xl"
    >
      <div className="flex items-center gap-2 font-bold text-red-700">
        <AlertTriangle className="h-4 w-4" />
        ラベルの印刷
      </div>
      {printerDown && (
        <div className="flex items-center justify-between gap-2">
          <span>この端末のプリンターにつながっていません</span>
          <Button type="button" size="sm" variant="outline" onClick={reconnect}>
            再接続
          </Button>
        </div>
      )}
      {lastError && <div className="text-red-700">{lastError}</div>}
      {problems.map((job) => (
        <div
          key={job.id}
          className="flex items-center justify-between gap-2 border-t pt-2"
          data-print-job={job.id}
        >
          <div className="min-w-0">
            <div className="break-words font-bold">
              {describePrintJob(job, orders)}
            </div>
            <div className="text-red-700 text-xs">
              {job.status === "failed"
                ? `失敗：${job.error ?? "印刷できませんでした"}`
                : "印刷中のまま止まっています"}
            </div>
          </div>
          <div className="flex shrink-0 gap-1">
            <Button
              type="button"
              size="sm"
              disabled={busy === job.id}
              onClick={() => act(job, retryPrintJob, "もう一度印刷します")}
            >
              もう一度印刷
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy === job.id}
              onClick={() => act(job, cancelPrintJob, "取り消しました")}
            >
              取り消す
            </Button>
          </div>
        </div>
      ))}
      {waiting.length > 0 && (
        <div className="border-t pt-2">
          印刷待ちが {waiting.length} 件、30
          秒以上たっています。「この端末で印刷する」の端末とプリンターを確かめてください
        </div>
      )}
    </aside>
  );
};
