import { memo } from "react";
import { Button } from "../ui/button";

type props = {
  /** 刷れずに端末に残っているシールの数 */
  count: number;
  /** 今すぐ送り直す */
  onRetry: () => void;
  /** 残っているものの名前と、送り直すボタンの文（CaOS の送れていない操作は「未送信」「もう一度送る」） */
  label?: string;
  retryLabel?: string;
};

/** 刷れなかったシールの数と「もう一度刷る」。残りが無ければ何も出さない */
export const PendingPrints = memo(
  ({ count, onRetry, label = "未印刷", retryLabel = "もう一度刷る" }: props) =>
    count > 0 && (
      <div className="flex shrink-0 items-center gap-2 whitespace-nowrap font-bold text-red-600">
        {label} {count} 件
        <Button type="button" size="sm" variant="outline" onClick={onRetry}>
          {retryLabel}
        </Button>
      </div>
    ),
);
