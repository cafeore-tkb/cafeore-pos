import type { InventoryLevel, InventoryStatus } from "@cafeore/common";

// 在庫の残量の表示。在庫の画面（/inventory）と CaOS の豆のパネルで同じにする。

export const levelStyle: Record<
  InventoryLevel,
  { label: string; className: string }
> = {
  ok: { label: "十分", className: "bg-emerald-100 text-emerald-900" },
  warning: { label: "少なめ", className: "bg-amber-100 text-amber-900" },
  critical: { label: "危険", className: "bg-red-100 text-red-900" },
  untracked: { label: "未計測", className: "bg-muted text-muted-foreground" },
};

export const fmt = (v: number, digits = 0) =>
  v.toLocaleString("ja-JP", { maximumFractionDigits: digits });

export const formatHours = (hours: number) => {
  const minutes = Math.round(hours * 60);
  if (minutes < 60) return `${minutes} 分`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 || h >= 10 ? `${h} 時間` : `${h} 時間 ${m} 分`;
};

// 直近1時間の売れ方が続いたとして、残りがなくなるまでの時間。見込めなければ null
export const hoursUntilEmpty = (status: InventoryStatus) => {
  const servings = status.remaining_servings ?? null;
  return servings != null && servings > 0 && status.servings_last_hour > 0
    ? servings / status.servings_last_hour
    : null;
};
