import { INVENTORY_REFRESH_MS, type InventoryStatus } from "@cafeore/common";
import { Coffee } from "lucide-react";
import type React from "react";
import { StockCard } from "~/components/organisms/inventory/StockCard";

interface BeanQueueViewProps {
  /** POS の在庫のうち、抽出が要るアイテムの在庫の残量。API の値をそのまま出す */
  statuses: InventoryStatus[];
  isLoading: boolean;
  /** 在庫（残量）を読めなかったときのエラー */
  inventoryError: unknown;
  /** 盤面で待っている（未割当・待機・抽出中の）杯数（在庫対象の ID ごと。logic/beans.ts の waitingCupsByBean。無い豆は 0 杯）。実データテスト中は出さない */
  waitingCups?: Map<string, number>;
  /** 棚卸し・入荷を記録したあとに呼ぶ（在庫を取り直す）。実データテスト中は渡さず、記録の欄を出さない */
  onRecorded?: () => void;
}

// 豆のパネル。POS の在庫（/inventory）の豆を、在庫の画面と同じカードで出す（棚卸し・入荷もここから記録できる）。
// CaOS では在庫を持たない・減らさない。アイテムの在庫は POS でアイテムを作ると一緒にできる。
export const BeanQueueView: React.FC<BeanQueueViewProps> = (props) => (
  <div className="space-y-3">
    <div className="border-slate-200 border-b pb-3">
      <h2 className="flex items-center gap-2 font-black text-[16px] text-slate-900 tracking-tight">
        <Coffee className="h-5 w-5 text-[#006c4a]" />
        <span>豆キュー</span>
      </h2>
      <p className="mt-0.5 text-slate-500 text-xs">
        POS の在庫の豆の残量（{INVENTORY_REFRESH_MS / 1000}秒ごとに更新）
      </p>
    </div>

    {props.inventoryError ? (
      <p className="rounded-lg border border-red-200 bg-red-50 p-3 font-bold text-red-800 text-xs">
        在庫を読み込めませんでした（{String(props.inventoryError)}）
      </p>
    ) : null}
    <BeanStockList {...props} />
  </div>
);

// 豆の一覧。豆が 1 つも出せないときは、読み込み中か、豆の在庫対象が無いことを出す（読めなかったときは上の帯だけ）
const BeanStockList: React.FC<BeanQueueViewProps> = ({
  statuses,
  isLoading,
  inventoryError,
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
                盤面に {waitingCups.get(status.resource.id) ?? 0}{" "}
                杯（残量から引き済み）
              </div>
            )}
          </StockCard>
        ))}
      </div>
    );
  if (inventoryError) return null;
  if (isLoading)
    return (
      <p className="py-8 text-center text-slate-500 text-xs">読み込み中…</p>
    );
  return (
    <p className="rounded-xl border border-dashed bg-slate-50 py-10 text-center text-slate-500 text-xs">
      アイテムの在庫がまだありません。
    </p>
  );
};
