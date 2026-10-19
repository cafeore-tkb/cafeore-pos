import { useEffect, useRef } from "react";

const pad = (n: number) => String(n).padStart(2, "0");

/** 指で慣性スクロールできる独立した時・分のホイール。キーボードとタップにも対応。 */
export function TimeWheel({
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
  const selectedIndex = useRef(index);
  selectedIndex.current = index;
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let visible = false;
    let reset: ReturnType<typeof setTimeout>;
    const observer = new ResizeObserver(() => {
      const nextVisible = element.clientHeight > 0;
      if (nextVisible && !visible) {
        programmatic.current = true;
        element.scrollTo({
          top: selectedIndex.current * 24,
          behavior: "instant",
        });
        clearTimeout(reset);
        reset = setTimeout(() => {
          programmatic.current = false;
        }, 250);
      }
      visible = nextVisible;
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      clearTimeout(reset);
    };
  }, []);
  useEffect(() => {
    clearTimeout(timer.current);
    programmatic.current = true;
    ref.current?.scrollTo({
      top: Math.min(index, values.length - 1) * 24,
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
    <div className="relative w-14 overflow-hidden rounded-lg border border-stone-200 bg-white focus-within:ring-2 focus-within:ring-teal-700">
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        onKeyDown={(event) => {
          const next =
            event.key === "ArrowDown"
              ? Math.min(index + 1, values.length - 1)
              : event.key === "ArrowUp"
                ? Math.max(0, index - 1)
                : event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? values.length - 1
                    : null;
          if (next === null) return;
          event.preventDefault();
          onChange(values[next]);
        }}
        className="sr-only"
      >
        {values.map((option) => (
          <option key={option} value={option}>
            {pad(option)}
          </option>
        ))}
      </select>
      <div className="pointer-events-none absolute inset-x-0 top-6 h-6 border-teal-200 border-y bg-teal-50/60" />
      <div
        ref={ref}
        aria-hidden="true"
        className="relative h-18 snap-y snap-mandatory overflow-y-auto py-6 text-center [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
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
              Math.round(event.currentTarget.scrollTop / 24),
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
            className={`flex h-6 w-full snap-center items-center justify-center font-bold text-sm tabular-nums ${option === value ? "text-teal-950" : "text-stone-400"}`}
            onClick={() => onChange(option)}
          >
            {pad(option)}
          </button>
        ))}
      </div>
      <span className="pointer-events-none absolute right-1 bottom-0 text-[9px] text-stone-400">
        {label.endsWith("時") ? "時" : "分"}
      </span>
    </div>
  );
}
