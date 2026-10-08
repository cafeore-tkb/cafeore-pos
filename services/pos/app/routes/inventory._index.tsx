import {
  type InventoryStatus,
  type StockEventKind,
  inventoryRepository,
  useInventory,
} from "@cafeore/common";
import dayjs from "dayjs";
import { useState } from "react";
import { Link, type MetaFunction } from "react-router";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { fmt, formatHours, stockView } from "~/lib/inventory";
import { cn } from "~/lib/utils";

export const meta: MetaFunction = () => {
  return [{ title: "在庫 / 珈琲・俺POS" }];
};

// この時間より前の棚卸しは、数え直しを促す色にする
const STALE_COUNT_HOURS = 3;

export default function InventoryPage() {
  const { statuses, error, isLoading, mutateInventory } = useInventory();

  if (isLoading) return <div className="p-4">読み込み中...</div>;
  if (error) return <div className="p-4">エラー: {String(error)}</div>;

  if (statuses.length === 0) {
    return (
      <div className="p-4">
        在庫対象がまだありません。
        <Link className="underline" to="/inventory/settings">
          設定
        </Link>
        からカップや豆を追加してください。
      </div>
    );
  }

  return (
    <div className="grid gap-4 p-4 md:grid-cols-2 xl:grid-cols-3">
      {statuses.map((status) => (
        <StockCard
          key={status.resource.id}
          status={status}
          onRecorded={() => void mutateInventory()}
        />
      ))}
    </div>
  );
}

function StockCard({
  status,
  onRecorded,
}: {
  status: InventoryStatus;
  onRecorded: () => void;
}) {
  const { resource } = status;
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const isCup = resource.kind === "cup";
  const view = stockView(status);
  const remaining = status.remaining ?? null;
  const servings = status.remaining_servings ?? null;
  const countedAt = status.counted_at ? dayjs(status.counted_at) : null;
  const hasCount = status.counted_quantity != null;
  const hoursSinceCount = countedAt
    ? dayjs().diff(countedAt, "minute") / 60
    : 0;
  const staleCount = !hasCount || hoursSinceCount >= STALE_COUNT_HOURS;

  const record = async (kind: StockEventKind) => {
    const quantity = Number(value);
    if (value.trim() === "" || Number.isNaN(quantity)) {
      toast("数量を入力してください");
      return;
    }
    if (kind === "count" && quantity < 0) {
      toast("実数は 0 以上で入力してください");
      return;
    }
    if (kind === "receipt" && quantity <= 0) {
      toast("入荷は 0 より大きい数で入力してください");
      return;
    }
    try {
      setSubmitting(true);
      const result = await inventoryRepository.recordEvent(
        resource.id,
        kind,
        quantity,
      );
      setValue("");
      if (kind === "count" && result.estimated != null) {
        const diff = quantity - result.estimated;
        const perServing =
          result.actual_per_serving != null && !isCup
            ? ` / 実測 ${fmt(result.actual_per_serving, 1)}${resource.unit}/杯`
            : "";
        toast(`${resource.name} を棚卸ししました`, {
          description: `推定 ${fmt(result.estimated)}${resource.unit} → 実数 ${fmt(quantity)}${resource.unit}（差 ${diff > 0 ? "+" : ""}${fmt(diff)}${resource.unit}）${perServing}`,
        });
      } else {
        toast(
          `${resource.name} に ${kind === "count" ? "実数" : "入荷"} ${fmt(quantity)}${resource.unit} を記録しました`,
        );
      }
      onRecorded();
    } catch (e) {
      toast(e instanceof Error ? e.message : "記録に失敗しました");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-lg border bg-card p-4 shadow-sm",
        status.level === "critical" && "border-red-400",
        status.level === "warning" && "border-amber-400",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground text-xs">
            {isCup ? "カップ" : "豆"}
          </span>
          <h2 className="font-semibold text-lg">{resource.name}</h2>
        </div>
        <span
          className={cn(
            "rounded px-2 py-0.5 font-medium text-sm",
            view.className,
          )}
        >
          {view.label}
        </span>
      </div>

      <div>
        <div className="font-bold text-3xl tabular-nums">
          {servings == null
            ? "—"
            : `${fmt(Math.floor(servings))} ${isCup ? "個" : "杯"}`}
        </div>
        <div className="text-muted-foreground text-sm tabular-nums">
          {remaining != null &&
            !isCup &&
            `推定 ${fmt(remaining)} ${resource.unit} ・ `}
          バッファ {fmt(resource.buffer)} 杯 ・ {fmt(resource.notify_from)}{" "}
          杯から {fmt(resource.notify_step)} 杯ごとに通知
        </div>
      </div>

      <div className="text-sm tabular-nums">
        直近1時間 {status.servings_last_hour} 杯
        {view.emptyIn && ` → 約 ${view.emptyIn}で切れる見込み`}
      </div>

      <div
        className={cn(
          "text-sm",
          staleCount ? "font-medium text-amber-700" : "text-muted-foreground",
        )}
      >
        {hasCount && countedAt
          ? `最終棚卸し ${countedAt.format("M/D HH:mm")}（${formatHours(hoursSinceCount)}前）・以降 ${status.servings} 杯`
          : "まだ棚卸ししていません"}
      </div>

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Input
            type="number"
            inputMode="decimal"
            min={0}
            placeholder={isCup ? "個数" : "グラム"}
            value={value}
            disabled={submitting}
            onChange={(e) => setValue(e.target.value)}
            className="pr-8"
          />
          <span className="-translate-y-1/2 pointer-events-none absolute top-1/2 right-3 text-muted-foreground text-sm">
            {resource.unit}
          </span>
        </div>
        <Button
          type="button"
          disabled={submitting}
          onClick={() => void record("count")}
        >
          実数で更新
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={submitting}
          onClick={() => void record("receipt")}
        >
          入荷を追加
        </Button>
      </div>
    </div>
  );
}
