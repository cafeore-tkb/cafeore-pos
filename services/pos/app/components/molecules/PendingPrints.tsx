import { memo } from "react";
import { Button } from "../ui/button";

type props = {
  /** 端末に残っている刷れなかったシールの数 */
  count: number;
  /** 今すぐ刷り直す */
  onRetry: () => void;
  /** 代理印刷をオンにしたレジに頼んで、まだ刷れていないシールの数（頼む画面だけ） */
  relayedCount?: number;
};

/**
 * 刷れずに端末に残っているシールの数と、刷り直すボタン。
 * レジに頼んだシールがまだ刷れていなければ、その数も出す（ずっと減らなければ、代理印刷をオンにしたレジが無い）。どちらも無ければ何も出さない
 */
export const PendingPrints = memo(
  ({ count, onRetry, relayedCount = 0 }: props) =>
    (count > 0 || relayedCount > 0) && (
      <div className="flex shrink-0 flex-col items-end gap-0.5 whitespace-nowrap font-bold text-red-600">
        {count > 0 && (
          <div className="flex items-center gap-2">
            未印刷 {count} 件
            <Button type="button" size="sm" variant="outline" onClick={onRetry}>
              もう一度刷る
            </Button>
          </div>
        )}
        {relayedCount > 0 && (
          <div
            className="text-orange-600"
            title="代理印刷をオンにしたレジが刷ります。減らないときは、レジのヘッダーの「代理印刷」をオンにしてください"
          >
            レジで印刷待ち {relayedCount} 件
          </div>
        )}
      </div>
    ),
);
