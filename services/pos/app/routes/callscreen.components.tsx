import { cn } from "~/lib/utils";

// 呼び出し画面は 1920x1080 の固定レイアウトで組み、表示側では拡大縮小だけで合わせる。
// 実機の解像度に関わらず、番号の大きさとすき間の比率が変わらないようにするため。
export const STAGE_W = 1920;
export const STAGE_H = 1080;

/** ステージの余白。内側に金の額縁線を引くので広めに取る */
const STAGE_PADDING = 40;
/** 段（お呼び出し中・ドリップ中・準備中）どうしのすき間 */
const SECTION_GAP = 28;
/** プレート同士のすき間 */
const GAP = 20;
const HEADING_H = 56;
/** 見出しと下のプレート領域を合わせた高さ */
const HEADING_BLOCK = HEADING_H + 16;
/** CM に重ねる／呼び出し画面の下に敷く「準備中」バーの高さ */
export const PREP_BAR_H = 140;
/** CM に重ねる「ドリップ中」帯の高さ */
export const DRIP_BAND_H = 376;
const DRIP_BAND_PADDING_X = 40;
const DRIP_BAND_PADDING_Y = 24;
/** 帯の中のプレート領域の高さ */
const DRIP_BAND_BOARD_H = DRIP_BAND_H - DRIP_BAND_PADDING_Y * 2 - HEADING_BLOCK;

/** 呼び出し画面のプレート領域の幅 */
export const BOARD_W = STAGE_W - STAGE_PADDING * 2;
/** CM に重ねるドリップ帯のプレート領域の幅 */
const BAND_BOARD_W = STAGE_W - DRIP_BAND_PADDING_X * 2;

/** 準備中バーに並べる最大件数。あふれた分は件数だけ出す */
const PREP_BAR_CAP = 10;

// 色は tailwind.css のテーマカラーから取る（年度でテーマカラーが変わっても追従する）。
// テーマカラーの深い青の地に、撫子色の光と金の差し色を置く（cashier-mini と同じ組み合わせ）
/** CM に重ねる帯の地 */
const GRAD_DEEP =
  "linear-gradient(135deg in oklch, var(--color-theme-deep), color-mix(in oklch, var(--color-theme-deep) 65%, black))";
const EASE = "cubic-bezier(0.4, 0, 0.2, 1)";

/**
 * 件数ごとの行割り。行が増えるほど 1 件あたりが小さくなるので、
 * 上の行を少ない列にして新しいものを大きく残す。
 */
const ROWS: Record<number, number[]> = {
  1: [1],
  2: [2],
  3: [3],
  4: [2, 2],
  5: [2, 3],
  6: [3, 3],
  7: [2, 2, 3],
  8: [2, 3, 3],
  9: [3, 3, 3],
  10: [2, 4, 4],
  11: [3, 4, 4],
  12: [4, 4, 4],
};

const rowsFor = (count: number): number[] => {
  const rows = ROWS[count];
  if (rows) return rows;

  // 13 件以上は 4 列 3 行のあとに 6 件ずつ行を足していく
  const overflowed = [4, 4, 4];
  let rest = count - 12;
  while (rest > 0) {
    const take = Math.min(6, rest);
    overflowed.push(take);
    rest -= take;
  }
  return overflowed;
};

export type PlateItem = {
  id: number;
  /** 番号の下に出す補足。ドリップ中なら「1st ドリッパー」 */
  caption: string | null;
};

export type PlateRect = PlateItem & {
  x: number;
  y: number;
  w: number;
  h: number;
  fontSize: number;
};

/**
 * 与えられた枠に全件を可能な限り大きく敷き詰める。
 * 先頭のものほど上の行に来るので、呼び出しの新しいものが大きく残る。
 */
export const layoutPlates = (
  items: PlateItem[],
  width: number,
  height: number,
  maxFontSize: number,
): PlateRect[] => {
  if (items.length === 0 || height <= 0) return [];

  const rows = rowsFor(items.length);
  // 列数が少ない行ほど大きく取れるよう、1/列数 で高さを配分する
  const weights = rows.map((columns) => 1 / columns);
  const weightSum = weights.reduce((acc, cur) => acc + cur, 0);
  const usableH = height - GAP * (rows.length - 1);

  const rects: PlateRect[] = [];
  let index = 0;
  let y = 0;

  rows.forEach((columns, rowIndex) => {
    const h = Math.round((usableH * weights[rowIndex]) / weightSum);
    const w = Math.round((width - GAP * (columns - 1)) / columns);

    for (let column = 0; column < columns && index < items.length; column++) {
      const item = items[index];
      // 補足を出す分だけ番号の取り分を減らす
      const box = item.caption ? h * 0.62 : h * 0.72;
      rects.push({
        ...item,
        x: column * (w + GAP),
        y,
        w,
        h,
        fontSize: Math.round(
          Math.min(box, (w * 0.82) / String(item.id).length, maxFontSize),
        ),
      });
      index++;
    }

    y += h + GAP;
  });

  return rects;
};

/**
 * 呼び出し画面を縦に割ったときの各段の高さ。
 * 準備中バーは高さ固定で、残りをお呼び出しとドリップで分ける。
 */
export const sectionHeights = (hasDrip: boolean, hasPrep: boolean) => {
  const sections = 1 + (hasDrip ? 1 : 0) + (hasPrep ? 1 : 0);
  const rest =
    STAGE_H -
    STAGE_PADDING * 2 -
    (hasPrep ? PREP_BAR_H : 0) -
    SECTION_GAP * (sections - 1);
  const calling = hasDrip ? Math.round(rest * 0.66) : rest;
  const drip = hasDrip ? rest - calling : 0;

  return {
    calling,
    drip,
    // プレート領域は見出しとそのすき間の分だけ低くなる
    callingBoard: calling - HEADING_BLOCK,
    dripBoard: hasDrip ? drip - HEADING_BLOCK : 0,
  };
};

/** 呼び出し画面の中身を置く枠（額縁線の内側） */
export const stageContentStyle: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "flex",
  flexDirection: "column",
  gap: `${SECTION_GAP}px`,
  padding: `${STAGE_PADDING}px`,
  boxSizing: "border-box",
};

// 紙のようなざらつき（SVG のノイズを敷き詰める）
const grainTexture = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="3" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.9 0"/></filter><rect width="100%" height="100%" filter="url(#n)"/></svg>',
)}")`;

/**
 * 背景：テーマカラーの深い青に、撫子色の光・布目・粒子・周辺減光を重ね、
 * 珈琲・俺のロゴを薄く敷いて金の額縁線で囲む。どれも動かないので、一度描けば済む。
 * subdued は番号を上に並べるとき（ロゴが番号の邪魔にならないよう、さらに薄くする）
 */
export function CallScreenBackdrop({
  logo,
  subdued = false,
}: {
  logo: string;
  subdued?: boolean;
}) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 100% at 18% 0%, var(--color-theme-primary) 0%, var(--color-theme-deep) 50%, color-mix(in oklch, var(--color-theme-deep) 55%, black) 100%)",
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(55% 60% at 100% 100%, color-mix(in oklch, var(--color-theme-sub-deep) 40%, transparent) 0%, transparent 100%)",
        }}
      />
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(45deg, white 0 1px, transparent 1px 6px), repeating-linear-gradient(-45deg, white 0 1px, transparent 1px 6px)",
        }}
      />
      <div
        className="absolute inset-0 opacity-[0.12] mix-blend-overlay"
        style={{ backgroundImage: grainTexture }}
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 50%, rgba(0, 0, 0, 0.4) 100%)",
        }}
      />
      <img
        src={logo}
        alt=""
        className={cn(
          "absolute inset-0 m-auto h-[80%] object-contain",
          subdued ? "opacity-25" : "opacity-60",
        )}
      />
      {/* 額縁のような金の細線 */}
      <div className="absolute inset-[14px] rounded-[1.25rem] border border-theme-gold/30" />
      <div className="absolute inset-[20px] rounded-[1rem] border border-theme-gold/15" />
    </div>
  );
}

/**
 * 見出し。日本語を主に英字を添え、金の細線を右へ流す。aside は細線の右に置く
 */
export function SectionHeading({
  ja,
  en,
  indicator,
  aside,
}: {
  ja: string;
  en: string;
  indicator?: React.ReactNode;
  aside?: React.ReactNode;
}) {
  return (
    <div
      className="flex shrink-0 items-center gap-6"
      style={{ height: `${HEADING_H}px` }}
    >
      <h2 className="font-zen text-4xl text-white tracking-[0.2em]">{ja}</h2>
      <span className="font-zen text-lg text-theme-gold uppercase tracking-[0.4em]">
        {en}
      </span>
      {indicator}
      <div className="h-px flex-1 bg-linear-to-r from-theme-gold/60 to-transparent" />
      {aside}
    </div>
  );
}

/** ドリップ中の見出しに添える、ゆっくり脈打つ点 */
export function BrewingIndicator() {
  return (
    <span className="relative flex size-3">
      <span className="absolute inline-flex size-full animate-ping rounded-full bg-theme-gold opacity-60 [animation-duration:2s]" />
      <span className="relative inline-flex size-3 rounded-full bg-theme-gold" />
    </span>
  );
}

type PlateBoardProps = {
  plates: PlateRect[];
  /** calling はお呼び出し中（金の縁で目立たせる）、drip はドリップ中 */
  tone: "calling" | "drip";
  isFlashing: (id: number) => boolean;
  /** CM に重ねる帯では影を消す */
  shadow?: boolean;
};

/**
 * プレートを並べる領域。位置と大きさは絶対指定で、
 * 件数が変わったときは同じプレートが滑って移動する。
 * プレートは地が透ける硝子のカード。点滅は撫子色で光らせ、終われば白い番号に落ち着く
 */
export function PlateBoard({
  plates,
  tone,
  isFlashing,
  shadow = true,
}: PlateBoardProps) {
  return (
    <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
      {plates.map((plate) => {
        const on = isFlashing(plate.id);

        return (
          <div
            key={plate.id}
            className={cn(
              "flex flex-col items-center justify-center overflow-hidden rounded-2xl border",
              on
                ? "border-theme-gold bg-theme-sub-deep/75"
                : tone === "calling"
                  ? "border-theme-gold/50 bg-white/[0.1]"
                  : "border-white/15 bg-white/[0.07]",
              shadow &&
                "shadow-[0_12px_30px_rgba(0,0,0,0.25),inset_0_1px_0_rgba(255,255,255,0.12)]",
            )}
            style={{
              position: "absolute",
              left: `${plate.x}px`,
              top: `${plate.y}px`,
              width: `${plate.w}px`,
              height: `${plate.h}px`,
              gap: plate.caption ? "4px" : 0,
              transition: `left 300ms ${EASE}, top 300ms ${EASE}, width 300ms ${EASE}, height 300ms ${EASE}`,
            }}
          >
            <div
              className="font-semibold font-zen text-white tabular-nums leading-none"
              style={{ fontSize: `${plate.fontSize}px` }}
            >
              {plate.id}
            </div>
            {plate.caption && (
              <div
                className={cn(
                  "whitespace-nowrap font-medium font-noto leading-tight tracking-[0.08em]",
                  on ? "text-white" : "text-theme-gold",
                )}
                style={{
                  fontSize: `${Math.max(20, Math.round(plate.fontSize * 0.24))}px`,
                }}
              >
                {plate.caption}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * 準備中の番号を並べる帯。呼び出し画面でも CM の上でも同じものを使う。
 * overlay（CM の上）では端から端まで深い青の地を敷く
 */
export function PreparingBar({
  orderIds,
  overlay = false,
}: {
  orderIds: number[];
  overlay?: boolean;
}) {
  const shown = orderIds.slice(0, PREP_BAR_CAP);
  const rest = orderIds.length - shown.length;

  return (
    <div
      className={cn(
        "flex shrink-0 items-center gap-8 px-10",
        overlay
          ? "border-theme-gold/40 border-t"
          : "rounded-2xl border border-white/10 bg-white/[0.03]",
      )}
      style={{
        height: `${PREP_BAR_H}px`,
        backgroundImage: overlay ? GRAD_DEEP : undefined,
      }}
    >
      <div className="flex shrink-0 flex-col gap-1">
        <span className="font-zen text-3xl text-white tracking-[0.2em]">
          準備中
        </span>
        <span className="font-zen text-sm text-theme-gold uppercase tracking-[0.4em]">
          Preparing
        </span>
      </div>
      <div className="h-[60%] w-px shrink-0 bg-linear-to-b from-transparent via-theme-gold/50 to-transparent" />
      <div className="flex min-w-0 flex-1 items-center gap-4 overflow-hidden">
        {shown.map((orderId) => (
          <div
            key={orderId}
            className="flex shrink-0 items-center justify-center rounded-xl border border-white/15 bg-white/[0.05] px-5 py-2"
          >
            <div className="font-zen text-5xl text-white/80 tabular-nums leading-none">
              {orderId}
            </div>
          </div>
        ))}
        {rest > 0 && (
          <div className="shrink-0 whitespace-nowrap font-bold text-2xl text-white/70">
            他 {rest}件
          </div>
        )}
      </div>
    </div>
  );
}

type DripBandProps = {
  plates: PlateRect[];
  isFlashing: (id: number) => boolean;
  preparingCount: number;
};

/**
 * CM の下側に重ねるドリップ中の帯。
 * 呼び出しが無い間はここだけ出して CM は流し続ける。
 */
export function DripBand({
  plates,
  isFlashing,
  preparingCount,
}: DripBandProps) {
  return (
    <div
      className="absolute right-0 bottom-0 left-0 flex flex-col gap-4 border-theme-gold/40 border-t"
      style={{
        height: `${DRIP_BAND_H}px`,
        padding: `${DRIP_BAND_PADDING_Y}px ${DRIP_BAND_PADDING_X}px`,
        boxSizing: "border-box",
        backgroundImage: GRAD_DEEP,
      }}
    >
      <SectionHeading
        ja="ドリップ中"
        en="Brewing"
        indicator={<BrewingIndicator />}
        aside={
          <span className="whitespace-nowrap font-noto text-2xl text-white/70">
            準備中 {preparingCount}件
          </span>
        }
      />
      <PlateBoard
        plates={plates}
        tone="drip"
        isFlashing={isFlashing}
        shadow={false}
      />
    </div>
  );
}

export const dripBandLayout = (items: PlateItem[]) =>
  layoutPlates(items, BAND_BOARD_W, DRIP_BAND_BOARD_H, 200);
