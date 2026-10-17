import { useLayoutEffect, useRef } from "react";

/** 数値計算ではなく各桁だけを短くスライドさせ、桁上がりでも何周も回さない。 */
const RollingDigit = ({
  digit,
  duration,
}: { digit: string; duration: number }) => {
  const track = useRef<HTMLSpanElement>(null);
  const oldCell = useRef<HTMLSpanElement>(null);
  const previous = useRef(digit);
  useLayoutEffect(() => {
    if (!track.current || !oldCell.current || previous.current === digit)
      return;
    oldCell.current.textContent = previous.current;
    previous.current = digit;
    if (
      duration <= 0 ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    const animation = track.current.animate(
      [{ transform: "translateY(0)" }, { transform: "translateY(-50%)" }],
      { duration, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
    );
    return () => animation.cancel();
  }, [digit, duration]);
  return (
    <span className="caos-order-digit">
      <span ref={track} className="caos-order-digit-track">
        <span ref={oldCell} className="caos-order-digit-cell">
          {digit}
        </span>
        <span className="caos-order-digit-cell">{digit}</span>
      </span>
    </span>
  );
};

/** タブ内のすべての数値で同じフォント・桁送りを共有する。 */
export const RollingNumber = ({
  value,
  minDigits = 1,
  duration = 280,
  label,
  className = "",
}: {
  value: number | null;
  minDigits?: number;
  duration?: number;
  label?: string;
  className?: string;
}) => {
  const text =
    value === null
      ? "—"
      : Math.max(0, Math.floor(value)).toString().padStart(minDigits, "0");
  const digits = text
    .split("")
    .map((digit, index) => ({ digit, place: 10 ** (text.length - index - 1) }));
  return (
    <span
      className={`caos-order-digits ${className}`}
      aria-label={label ?? text}
    >
      <span aria-hidden="true" className="caos-order-digits">
        {value === null ? (
          <span
            style={{ width: `${minDigits * 0.65}em` }}
            className="text-center"
          >
            —
          </span>
        ) : (
          digits.map(({ digit, place }) => (
            <RollingDigit key={place} digit={digit} duration={duration} />
          ))
        )}
      </span>
    </span>
  );
};

export const RollingOrderNumber = ({
  value,
  className = "",
}: { value: number | null; className?: string }) => (
  <span className={`caos-order-number ${className}`}>
    <span aria-hidden="true" className="opacity-60">
      #
    </span>
    <RollingNumber
      value={value}
      minDigits={3}
      label={
        value === null
          ? "対象の注文なし"
          : `最小注文番号 ${value.toString().padStart(3, "0")}`
      }
    />
  </span>
);

/** 時計による1秒増加は即時更新。対象変更などによる増減だけ桁送りする。 */
export const RollingClock = ({ seconds }: { seconds: number }) => {
  const safe = Math.max(0, Math.round(seconds));
  const previousSeconds = useRef(safe);
  const clockTick = safe === previousSeconds.current + 1;
  useLayoutEffect(() => {
    previousSeconds.current = safe;
  }, [safe]);
  return (
    <span className="caos-order-number">
      <RollingNumber
        value={Math.floor(safe / 60)}
        duration={clockTick ? 0 : 280}
        label={`${Math.floor(safe / 60)}分`}
      />
      <span aria-hidden="true">:</span>
      <RollingNumber
        value={safe % 60}
        minDigits={2}
        duration={clockTick ? 0 : 520}
        label={`${safe % 60}秒`}
      />
    </span>
  );
};
