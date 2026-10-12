import { memo } from "react";
import { Button } from "../ui/button";

type props = {
  /** 端末に残っている数（刷れなかったシール・送れていない CaOS の操作） */
  count: number;
  /** 今すぐ送り直す */
  onRetry: () => void;
  /** 残っているものの名前と、送り直すボタンの文（CaOS の送れていない操作は「未送信」「もう一度送る」） */
  label?: string;
  retryLabel?: string;
};

/** 端末に残っている数と送り直すボタン（既定は刷れなかったシールの「未印刷」「もう一度刷る」）。残りが無ければ何も出さない */
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
