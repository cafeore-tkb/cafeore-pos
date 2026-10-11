import { memo } from "react";
import { Button } from "../ui/button";

type props = {
  /** 刷れずに端末に残っているシールの数 */
  count: number;
  /** 今すぐ送り直す */
  onRetry: () => void;
};

/** 刷れなかったシールの数と「もう一度刷る」。残りが無ければ何も出さない */
export const PendingPrints = memo(
  ({ count, onRetry }: props) =>
    count > 0 && (
      <div className="flex items-center gap-2 font-bold text-red-600">
        未印刷 {count} 件
        <Button type="button" size="sm" variant="outline" onClick={onRetry}>
          もう一度刷る
        </Button>
      </div>
    ),
);
