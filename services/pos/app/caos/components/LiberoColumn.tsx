import type { CaosCard } from "@cafeore/common";
import type { CSSProperties } from "react";
import { cardOrderNos, orderNoLabel } from "../logic/cards";
import { clockLabel } from "../logic/format";
import type { LiberoLane } from "../logic/libero";
import {
  brewIntensity,
  justStarted,
  liberoColor,
  liberoCupCounts,
} from "../logic/libero-colors";
import { LaneName } from "./LaneParts";

/** リベロの固定グリッド。背景の右から左への進み具合とバーは同じprogressを使う。 */
export function LiberoColumn({
  row: { lane, brew },
  flashing,
  nextIntensity = 0.25,
}: { row: LiberoLane; flashing: boolean; nextIntensity?: number }) {
  const next = lane.queued[0];
  const progress = brew?.progress ?? 0;
  const fresh = justStarted(brew?.elapsedSec);
  const currentColor = brew
    ? liberoColor(brew.card, brewIntensity(progress))
    : undefined;
  const nextColor = next ? liberoColor(next, nextIntensity) : undefined;
  // 色面の境界が文字を横切っても読めるよう、文字の周囲だけ白くする。
  const currentText: CSSProperties = {
    color: fresh ? "#b91c1c" : "#0f172a",
    backgroundColor: "#ffffff",
  };
  const nextText = fresh ? currentText : nextColor?.textStyle;
  const remaining = brew ? Math.max(0, brew.plannedSec - brew.elapsedSec) : 0;
  return (
    <section
      data-libero-dripper={lane.id}
      aria-label={`ドリッパー${lane.id}`}
      className={`grid min-h-0 min-w-0 grid-rows-[minmax(104px,14vh)_minmax(0,3fr)_minmax(0,2fr)] overflow-hidden rounded-xl border border-slate-300 bg-white ${flashing ? "caos-arrival" : ""}`}
    >
      <header className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] justify-items-center gap-1 border-slate-200 border-b bg-white px-1 py-2 text-center">
        <span className="font-black text-[clamp(24px,3vw,56px)] leading-none">
          {lane.id}
        </span>
        <LaneName
          dripper={lane.id}
          wrap
          className={`justify-center self-center font-black text-[clamp(16px,1.8vw,34px)] leading-tight ${fresh ? "text-red-700" : ""}`}
        />
      </header>
      <div
        className={`relative isolate min-h-0 overflow-y-auto px-1.5 py-3 text-center ${brew ? "bg-white" : "bg-slate-100"}`}
      >
        {currentColor && (
          <LiberoBackground palette={currentColor} progress={progress} />
        )}
        <div
          style={{ color: currentText.color }}
          className="relative z-[1] grid h-full min-h-0 w-full min-w-0 grid-rows-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.4fr)] items-center px-1 py-2"
        >
          {brew ? (
            <>
              <CupDetail
                card={brew.card}
                textStyle={currentText}
                highlight={fresh}
              />
              <div className="grid w-full grid-rows-[20px_minmax(48px,5vw)_8px] items-center justify-items-center gap-1 border-current/20 border-t pt-2">
                <p
                  style={remaining > 0 ? currentText : undefined}
                  aria-hidden={remaining === 0}
                  className="w-fit rounded px-1 font-bold text-[clamp(12px,1.1vw,20px)]"
                >
                  {remaining > 0 ? "あと" : "\u00a0"}
                </p>
                <p
                  style={currentText}
                  className={`w-fit max-w-full rounded-md px-1 font-black tabular-nums leading-tight ${remaining > 0 ? "text-[clamp(22px,3.2vw,62px)]" : "whitespace-nowrap text-[clamp(18px,2vw,38px)]"}`}
                >
                  {remaining > 0 ? clockLabel(remaining) : "あとちょっと"}
                </p>
                <progress
                  className="sr-only"
                  aria-label="抽出の進み具合"
                  value={progress}
                  max={1}
                />
                <div
                  aria-hidden="true"
                  className="relative h-2 w-[85%] overflow-hidden rounded-full bg-slate-300"
                >
                  <div
                    className="absolute inset-y-0 right-0 rounded-full bg-current/70 transition-[width] duration-1000 ease-linear motion-reduce:transition-none"
                    style={{ width: `${progress * 100}%` }}
                  />
                </div>
              </div>
            </>
          ) : (
            <p className="row-span-3 font-bold text-[clamp(18px,2vw,38px)] text-slate-500">
              {next ? "開始待ち" : "空き"}
            </p>
          )}
        </div>
      </div>
      <div className="relative isolate min-h-0 overflow-y-auto border-slate-300 border-t-2 bg-white px-1.5 py-3 text-center">
        {nextColor && <LiberoBackground palette={nextColor} />}
        <div
          style={{ color: nextText?.color }}
          className="relative z-[1] grid h-full min-h-0 w-full min-w-0 grid-rows-[minmax(0,0.6fr)_minmax(0,1fr)_minmax(0,1fr)] items-center px-1 py-2"
        >
          <p
            style={nextText}
            className="w-fit justify-self-center rounded px-1 font-bold text-[clamp(12px,1.2vw,22px)]"
          >
            NEXT
          </p>
          {next ? (
            <CupDetail
              card={next}
              small
              textStyle={nextText}
              highlight={fresh}
            />
          ) : (
            <p className="row-span-2 font-bold text-[clamp(16px,1.5vw,28px)] text-slate-400">
              予定なし
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

/** 色面は右寄せで増やす。混在の杯数比は色面の中で維持し、各色も1秒で補間する。 */
function LiberoBackground({
  palette,
  progress = 1,
}: { palette: ReturnType<typeof liberoColor>; progress?: number }) {
  return (
    <div
      aria-hidden="true"
      className="-z-[1] pointer-events-none absolute inset-0 flex justify-end"
    >
      <div
        className="flex h-full overflow-hidden transition-[width] duration-1000 ease-linear motion-reduce:transition-none"
        style={{ width: `${progress * 100}%` }}
      >
        {palette.parts.map((part) => (
          <div
            key={part.kind}
            className="h-full shrink-0 transition-colors duration-1000 ease-linear motion-reduce:transition-none"
            style={{
              flexBasis: `${part.fraction * 100}%`,
              backgroundColor: part.backgroundColor,
            }}
          />
        ))}
      </div>
    </div>
  );
}

function CupDetail({
  card,
  small = false,
  textStyle,
  highlight = false,
}: {
  card: CaosCard;
  small?: boolean;
  textStyle?: CSSProperties;
  highlight?: boolean;
}) {
  const { hot, iced } = liberoCupCounts(card);
  const mixed = hot > 0 && iced > 0;
  return (
    <>
      <div
        className={`flex flex-wrap justify-center gap-x-1 font-black tabular-nums leading-tight ${small ? "text-[clamp(20px,2.2vw,42px)]" : "text-[clamp(24px,2.8vw,54px)]"}`}
        aria-label={`オーダー番号 ${cardOrderNos(card).join("、")}`}
      >
        {cardOrderNos(card).map((no) => (
          <span key={no} style={textStyle} className="rounded-md px-1">
            #{orderNoLabel(no)}
          </span>
        ))}
      </div>
      <div
        className="flex flex-wrap items-center justify-center gap-2"
        aria-label={[
          hot ? `ホット ${hot}杯` : "",
          iced ? `アイス ${iced}杯` : "",
        ]
          .filter(Boolean)
          .join("、")}
      >
        {mixed ? (
          <>
            <span
              className={`rounded-lg border border-red-300 bg-red-50 px-2 ${highlight ? "text-red-700" : "text-red-950"} ${small ? "text-[clamp(16px,1.5vw,28px)]" : "text-[clamp(20px,2vw,38px)]"} font-black`}
            >
              {hot}杯
            </span>
            <span
              aria-hidden="true"
              style={textStyle}
              className="rounded px-0.5"
            >
              ＋
            </span>
            <span
              className={`rounded-lg border border-blue-300 bg-blue-50 px-2 ${highlight ? "text-red-700" : "text-blue-950"} ${small ? "text-[clamp(16px,1.5vw,28px)]" : "text-[clamp(20px,2vw,38px)]"} font-black`}
            >
              {iced}杯
            </span>
          </>
        ) : (
          <span
            style={textStyle}
            className={`rounded px-1 font-black ${small ? "text-[clamp(18px,1.8vw,34px)]" : "text-[clamp(22px,2.4vw,46px)]"}`}
          >
            {card.cups.length}杯
          </span>
        )}
      </div>
    </>
  );
}
