import { jstDate } from "@cafeore/common";
import { useEffect, useRef } from "react";
import { dayWindow } from "~/lib/analytics/operations";

type Period = {
  date: string;
  throughDate: string;
  startTime: string;
  endTime: string;
};
const pad = (n: number) => String(n).padStart(2, "0");
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5);
const SHORTCUT =
  "min-h-10 whitespace-nowrap rounded-lg border border-stone-300 bg-white px-3 py-2 font-bold text-xs hover:bg-teal-50 focus-visible:outline-2 focus-visible:outline-teal-700";

/** 日付は日本時間で計算し、24:00をその日の終端として扱う。 */
export function PeriodFilter({
  period,
  now,
  onChange,
}: { period: Period; now: number; onChange: (period: Period) => void }) {
  const { date, throughDate, startTime, endTime } = period;
  const shiftDay = (direction: number) =>
    onChange({
      ...period,
      date: jstDate(dayWindow(date, now).start + direction * 86400000),
      throughDate: jstDate(
        dayWindow(throughDate, now).start + direction * 86400000,
      ),
    });
  const preceding = (minutes: number) => {
    const end =
      date === jstDate(now)
        ? Math.floor(now / 300000) * 300000
        : dayWindow(throughDate, now).start +
          (Number(endTime.slice(0, 2)) * 60 + Number(endTime.slice(3))) * 60000;
    const start = end - minutes * 60000;
    const clock = (at: number) => {
      const minute = Math.round(
        (at - dayWindow(jstDate(at), now).start) / 60000,
      );
      return `${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`;
    };
    onChange({
      date: jstDate(start),
      throughDate: jstDate(end),
      startTime: clock(start),
      endTime: clock(end),
    });
  };
  return (
    <fieldset className="space-y-4 rounded-2xl border border-stone-200 bg-white p-3">
      <legend className="px-1 font-bold text-sm">集計期間（日本時間）</legend>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={SHORTCUT} onClick={() => shiftDay(-1)}>
          ← 1日前
        </button>
        <button type="button" className={SHORTCUT} onClick={() => shiftDay(1)}>
          1日後 →
        </button>
        <button
          type="button"
          className={SHORTCUT}
          onClick={() =>
            onChange({
              date: jstDate(now),
              throughDate: jstDate(now),
              startTime: "00:00",
              endTime: "24:00",
            })
          }
        >
          今日・終日
        </button>
        {[15, 30, 60].map((minutes) => (
          <button
            type="button"
            key={minutes}
            className={SHORTCUT}
            onClick={() => preceding(minutes)}
          >
            前{minutes}分
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <TimeEndpoint
          label="開始"
          date={date}
          time={startTime}
          onDate={(value) =>
            onChange({
              ...period,
              date: value,
              throughDate: date === throughDate ? value : throughDate,
            })
          }
          onTime={(value) => onChange({ ...period, startTime: value })}
        />
        <span className="font-bold text-stone-400">〜</span>
        <TimeEndpoint
          label="終了"
          date={throughDate}
          time={endTime}
          end
          onDate={(value) => onChange({ ...period, throughDate: value })}
          onTime={(value) => onChange({ ...period, endTime: value })}
        />
      </div>
      <div>
        <p className="mb-2 font-bold text-xs">1時間で見る</p>
        <div
          className="grid grid-cols-[repeat(auto-fit,minmax(76px,1fr))] gap-1"
          aria-label="時間帯のショートカット"
        >
          {HOURS.map((hour) => {
            const selected =
              date === throughDate &&
              startTime === `${pad(hour)}:00` &&
              endTime === `${pad(hour + 1)}:00`;
            return (
              <button
                type="button"
                key={hour}
                aria-pressed={selected}
                onClick={() =>
                  onChange({
                    date,
                    throughDate: date,
                    startTime: `${pad(hour)}:00`,
                    endTime: `${pad(hour + 1)}:00`,
                  })
                }
                className={`${SHORTCUT} shrink-0 ${selected ? "border-teal-700 bg-teal-50 text-teal-900" : ""}`}
              >
                {hour}時台
              </button>
            );
          })}
        </div>
      </div>
      <p className="text-stone-500 text-xs">
        時・分を上下にスクロール。分は5分刻み。24:00は翌日0時。
        <br />
        前○分：今日は直前の5分区切りまで、過去日は選んだ終了時刻まで。まだ来ていない時間は集計しません。
      </p>
    </fieldset>
  );
}

function TimeEndpoint({
  label,
  date,
  time,
  end = false,
  onDate,
  onTime,
}: {
  label: string;
  date: string;
  time: string;
  end?: boolean;
  onDate: (value: string) => void;
  onTime: (value: string) => void;
}) {
  const hour = Number(time.slice(0, 2));
  const minute = Number(time.slice(3));
  return (
    <div className="min-w-0 rounded-xl bg-stone-50 p-2">
      <label className="flex flex-wrap items-center gap-2 font-bold text-xs">
        {label}日
        <input
          aria-label={`${label}日`}
          type="date"
          value={date}
          onChange={(event) => {
            if (event.target.value) onDate(event.target.value);
          }}
          className="min-h-10 min-w-0 rounded border bg-white px-2 text-sm"
        />
      </label>
      <div className="mt-2 flex items-center justify-center gap-2">
        <TimeWheel
          label={`${label}・時`}
          values={end ? [...HOURS, 24] : HOURS}
          value={hour}
          onChange={(value) =>
            onTime(`${pad(value)}:${value === 24 ? "00" : pad(minute)}`)
          }
        />
        <span className="font-bold text-xl">:</span>
        <TimeWheel
          label={`${label}・分`}
          values={hour === 24 ? [0] : MINUTES}
          value={minute}
          onChange={(value) => onTime(`${pad(hour)}:${pad(value)}`)}
        />
      </div>
    </div>
  );
}

/** 指で慣性スクロールできる独立した時・分のホイール。キーボードとタップにも対応。 */
function TimeWheel({
  label,
  values,
  value,
  onChange,
}: {
  label: string;
  values: number[];
  value: number;
  onChange: (value: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const programmatic = useRef(false);
  const initialized = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const current = useRef({ values, onChange });
  current.current = { values, onChange };
  const index = Math.max(0, values.indexOf(value));
  useEffect(() => {
    clearTimeout(timer.current);
    programmatic.current = true;
    ref.current?.scrollTo({
      top: Math.min(index, values.length - 1) * 40,
      behavior:
        initialized.current &&
        !window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "smooth"
          : "instant",
    });
    initialized.current = true;
    const reset = setTimeout(() => {
      programmatic.current = false;
    }, 800);
    return () => clearTimeout(reset);
  }, [index, values.length]);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <div className="relative w-16 overflow-hidden rounded-lg border border-stone-200 bg-white focus-within:ring-2 focus-within:ring-teal-700">
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="sr-only"
      >
        {values.map((option) => (
          <option key={option} value={option}>
            {pad(option)}
          </option>
        ))}
      </select>
      <div className="pointer-events-none absolute inset-x-0 top-10 h-10 border-teal-200 border-y bg-teal-50/60" />
      <div
        ref={ref}
        aria-hidden="true"
        className="relative h-30 snap-y snap-mandatory overflow-y-auto py-10 text-center [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        onPointerDown={() => {
          programmatic.current = false;
        }}
        onWheel={() => {
          programmatic.current = false;
        }}
        onScroll={(event) => {
          if (programmatic.current) return;
          const selected = Math.max(
            0,
            Math.min(
              current.current.values.length - 1,
              Math.round(event.currentTarget.scrollTop / 40),
            ),
          );
          clearTimeout(timer.current);
          timer.current = setTimeout(
            () => current.current.onChange(current.current.values[selected]),
            140,
          );
        }}
      >
        {values.map((option) => (
          <button
            type="button"
            tabIndex={-1}
            key={option}
            className={`flex h-10 w-full snap-center items-center justify-center font-bold text-xl tabular-nums ${option === value ? "text-teal-950" : "text-stone-400"}`}
            onClick={() => onChange(option)}
          >
            {pad(option)}
          </button>
        ))}
      </div>
      <span className="pointer-events-none absolute right-1 bottom-0 text-[10px] text-stone-400">
        {label.endsWith("時") ? "時" : "分"}
      </span>
    </div>
  );
}
