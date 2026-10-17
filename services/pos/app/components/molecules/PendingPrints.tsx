import { memo } from "react";
import { Button } from "../ui/button";

type props = {
  /** 端末に残っている刷れなかったシールの数 */
  count: number;
  /** 今すぐ刷り直す */
  onRetry: () => void;
};

/** 刷れずに端末に残っているシールの数と、刷り直すボタン。残りが無ければ何も出さない */
export const PendingPrints = memo(
  ({ count, onRetry }: props) =>
    count > 0 && (
      <div className="flex shrink-0 items-center gap-2 whitespace-nowrap font-bold text-red-600">
        未印刷 {count} 件
        <Button type="button" size="sm" variant="outline" onClick={onRetry}>
          もう一度刷る
        </Button>
      </div>
    ),
);
