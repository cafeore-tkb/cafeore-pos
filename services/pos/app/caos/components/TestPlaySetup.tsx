import { jstDate, startOfJstDay } from "@cafeore/common";
import { CalendarClock, Play, X } from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import {
  type PracticeDataOrder,
  type PracticeDataset,
  type PracticeDatasetEntry,
  loadPracticeDataset,
  loadPracticeIndex,
} from "../practice/data";

// 実データテストの始め方。データ（年ごと）・プレイ時間・開始時間帯を選ぶ。
// 時間帯は日本時間の 0 分・30 分の区切り（端末の時刻帯によらない。盤面の時計と同じ）。

const SLOT_MS = 30 * 60_000;

interface TestPlaySetupProps {
  starting: boolean;
  onClose: () => void;
  onStart: (start: {
    label: string;
    orders: PracticeDataOrder[];
    startMs: number;
    endMs: number;
  }) => void;
}

const formatSlot = (timestamp: number) =>
  new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(timestamp));

const createdMs = (order: PracticeDataOrder) =>
  new Date(order.createdAt).getTime();

const countIn = (orders: PracticeDataOrder[], startMs: number, endMs: number) =>
  orders.filter(
    (order) => createdMs(order) >= startMs && createdMs(order) < endMs,
  ).length;

export const TestPlaySetup: React.FC<TestPlaySetupProps> = ({
  starting,
  onClose,
  onStart,
}) => {
  const [entries, setEntries] = useState<PracticeDatasetEntry[] | null>(null);
  const [entryId, setEntryId] = useState<string | null>(null);
  const [dataset, setDataset] = useState<PracticeDataset | null>(null);
  const [datasetLoading, setDatasetLoading] = useState(false);
  const [duration, setDuration] = useState<30 | 60>(30);
  const [selectedStart, setSelectedStart] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadPracticeIndex().then((list) => {
      if (!cancelled) setEntries(list);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const entry =
    entries?.find((item) => item.id === entryId) ?? entries?.[0] ?? null;

  useEffect(() => {
    if (!entry) return;
    let cancelled = false;
    setDatasetLoading(true);
    setDataset(null);
    void loadPracticeDataset(entry)
      .then((loaded) => {
        if (!cancelled) setDataset(loaded);
      })
      .finally(() => {
        if (!cancelled) setDatasetLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [entry]);

  const orders = dataset?.orders ?? [];
  const slots = useMemo(() => {
    if (orders.length === 0) return [];
    // 日本時間の日ごとに、最初の注文の 30 分の区切りから最後の注文まで
    const days = new Map<string, number[]>();
    for (const order of orders) {
      const ms = createdMs(order);
      const values = days.get(jstDate(ms)) || [];
      values.push(ms);
      days.set(jstDate(ms), values);
    }
    return Array.from(days.values())
      .sort((a, b) => Math.min(...a) - Math.min(...b))
      .flatMap((timestamps) => {
        const first = Math.min(...timestamps);
        const dayStart = startOfJstDay(first);
        const firstSlot =
          dayStart + Math.floor((first - dayStart) / SLOT_MS) * SLOT_MS;
        const last = Math.max(...timestamps);
        const result: number[] = [];
        for (
          let cursor = firstSlot;
          cursor + duration * 60_000 <= last + SLOT_MS;
          cursor += SLOT_MS
        ) {
          if (countIn(orders, cursor, cursor + duration * 60_000) > 0)
            result.push(cursor);
        }
        return result;
      });
  }, [orders, duration]);
  const effectiveStart =
    selectedStart && slots.includes(selectedStart)
      ? selectedStart
      : slots[0] || null;
  const selectedCount =
    effectiveStart === null
      ? 0
      : countIn(orders, effectiveStart, effectiveStart + duration * 60_000);
  const loading = entries === null || datasetLoading;
  const noData =
    entries !== null && (entries.length === 0 || (!datasetLoading && !dataset));

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
              実績でテストプレイ
            </h2>
            <p className="mt-1 font-medium text-[12px] text-slate-500">
              過去の祭の実際の注文を、選んだ速度で流します（1xは実時間と同じ）。盤面のルールは本番と同じで、本番の盤面には出ません
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

        {noData ? (
          <div
            role="status"
            className="mt-5 rounded-xl border border-amber-300 bg-amber-50 p-3 font-bold text-[13px] text-amber-950"
          >
            データがありません。実績のデータは配信のときに入れます（このビルドには入っていません）。
          </div>
        ) : (
          <>
            {entries && entries.length > 1 && (
              <div className="mt-5">
                <div className="mb-2 font-black text-[13px] text-slate-700">
                  データ
                </div>
                <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1">
                  {entries.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setEntryId(item.id);
                        setSelectedStart(null);
                      }}
                      className={`min-h-[48px] rounded-lg font-black text-[15px] ${entry?.id === item.id ? "bg-slate-950 text-white shadow-sm" : "bg-white text-slate-600"}`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

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
                disabled={loading || slots.length === 0}
                onChange={(event) =>
                  setSelectedStart(Number(event.target.value))
                }
                className="min-h-[52px] w-full rounded-xl border border-slate-300 bg-white px-3 font-black text-[16px] text-slate-900"
              >
                {loading && <option>データを読み込み中…</option>}
                {!loading && slots.length === 0 && (
                  <option>利用できる時間帯がありません</option>
                )}
                {slots.map((slot) => (
                  <option key={slot} value={slot}>
                    {formatSlot(slot)}〜（
                    {countIn(orders, slot, slot + duration * 60_000)}件）
                  </option>
                ))}
              </select>
            </label>

            <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-3 font-bold text-[12px] text-blue-950">
              選択区間の実注文{" "}
              <span className="font-black font-mono text-[20px]">
                {selectedCount}
              </span>{" "}
              件を順番に投入します。物販は売上分析に含め、管制盤にはドリンクだけを表示します。
            </div>
          </>
        )}

        <button
          type="button"
          disabled={effectiveStart === null || loading || noData || starting}
          onClick={() =>
            effectiveStart !== null &&
            dataset &&
            onStart({
              label: dataset.label,
              orders,
              startMs: effectiveStart,
              endMs: effectiveStart + duration * 60_000,
            })
          }
          className="mt-5 flex min-h-[54px] w-full items-center justify-center gap-2 rounded-xl bg-blue-700 font-black text-[17px] text-white shadow-sm disabled:bg-slate-300"
        >
          <Play className="h-5 w-5 fill-current" />
          {starting ? "練習の盤面を用意中…" : "テストプレイ開始"}
        </button>
      </section>
    </div>
  );
};
