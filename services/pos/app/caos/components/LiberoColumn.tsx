import type { CaosCard } from "@cafeore/common";
import { cardOrderNos, orderNoLabel } from "../logic/cards";
import { clockLabel } from "../logic/format";
import type { LiberoLane } from "../logic/libero";
import { LaneName } from "./LaneParts";

/** リベロの縦1列。上が抽出中、下が待機先頭。時間は共通の抽出予定に基づく目安。 */
export function LiberoColumn({
  row: { lane, brew },
  flashing,
}: { row: LiberoLane; flashing: boolean }) {
  const next = lane.queued[0];
  const progress = brew?.progress ?? 0;
  const shade = Math.round(255 - 90 * progress);
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
          className="justify-center font-black text-[clamp(16px,1.8vw,34px)] leading-tight"
        />
      </header>
      <div
        style={{
          backgroundColor: brew ? `rgb(255, ${shade}, ${shade})` : "#f1f5f9",
        }}
        className="flex min-h-0 flex-[3] flex-col items-center justify-center gap-[2vh] overflow-y-auto px-1.5 py-3 text-center transition-colors duration-1000 ease-linear motion-reduce:transition-none"
      >
        <p className="font-bold text-[clamp(12px,1.1vw,20px)] text-slate-600">
          {brew ? "いま淹れています" : "抽出していません"}
        </p>
        {brew ? (
          <>
            <CupDetail card={brew.card} />
            <div className="w-full border-slate-900/10 border-t pt-[2vh]">
              <p className="mb-1 font-bold text-[clamp(12px,1.1vw,20px)]">
                {remaining > 0 ? "できあがりまで 約" : "できあがり間近"}
              </p>
              <p
                className={`font-black tabular-nums leading-tight ${remaining > 0 ? "text-[clamp(22px,3.2vw,62px)]" : "whitespace-nowrap text-[clamp(18px,2vw,38px)]"}`}
              >
                {remaining > 0 ? clockLabel(remaining) : "あとちょっと"}
              </p>
              <div
                className="mx-auto mt-3 h-2 w-[85%] overflow-hidden rounded-full bg-black/10"
                aria-label={`残り時間の目安 ${Math.round((1 - progress) * 100)}%`}
              >
                <div
                  className="h-full rounded-full bg-red-700/70 transition-[width] duration-1000 ease-linear motion-reduce:transition-none"
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
      <div className="flex min-h-0 flex-[2] flex-col items-center justify-center gap-[1.5vh] overflow-y-auto border-slate-300 border-t-2 bg-white px-1.5 py-3 text-center">
        <p className="font-bold text-[clamp(12px,1.2vw,22px)] text-slate-500">
          次に淹れる
        </p>
        {next ? (
          <CupDetail card={next} small />
        ) : (
          <p className="font-bold text-[clamp(16px,1.5vw,28px)] text-slate-400">
            予定なし
          </p>
        )}
      </div>
    </section>
  );
}

function CupDetail({
  card,
  small = false,
}: { card: CaosCard; small?: boolean }) {
  const iced = card.cups[0].item.item_type.iced_brew;
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
      <div className="flex flex-wrap items-center justify-center gap-2">
        <span
          className={`rounded-lg border px-2 py-1 font-black ${small ? "text-[clamp(14px,1.4vw,26px)]" : "text-[clamp(16px,1.7vw,32px)]"} ${iced ? "border-sky-300 bg-sky-100 text-sky-900" : "border-orange-300 bg-orange-100 text-orange-950"}`}
        >
          {iced ? "アイス" : "ホット"}
        </span>
        <span
          className={`font-black ${small ? "text-[clamp(18px,1.8vw,34px)]" : "text-[clamp(22px,2.4vw,46px)]"}`}
        >
          {card.cups.length}杯
        </span>
      </div>
    </>
  );
}
