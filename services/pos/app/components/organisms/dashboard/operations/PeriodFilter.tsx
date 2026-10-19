import { jstDate } from "@cafeore/common";
import { useState } from "react";
import { dayWindow } from "~/lib/analytics/operations";
import { TimeWheel } from "../TimeWheel";

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
  "min-h-10 whitespace-nowrap rounded-md border border-stone-300 bg-white px-3 py-2 font-bold text-xs hover:bg-teal-50 focus-visible:outline-2 focus-visible:outline-teal-700";

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
  const [duration, setDuration] = useState<number | null>(null);
  const [previousPeriod, setPreviousPeriod] = useState<Period | null>(null);
  const restorePeriod = () => {
    if (previousPeriod) onChange(previousPeriod);
    setDuration(null);
    setPreviousPeriod(null);
  };
  const timestamp = (date: string, time: string) =>
    dayWindow(date, now).start +
    (Number(time.slice(0, 2)) * 60 + Number(time.slice(3))) * 60000;
  const clock = (at: number) => {
    const minute = Math.round((at - dayWindow(jstDate(at), now).start) / 60000);
    return `${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`;
  };
  const setRange = (start: number, end: number) => {
    const midnight = end === dayWindow(jstDate(end), now).start;
    onChange({
      date: jstDate(start),
      throughDate: jstDate(midnight ? end - 1 : end),
      startTime: clock(start),
      endTime: midnight ? "24:00" : clock(end),
    });
  };
  const editStart = (date: string, time: string) => {
    if (duration !== null) {
      const start = timestamp(date, time);
      setRange(start, start + duration * 60000);
    } else
      onChange({
        ...period,
        date,
        startTime: time,
        throughDate: period.date === throughDate ? date : throughDate,
      });
  };
  const editEnd = (date: string, time: string) => {
    if (duration !== null) {
      const end = timestamp(date, time);
      setRange(end - duration * 60000, end);
    } else onChange({ ...period, throughDate: date, endTime: time });
  };
  return (
    <fieldset className="space-y-4 border-stone-200 border-t pt-4">
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
          onClick={() => {
            setDuration(null);
            setPreviousPeriod(null);
            onChange({
              date: jstDate(now),
              throughDate: jstDate(now),
              startTime: "00:00",
              endTime: "24:00",
            });
          }}
        >
          今日・終日
        </button>
        {[15, 30, 60].map((minutes) => (
          <button
            type="button"
            key={minutes}
            aria-pressed={duration === minutes}
            className={`${SHORTCUT} ${duration === minutes ? "border-teal-700 bg-teal-50 text-teal-900" : ""}`}
            onClick={() => {
              if (duration === minutes) {
                restorePeriod();
                return;
              }
              if (duration === null) setPreviousPeriod({ ...period });
              setDuration(minutes);
              const start = timestamp(date, startTime);
              setRange(start, start + minutes * 60000);
            }}
          >
            {minutes}分間
          </button>
        ))}
        {previousPeriod && (
          <button type="button" className={SHORTCUT} onClick={restorePeriod}>
            元の期間へ戻す
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <TimeEndpoint
          label="開始"
          date={date}
          time={startTime}
          onDate={(value) => editStart(value, startTime)}
          onTime={(value) => editStart(date, value)}
        />
        <span className="font-bold text-stone-400">〜</span>
        <TimeEndpoint
          label="終了"
          date={throughDate}
          time={endTime}
          end
          onDate={(value) => editEnd(value, endTime)}
          onTime={(value) => editEnd(throughDate, value)}
        />
      </div>
      <div>
        <p className="mb-2 font-bold text-xs">1時間で見る</p>
        <div
          className="grid grid-cols-[repeat(auto-fit,minmax(76px,1fr))] gap-1"
          aria-label="時間帯のショートカット"
        >
          {HOURS.filter((hour) => hour >= 10 && hour <= 20).map((hour) => {
            const selected =
              date === throughDate &&
              startTime === `${pad(hour)}:00` &&
              endTime === `${pad(hour + 1)}:00`;
            return (
              <button
                type="button"
                key={hour}
                aria-pressed={selected}
                onClick={() => {
                  if (duration === null) setPreviousPeriod({ ...period });
                  setDuration(60);
                  onChange({
                    date,
                    throughDate: date,
                    startTime: `${pad(hour)}:00`,
                    endTime: `${pad(hour + 1)}:00`,
                  });
                }}
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
        {duration !== null
          ? `${duration}分間で連動中。開始を変えると終了、終了を変えると開始も動きます。同じボタンを再度押すか「元の期間へ戻す」で、連動前の期間に戻ります。`
          : "15・30・60分間のボタンで、開始からその長さに絞ります。解除すると元の期間に戻せます。"}
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
    <div className="min-w-0">
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
