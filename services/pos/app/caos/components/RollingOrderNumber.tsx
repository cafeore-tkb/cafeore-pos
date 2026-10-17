import { useLayoutEffect, useRef } from "react";
import { orderNoLabel } from "../logic/cards";

/** 数値計算ではなく各桁だけを短くスライドさせ、桁上がりでも何周も回さない。 */
const RollingDigit = ({ digit }: { digit: string }) => {
  const track = useRef<HTMLSpanElement>(null);
  const oldCell = useRef<HTMLSpanElement>(null);
  const previous = useRef(digit);
  useLayoutEffect(() => {
    if (!track.current || !oldCell.current || previous.current === digit)
      return;
    oldCell.current.textContent = previous.current;
    previous.current = digit;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const animation = track.current.animate(
      [{ transform: "translateY(0)" }, { transform: "translateY(-50%)" }],
      { duration: 280, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
    );
    return () => animation.cancel();
  }, [digit]);
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

/** フォントはタブラベルから継承。空の対象は固定幅のダッシュで示す。 */
export const RollingOrderNumber = ({ value }: { value: number | null }) => {
  const text = value === null ? "—" : orderNoLabel(value);
  const digits = text
    .split("")
    .map((digit, index) => ({ digit, place: 10 ** (text.length - index - 1) }));
  return (
    <span
      className="caos-order-number"
      aria-label={value === null ? "対象の注文なし" : `最小注文番号 ${text}`}
    >
      <span aria-hidden="true" className="opacity-60">
        #
      </span>
      <span aria-hidden="true" className="caos-order-digits">
        {value === null ? (
          <span className="caos-order-empty">—</span>
        ) : (
          digits.map(({ digit, place }) => (
            <RollingDigit key={place} digit={digit} />
          ))
        )}
      </span>
    </span>
  );
};
