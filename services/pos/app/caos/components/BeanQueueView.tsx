import type { InventoryStatus } from "@cafeore/common";
import { Coffee } from "lucide-react";
import type React from "react";
import { StockCard } from "~/components/organisms/inventory/StockCard";

interface BeanQueueViewProps {
  /** POS の在庫のうち豆（kind が bean）の残量。API の値をそのまま出す */
  statuses: InventoryStatus[];
  isLoading: boolean;
  error: unknown;
  /** 盤面で待っている（未割当・待機・抽出中の）杯数（在庫対象の ID ごと。logic/beans.ts の waitingCupsByBean。無い豆は 0 杯）。実データテスト中は出さない */
  waitingCups?: Map<string, number>;
  /** 棚卸し・入荷を記録したあとに呼ぶ（在庫を取り直す） */
  onRecorded: () => void;
}

// 豆のパネル。POS の在庫（/inventory）の豆を、在庫の画面と同じカードで出す（棚卸し・入荷もここから記録できる）。
// CaOS では在庫を持たない・減らさない。豆の在庫対象の追加は POS の在庫の設定で行う。
export const BeanQueueView: React.FC<BeanQueueViewProps> = (props) => (
  <div className="space-y-3">
    <div className="border-slate-200 border-b pb-3">
      <h2 className="flex items-center gap-2 font-black text-[16px] text-slate-900 tracking-tight">
        <Coffee className="h-5 w-5 text-[#006c4a]" />
        <span>豆キュー</span>
      </h2>
      <p className="mt-0.5 text-slate-500 text-xs">
        POS の在庫の豆の残量（30秒ごとに更新）
      </p>
    </div>

    {/* 在庫は取れて使用量だけ読めないときも、カードの豆が空になるので必ず出す */}
    {props.error ? (
      <p className="rounded-lg border border-red-200 bg-red-50 p-3 font-bold text-red-800 text-xs">
        在庫を読み込めませんでした（{String(props.error)}）
      </p>
    ) : null}
    <BeanStockList {...props} />
  </div>
);

// 豆の一覧。豆が 1 つも出せないときは、読み込み中か、豆の在庫対象が無いことを出す（読めなかったときは上の帯だけ）
const BeanStockList: React.FC<BeanQueueViewProps> = ({
  statuses,
  isLoading,
  error,
  waitingCups,
  onRecorded,
}) => {
  if (statuses.length > 0)
    return (
      <div className="grid grid-cols-1 gap-2">
        {statuses.map((status) => (
          <StockCard
            key={status.resource.id}
            status={status}
            onRecorded={onRecorded}
          >
            {waitingCups && (
              <div className="text-sm tabular-nums">
                盤面に {waitingCups.get(status.resource.id) ?? 0} 杯
              </div>
            )}
          </StockCard>
        ))}
      </div>
    );
  if (error) return null;
  if (isLoading)
    return (
      <p className="py-8 text-center text-slate-500 text-xs">読み込み中…</p>
    );
  return (
    <p className="rounded-xl border border-dashed bg-slate-50 py-10 text-center text-slate-500 text-xs">
      豆の在庫対象がまだありません。POS の在庫の設定で追加してください。
    </p>
  );
};
