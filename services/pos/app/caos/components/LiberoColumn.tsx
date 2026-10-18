import type { CaosCard } from "@cafeore/common";
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

/** リベロの縦1列。上が抽出中、下が待機先頭。時間は共通の抽出予定に基づく目安。 */
export function LiberoColumn({
  row: { lane, brew },
  flashing,
  nextIntensity = 0.25,
}: { row: LiberoLane; flashing: boolean; nextIntensity?: number }) {
  const next = lane.queued[0];
  const progress = brew?.progress ?? 0;
  const currentColor = brew
    ? liberoColor(brew.card, brewIntensity(progress))
    : undefined;
  const nextColor = next ? liberoColor(next, nextIntensity) : undefined;
  const remaining = brew ? Math.max(0, brew.plannedSec - brew.elapsedSec) : 0;
  return (
    <section
      data-libero-dripper={lane.id}
      aria-label={`ドリッパー${lane.id}`}
      className={`flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-slate-300 bg-white ${flashing ? "caos-arrival" : ""}`}
    >
      <header className="flex min-h-[13vh] shrink-0 flex-col items-center justify-center gap-1 border-slate-200 border-b bg-white px-1 py-2 text-center">
        <span className="font-black text-[clamp(24px,3vw,56px)] leading-none">
          {lane.id}
        </span>
        <LaneName
          dripper={lane.id}
          wrap
          className={`justify-center font-black text-[clamp(16px,1.8vw,34px)] leading-tight ${justStarted(brew?.elapsedSec) ? "text-red-700" : ""}`}
        />
      </header>
      <div className="relative isolate flex min-h-0 flex-[3] flex-col items-center justify-center overflow-y-auto bg-slate-100 px-1.5 py-3 text-center">
        {currentColor && <LiberoBackground palette={currentColor} />}
        <div
          style={currentColor?.textStyle}
          className="relative z-[1] flex w-full min-w-0 flex-col items-center gap-[2vh] rounded-xl px-1 py-2"
        >
          {brew ? (
            <>
              <CupDetail card={brew.card} />
              <div className="w-full border-current/20 border-t pt-[2vh]">
                {remaining > 0 && (
                  <p className="mb-1 font-bold text-[clamp(12px,1.1vw,20px)]">
                    あと
                  </p>
                )}
                <p
                  className={`font-black tabular-nums leading-tight ${remaining > 0 ? "text-[clamp(22px,3.2vw,62px)]" : "whitespace-nowrap text-[clamp(18px,2vw,38px)]"}`}
                >
                  {remaining > 0 ? clockLabel(remaining) : "あとちょっと"}
                </p>
                <div
                  className="mx-auto mt-3 h-2 w-[85%] overflow-hidden rounded-full bg-current/15"
                  aria-label={`残り時間の目安 ${Math.round((1 - progress) * 100)}%`}
                >
                  <div
                    className="h-full rounded-full bg-current/70 transition-[width] duration-1000 ease-linear motion-reduce:transition-none"
                    style={{ width: `${(1 - progress) * 100}%` }}
                  />
                </div>
              </div>
            </>
          ) : (
            <p className="font-bold text-[clamp(18px,2vw,38px)] text-slate-500">
              {next ? "開始待ち" : "空き"}
            </p>
          )}
        </div>
      </div>
      <div className="relative isolate flex min-h-0 flex-[2] flex-col items-center justify-center overflow-y-auto border-slate-300 border-t-2 bg-white px-1.5 py-3 text-center">
        {nextColor && <LiberoBackground palette={nextColor} />}
        <div
          style={nextColor?.textStyle}
          className="relative z-[1] flex w-full min-w-0 flex-col items-center gap-[1.5vh] rounded-xl px-1 py-2"
        >
          <p className="font-bold text-[clamp(12px,1.2vw,22px)] opacity-75">
            NEXT
          </p>
          {next ? (
            <CupDetail card={next} small />
          ) : (
            <p className="font-bold text-[clamp(16px,1.5vw,28px)] text-slate-400">
              予定なし
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

/** 背景面だけを1秒で補間する。文字の白黒は補間せず可読性を保つ。 */
function LiberoBackground({
  palette,
}: { palette: ReturnType<typeof liberoColor> }) {
  return (
    <div
      aria-hidden="true"
      className="-z-[1] pointer-events-none absolute inset-0 flex"
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
  );
}

function CupDetail({
  card,
  small = false,
}: { card: CaosCard; small?: boolean }) {
  const { hot, iced } = liberoCupCounts(card);
  const mixed = hot > 0 && iced > 0;
  return (
    <>
      <div
        className={`flex flex-wrap justify-center gap-x-1 font-black tabular-nums leading-tight ${small ? "text-[clamp(20px,2.2vw,42px)]" : "text-[clamp(24px,2.8vw,54px)]"}`}
        aria-label={`オーダー番号 ${cardOrderNos(card).join("、")}`}
      >
        {cardOrderNos(card).map((no) => (
          <span key={no}>#{orderNoLabel(no)}</span>
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
              className={`rounded-lg border border-red-300 bg-red-50 px-2 text-red-950 ${small ? "text-[clamp(16px,1.5vw,28px)]" : "text-[clamp(20px,2vw,38px)]"} font-black`}
            >
              {hot}杯
            </span>
            <span aria-hidden="true">＋</span>
            <span
              className={`rounded-lg border border-blue-300 bg-blue-50 px-2 text-blue-950 ${small ? "text-[clamp(16px,1.5vw,28px)]" : "text-[clamp(20px,2vw,38px)]"} font-black`}
            >
              {iced}杯
            </span>
          </>
        ) : (
          <span
            className={`font-black ${small ? "text-[clamp(18px,1.8vw,34px)]" : "text-[clamp(22px,2.4vw,46px)]"}`}
          >
            {card.cups.length}杯
          </span>
        )}
      </div>
    </>
  );
}
