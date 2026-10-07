import { jstDate, startOfJstDay } from "@cafeore/common";
import { CalendarClock, FileJson, Play, Trash2, X } from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PracticeDataOrder } from "../practice/data";
import {
  type LoadedPracticeData,
  clearStoredPracticeData,
  loadStoredPracticeData,
  readPracticeFiles,
  storePracticeData,
} from "../practice/loaded";

// 実データテストの始め方。データ（手元の JSON を読み込む）・プレイ時間・開始時間帯を選ぶ。
// データは利用者が選んだファイルをこの端末のブラウザの中で読み、担当者名・指名・コメントを落としてから使う
// （サーバーにも配信にも出さない。practice/loaded.ts）。読み込んだデータはこの端末に覚えておき、「消す」で消せる。
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
  const [dataset, setDataset] = useState<LoadedPracticeData | null>(null);
  // この端末に覚えているデータを確かめている間・ファイルを読んでいる間
  const [datasetLoading, setDatasetLoading] = useState(true);
  const [problems, setProblems] = useState<string[]>([]);
  const [stored, setStored] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [duration, setDuration] = useState<30 | 60>(30);
  const [selectedStart, setSelectedStart] = useState<number | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    void loadStoredPracticeData()
      .then((loaded) => {
        if (cancelled) return;
        setDataset(loaded);
        setStored(Boolean(loaded));
      })
      .finally(() => {
        if (!cancelled) setDatasetLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const readFiles = async (list: FileList | null) => {
    const files = Array.from(list ?? []);
    if (files.length === 0) return;
    setDatasetLoading(true);
    try {
      const result = await readPracticeFiles(files);
      setProblems(result.problems);
      if (!result.data) return;
      setDataset(result.data);
      setSelectedStart(null);
      setStored(await storePracticeData(result.data));
    } catch {
      setProblems(["読み込めませんでした"]);
    } finally {
      setDatasetLoading(false);
    }
  };

  const clearData = async () => {
    await clearStoredPracticeData();
    setDataset(null);
    setStored(false);
    setProblems([]);
    setSelectedStart(null);
  };

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
  const loading = datasetLoading;
  const noData = !datasetLoading && !dataset;

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

        <div
          className={`mt-5 rounded-xl border-2 border-dashed p-3 ${dragging ? "border-blue-500 bg-blue-50" : "border-slate-300 bg-slate-50"}`}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            void readFiles(event.dataTransfer.files);
          }}
        >
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            multiple
            className="hidden"
            aria-label="実績の JSON ファイル"
            onChange={(event) => {
              void readFiles(event.currentTarget.files);
              event.currentTarget.value = "";
            }}
          />
          <div className="mb-2 font-black text-[13px] text-slate-700">
            データ
          </div>
          {dataset ? (
            <div className="font-bold text-[13px] text-slate-800">
              <span className="font-black text-[15px] text-slate-950">
                {dataset.label}
              </span>{" "}
              {dataset.orders.length.toLocaleString()}件
              {dataset.files.length > 0 && (
                <span className="text-slate-500">
                  （{dataset.files.join("・")}）
                </span>
              )}
              <div className="mt-1 font-medium text-[11px] text-slate-500">
                {stored
                  ? "この端末に覚えています。担当者名・指名・コメントは読み込むときに落としています"
                  : "この端末には覚えていません（閉じると読み込み直しです）。担当者名・指名・コメントは読み込むときに落としています"}
              </div>
            </div>
          ) : (
            !datasetLoading && (
              <p role="status" className="font-bold text-[13px] text-amber-950">
                データがありません。sohosai-analysis の{" "}
                <code className="font-mono">YYYY/data/day*.json</code>
                （または cafeore-pos の注文の
                JSON）を選んでください。day1・day2・day12
                のように複数を選ぶと、重なる注文は 1 件にまとめます。
              </p>
            )
          )}
          <p className="mt-1 font-medium text-[11px] text-slate-500">
            読み込んだデータはこの端末の中だけで使い、サーバーや配信には出しません。
          </p>
          {problems.length > 0 && (
            <p role="alert" className="mt-2 font-bold text-[12px] text-red-700">
              読めなかったファイル：{problems.join("、")}
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={datasetLoading}
              onClick={() => fileInput.current?.click()}
              className="flex min-h-[44px] items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 font-black text-[14px] text-slate-800 disabled:text-slate-400"
            >
              <FileJson className="h-4 w-4" />
              {dataset ? "ファイルを選び直す" : "JSON ファイルを選ぶ"}
            </button>
            {dataset && (
              <button
                type="button"
                disabled={datasetLoading}
                onClick={() => void clearData()}
                className="flex min-h-[44px] items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 font-black text-[14px] text-red-700 disabled:text-slate-400"
              >
                <Trash2 className="h-4 w-4" />
                読み込んだデータを消す
              </button>
            )}
          </div>
          <p className="mt-2 font-medium text-[11px] text-slate-500">
            ここにファイルをドラッグしても読み込めます。選び直すと入れ替わります。
          </p>
        </div>

        {!noData && (
          <>
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
