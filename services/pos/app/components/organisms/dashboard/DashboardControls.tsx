import { jstDate } from "@cafeore/common";
import { useId } from "react";
import type { BucketMinutes } from "~/lib/analytics/operations";
import { TimeWheel } from "./TimeWheel";

const CONTROL =
  "min-h-10 rounded-md border border-stone-300 bg-white px-2 text-sm focus-visible:outline-2 focus-visible:outline-stone-700";
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5);
const pad = (n: number) => String(n).padStart(2, "0");

export function AggregationIntervalToggle({
  value,
  onChange,
}: {
  value: BucketMinutes;
  onChange: (value: BucketMinutes) => void;
}) {
  const options = [15, 30, 60] as const;
  const id = useId();
  return (
    <fieldset className="min-w-0 space-y-1">
      <legend className="font-bold text-xs">集計間隔</legend>
      <div className="relative isolate grid h-10 w-48 grid-cols-3 rounded-md border border-stone-200 bg-stone-100 p-1">
        <span
          aria-hidden="true"
          className="-z-10 pointer-events-none absolute inset-y-1 left-1 w-[calc((100%-0.5rem)/3)] rounded bg-teal-700 transition-transform duration-200 motion-reduce:transition-none"
          style={{
            transform: `translateX(${Math.max(0, options.indexOf(value as 15 | 30 | 60)) * 100}%)`,
          }}
        />
        {options.map((minutes) => (
          <label
            key={minutes}
            className={`relative flex cursor-pointer items-center justify-center rounded font-bold text-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-teal-700 has-[:focus-visible]:outline-offset-2 ${value === minutes ? "text-white" : "text-stone-600"}`}
          >
            <input
              className="sr-only"
              type="radio"
              name={id}
              value={minutes}
              checked={value === minutes}
              onChange={() => onChange(minutes)}
            />
            {minutes}分
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function TimePicker({
  label,
  value,
  end = false,
  onChange,
}: {
  label: string;
  value: string;
  end?: boolean;
  onChange: (value: string) => void;
}) {
  const [hour, minute] = value.split(":").map(Number);
  return (
    <fieldset className="space-y-1">
      <legend className="font-bold text-xs">{label}（JST）</legend>
      <div className="flex items-center gap-1">
        <TimeWheel
          label={`${label}・時`}
          values={end ? [...HOURS, 24] : HOURS}
          value={hour}
          onChange={(next) =>
            onChange(`${pad(next)}:${next === 24 ? "00" : pad(minute)}`)
          }
        />
        <span aria-hidden="true" className="font-bold text-stone-500">
          :
        </span>
        <TimeWheel
          label={`${label}・分`}
          values={hour === 24 ? [0] : MINUTES}
          value={minute}
          onChange={(next) => onChange(`${pad(hour)}:${pad(next)}`)}
        />
      </div>
    </fieldset>
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
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
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
        <TimePicker label="開始時刻" value={startTime} onChange={onStart} />
        <TimePicker label="終了時刻" value={endTime} end onChange={onEnd} />
        {showInterval && (
          <AggregationIntervalToggle value={interval} onChange={onInterval} />
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
