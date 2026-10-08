import type { InventoryStatus } from "@cafeore/common";
import dayjs from "dayjs";
import { Coffee, ExternalLink } from "lucide-react";
import type React from "react";
import { fmt, stockView } from "~/lib/inventory";

interface BeanQueueViewProps {
  /** POS の在庫のうち豆（kind が bean）の残量。API の値をそのまま出す */
  statuses: InventoryStatus[];
  isLoading: boolean;
  error: unknown;
  /** 盤面で待っている（未割当・待機・抽出中の）杯数（在庫対象の ID ごと。logic/beans.ts の waitingCupsByBean。無い豆は 0 杯）。実データテスト中は出さない */
  waitingCups?: Map<string, number>;
}

// 豆のパネル。POS の在庫（/inventory）の豆を表示するだけで、CaOS では在庫を持たない・減らさない。
// 棚卸し・入荷・設定は POS の在庫の画面で行う。
export const BeanQueueView: React.FC<BeanQueueViewProps> = ({
  statuses,
  isLoading,
  error,
  waitingCups,
}) => (
  <div className="space-y-3">
    <div className="flex items-start justify-between gap-2 border-slate-200 border-b pb-3">
      <div>
        <h2 className="flex items-center gap-2 font-black text-[16px] text-slate-900 tracking-tight">
          <Coffee className="h-5 w-5 text-[#006c4a]" />
          <span>豆キュー</span>
        </h2>
        <p className="mt-0.5 text-slate-500 text-xs">
          POS の在庫の豆の残量（30秒ごとに更新）
        </p>
      </div>
      <a
        href="/inventory"
        target="_blank"
        rel="noopener noreferrer"
        className="flex min-h-[44px] shrink-0 items-center justify-center gap-1.5 rounded-lg bg-[#006c4a] px-3 py-2 font-bold text-white text-xs shadow-xs hover:bg-[#005137] active:scale-95"
      >
        <ExternalLink className="h-4 w-4" />
        <span>在庫の画面で記録</span>
      </a>
    </div>

    {/* 在庫は取れて使用量だけ読めないときも、カードの豆が空になるので必ず出す */}
    {error ? (
      <p className="rounded-lg border border-red-200 bg-red-50 p-3 font-bold text-red-800 text-xs">
        在庫を読み込めませんでした（{String(error)}）
      </p>
    ) : null}
    <BeanStockList
      statuses={statuses}
      isLoading={isLoading}
      error={error}
      waitingCups={waitingCups}
    />
  </div>
);

// 豆の一覧。豆が 1 つも出せないときは、読み込み中か、豆の在庫対象が無いことを出す（読めなかったときは上の帯だけ）
const BeanStockList: React.FC<BeanQueueViewProps> = ({
  statuses,
  isLoading,
  error,
  waitingCups,
}) => {
  if (statuses.length > 0)
    return (
      <div className="grid grid-cols-1 gap-2">
        {statuses.map((status) => (
          <BeanStockCard
            key={status.resource.id}
            status={status}
            waitingCups={
              waitingCups && (waitingCups.get(status.resource.id) ?? 0)
            }
          />
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
      豆の在庫対象がまだありません。
      <a
        href="/inventory/settings"
        target="_blank"
        rel="noopener noreferrer"
        className="font-bold text-blue-700 underline"
      >
        在庫の設定
      </a>
      で追加してください。
    </p>
  );
};

// 残量の段階ごとの枠の色
const levelBorder: Record<InventoryStatus["level"], string> = {
  ok: "border-slate-300",
  untracked: "border-slate-300",
  warning: "border-amber-400",
  critical: "border-red-400",
};

const BeanStockCard: React.FC<{
  status: InventoryStatus;
  waitingCups?: number;
}> = ({ status, waitingCups }) => {
  const { resource } = status;
  const view = stockView(status);
  const servings = status.remaining_servings;
  const remaining = status.remaining;
  const countedAt =
    status.counted_quantity != null && status.counted_at
      ? dayjs(status.counted_at)
      : null;

  return (
    <div
      className={`rounded-xl border bg-white p-3 shadow-xs ${levelBorder[status.level]}`}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="truncate font-black text-[15px] text-slate-950">
          {resource.name}
        </h3>
        <span
          className={`shrink-0 rounded px-2 py-0.5 font-bold text-xs ${view.className}`}
        >
          {view.label}
        </span>
      </div>
      <div className="mt-1 flex items-baseline justify-between gap-2">
        <span className="font-black font-mono text-[26px] text-slate-950 tabular-nums">
          {servings == null ? "—" : `${fmt(Math.floor(servings))} 杯`}
        </span>
        {waitingCups !== undefined && (
          <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 font-bold text-[11px] text-slate-700">
            盤面に {waitingCups} 杯
          </span>
        )}
      </div>
      <div className="text-[11px] text-slate-600 tabular-nums">
        {remaining != null && `推定 ${fmt(remaining)} ${resource.unit} ・ `}
        1杯 {fmt(resource.per_serving, 1)} {resource.unit} ・ バッファ{" "}
        {fmt(resource.buffer)} 杯
      </div>
      <div className="mt-1 text-[11px] text-slate-700 tabular-nums">
        直近1時間 {status.servings_last_hour} 杯
        {view.emptyIn && ` → 約 ${view.emptyIn}で切れる見込み`}
      </div>
      <div className="text-[11px] text-slate-500">
        {countedAt
          ? `最終棚卸し ${countedAt.format("M/D HH:mm")}・以降 ${status.servings} 杯`
          : "まだ棚卸ししていません"}
      </div>
    </div>
  );
};
