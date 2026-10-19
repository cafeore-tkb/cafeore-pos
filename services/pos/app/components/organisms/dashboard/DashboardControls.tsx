import { jstDate } from "@cafeore/common";
import { useId } from "react";
import type { BucketMinutes } from "~/lib/analytics/operations";

const CONTROL =
  "min-h-10 rounded-md border border-stone-300 bg-white px-2 text-sm focus-visible:outline-2 focus-visible:outline-stone-700";
const TIMES = Array.from(
  { length: 289 },
  (_, i) =>
    `${String(Math.floor(i / 12)).padStart(2, "0")}:${String((i % 12) * 5).padStart(2, "0")}`,
);

export function AggregationIntervalSelect({
  value,
  onChange,
  options = [15, 30, 60],
  disabled = false,
}: {
  value: BucketMinutes;
  onChange: (value: BucketMinutes) => void;
  options?: readonly BucketMinutes[];
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block font-bold text-xs">
        集計間隔
      </label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value) as BucketMinutes)}
        className={`${CONTROL} w-24 disabled:opacity-60`}
      >
        {options.map((minutes) => (
          <option key={minutes} value={minutes}>
            {minutes}分
          </option>
        ))}
      </select>
    </div>
  );
}

export function DashboardControls({
  date,
  startTime,
  endTime,
  now,
  interval,
  showInterval,
  onDate,
  onStart,
  onEnd,
  onInterval,
}: {
  date: string;
  startTime: string;
  endTime: string;
  now: number;
  interval: BucketMinutes;
  showInterval: boolean;
  onDate: (date: string) => void;
  onStart: (time: string) => void;
  onEnd: (time: string) => void;
  onInterval: (interval: BucketMinutes) => void;
}) {
  const id = useId();
  return (
    <section
      id="dashboard-filters"
      aria-label="表示条件"
      className="mt-5 rounded-md border border-stone-200 bg-stone-50 p-4"
    >
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
        <div className="space-y-1">
          <label htmlFor={`${id}-date`} className="block font-bold text-xs">
            表示する日（JST）
          </label>
          <input
            id={`${id}-date`}
            type="date"
            max={jstDate(now)}
            value={date}
            onChange={(e) => {
              if (e.target.value) onDate(e.target.value);
            }}
            className={CONTROL}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor={`${id}-start`} className="block font-bold text-xs">
            開始時刻（JST）
          </label>
          <select
            id={`${id}-start`}
            value={startTime}
            onChange={(e) => onStart(e.target.value)}
            className={`${CONTROL} w-24`}
          >
            {TIMES.slice(0, -1).map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor={`${id}-end`} className="block font-bold text-xs">
            終了時刻（JST）
          </label>
          <select
            id={`${id}-end`}
            value={endTime}
            onChange={(e) => onEnd(e.target.value)}
            className={`${CONTROL} w-24`}
          >
            {TIMES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </div>
        {showInterval && (
          <AggregationIntervalSelect value={interval} onChange={onInterval} />
        )}
        <button
          type="button"
          onClick={() => {
            onStart("00:00");
            onEnd("24:00");
          }}
          className="min-h-10 px-1 text-sm underline underline-offset-4"
        >
          選択日の終日
        </button>
      </div>
      <p className="mt-2 text-stone-500 text-xs">
        終了時刻ちょうどは含みません。24:00は翌日0時。今日の未来分は集計しません。
      </p>
    </section>
  );
}
