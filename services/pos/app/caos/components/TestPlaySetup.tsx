import type { PracticeDataset } from "@cafeore/common";
import { CalendarClock, FileJson, Play, Trash2, X } from "lucide-react";
import type React from "react";
import { useMemo, useRef, useState } from "react";
import { ordersInPeriod, testPlaySlots } from "../logic/historical";

// 実データテストの始め方。データ（手元の JSON を読み込む）・プレイ時間・開始時間帯を選ぶ。
// 表示だけ。ファイルの読み込みと、名前・コメントを落とす変換は hooks/usePracticeData（@cafeore/common の readPracticeTexts）、
// 始められる時刻は logic/historical の testPlaySlots。

interface TestPlaySetupProps {
  /** 読み込んだ実データ。まだ無ければ null */
  dataset: PracticeDataset | null;
  /** ファイルを読んでいる間 */
  loading: boolean;
  /** 読めなかったファイル */
  problems: string[];
  onSelectFiles: (files: FileList | null) => void;
  onClearData: () => void;
  onClose: () => void;
  onStart: (startMs: number, durationMinutes: 30 | 60) => void;
}

// 開始の時刻（日本時間の「10/12(日) 11:00」）
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

export const TestPlaySetup: React.FC<TestPlaySetupProps> = ({
  dataset,
  loading,
  problems,
  onSelectFiles,
  onClearData,
  onClose,
  onStart,
}) => {
  const orders = dataset?.orders ?? [];
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
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
              実績でテストプレイ
            </h2>
            <p className="mt-1 font-medium text-[12px] text-slate-500">
              過去の祭の実際の注文を、選択した速度で再生します（1xは実時間と同じ）。本番の盤面・注文・在庫には混ざりません
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
            onSelectFiles(event.dataTransfer.files);
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
              onSelectFiles(event.currentTarget.files);
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
              {dataset.skipped > 0 && (
                <span className="text-slate-500">
                  ・読めなかった注文 {dataset.skipped}件
                </span>
              )}
            </div>
          ) : (
            <p className="font-bold text-[13px] text-amber-950">
              データがありません。sohosai-analysis の{" "}
              <code className="font-mono">YYYY/data/day*.json</code>
              （または cafeore-pos の注文の
              JSON）を選んでください。day1・day2・day12
              のように複数を選ぶと、重なる注文は 1 件にまとめます。
            </p>
          )}
          <p className="mt-1 font-medium text-[11px] text-slate-500">
            担当者名・指名・コメントは読み込むときに落とします。読み込んだデータはこの端末のブラウザの中だけで使い、サーバーには送りません（画面を開き直したら選び直しです）。
          </p>
          {problems.length > 0 && (
            <p role="alert" className="mt-2 font-bold text-[12px] text-red-700">
              読めなかったファイル：{problems.join("、")}
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={loading}
              onClick={() => fileInput.current?.click()}
              className="flex min-h-[44px] items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 font-black text-[14px] text-slate-800 disabled:text-slate-400"
            >
              <FileJson className="h-4 w-4" />
              {loading
                ? "読み込み中…"
                : dataset
                  ? "ファイルを選び直す"
                  : "JSON ファイルを選ぶ"}
            </button>
            {dataset && (
              <button
                type="button"
                disabled={loading}
                onClick={onClearData}
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
          disabled={effectiveStart === null || loading}
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
