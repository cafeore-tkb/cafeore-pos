import { CalendarClock, Play, X } from "lucide-react";
import type React from "react";
import { useMemo, useState } from "react";
import { ordersInPeriod, testPlaySlots } from "../logic/historical";
import type { HistoricalOrder } from "../types";

interface TestPlaySetupProps {
  orders: HistoricalOrder[];
  onClose: () => void;
  onStart: (startMs: number, durationMinutes: 30 | 60) => void;
}

const formatSlot = (timestamp: number) =>
  new Intl.DateTimeFormat("ja-JP", {
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(timestamp));

export const TestPlaySetup: React.FC<TestPlaySetupProps> = ({
  orders,
  onClose,
  onStart,
}) => {
  const [duration, setDuration] = useState<30 | 60>(30);
  const slots = useMemo(
    () => testPlaySlots(orders, duration),
    [orders, duration],
  );
  const [selectedStart, setSelectedStart] = useState<number | null>(null);
  const effectiveStart =
    selectedStart && slots.includes(selectedStart)
      ? selectedStart
      : (slots[0] ?? null);
  const selectedCount =
    effectiveStart === null
      ? 0
      : ordersInPeriod(
          orders,
          effectiveStart,
          effectiveStart + duration * 60_000,
        ).length;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-950/30 p-4 backdrop-blur-[2px]"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="w-[min(560px,92vw)] rounded-2xl border border-slate-300 bg-white p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 font-black text-[20px] text-slate-950">
              <CalendarClock className="h-5 w-5 text-blue-700" />
              2025実績でテストプレイ
            </h2>
            <p className="mt-1 font-medium text-[12px] text-slate-500">
              実際の注文を選択した速度で再生します（1xは実時間と同じ）
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-slate-100"
            aria-label="閉じる"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-5">
          <div className="mb-2 font-black text-[13px] text-slate-700">
            プレイ時間
          </div>
          <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1">
            {([30, 60] as const).map((minutes) => (
              <button
                key={minutes}
                type="button"
                onClick={() => {
                  setDuration(minutes);
                  setSelectedStart(null);
                }}
                className={`min-h-[48px] rounded-lg font-black text-[15px] ${duration === minutes ? "bg-slate-950 text-white shadow-sm" : "bg-white text-slate-600"}`}
              >
                {minutes === 30 ? "30分間" : "1時間"}
              </button>
            ))}
          </div>
        </div>

        <label className="mt-4 block">
          <span className="mb-2 block font-black text-[13px] text-slate-700">
            開始時間帯
          </span>
          <select
            value={effectiveStart || ""}
            disabled={slots.length === 0}
            onChange={(event) => setSelectedStart(Number(event.target.value))}
            className="min-h-[52px] w-full rounded-xl border border-slate-300 bg-white px-3 font-black text-[16px] text-slate-900"
          >
            {orders.length === 0 && <option>データがありません</option>}
            {orders.length > 0 && slots.length === 0 && (
              <option>利用できる時間帯がありません</option>
            )}
            {slots.map((slot) => {
              const count = orders.filter((order) => {
                const created = new Date(order.createdAt).getTime();
                return created >= slot && created < slot + duration * 60_000;
              }).length;
              return (
                <option key={slot} value={slot}>
                  {formatSlot(slot)}〜（{count}件）
                </option>
              );
            })}
          </select>
        </label>

        <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-3 font-bold text-[12px] text-blue-950">
          選択区間の実注文{" "}
          <span className="font-black font-mono text-[20px]">
            {selectedCount}
          </span>{" "}
          件を順番に投入します。物販は売上分析に含め、管制盤にはドリンクだけを表示します。
        </div>

        <button
          type="button"
          disabled={effectiveStart === null}
          onClick={() =>
            effectiveStart !== null && onStart(effectiveStart, duration)
          }
          className="mt-5 flex min-h-[54px] w-full items-center justify-center gap-2 rounded-xl bg-blue-700 font-black text-[17px] text-white shadow-sm disabled:bg-slate-300"
        >
          <Play className="h-5 w-5 fill-current" />
          テストプレイ開始
        </button>
      </section>
    </div>
  );
};
