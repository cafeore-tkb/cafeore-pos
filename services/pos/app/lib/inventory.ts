import type { InventoryLevel, InventoryStatus } from "@cafeore/common";

// 在庫の残量の表示。在庫の画面（/inventory）と CaOS の豆のパネルで同じにする。

const LEVELS: Record<InventoryLevel, { label: string; className: string }> = {
  ok: { label: "十分", className: "bg-emerald-100 text-emerald-900" },
  warning: { label: "少なめ", className: "bg-amber-100 text-amber-900" },
  critical: { label: "危険", className: "bg-red-100 text-red-900" },
  untracked: { label: "未計測", className: "bg-muted text-muted-foreground" },
};

/** 数を「1,234」の形に（小数は digits 桁まで） */
export const fmt = (v: number, digits = 0) =>
  v.toLocaleString("ja-JP", { maximumFractionDigits: digits });

/** 時間を「45 分」「1 時間 30 分」「12 時間」の形に */
export const formatHours = (hours: number) => {
  const minutes = Math.round(hours * 60);
  if (minutes < 60) return `${minutes} 分`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 || h >= 10 ? `${h} 時間` : `${h} 時間 ${m} 分`;
};

/** 残量の札（label・className）と、直近1時間の売れ方が続いたとして切れるまでの時間（emptyIn。見込めなければ null） */
export const stockView = (status: InventoryStatus) => {
  const servings = status.remaining_servings ?? 0;
  const perHour = status.servings_last_hour;
  return {
    ...LEVELS[status.level],
    emptyIn:
      servings > 0 && perHour > 0 ? formatHours(servings / perHour) : null,
  };
};
