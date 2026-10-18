import { useRef, useState } from "react";
import { cn } from "~/lib/utils";
import {
  FLASH_FADE_MS,
  FLASH_MS,
  type Flash,
  URGENT_MS,
} from "./callscreen.hooks";

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
/**
 * 番号の数字 1 文字の幅（文字の大きさに対する比）。明朝（Zen Old Mincho）の数字はいちばん広い 0 で 0.61 ほど。
 * 番号は 4 桁まで出るので、桁数ぶんの幅から文字の大きさを決める
 */
const DIGIT_EM = 0.62;
/** 番号に使ってよいプレートの幅の割合 */
const NUMBER_FILL = 0.8;
/** 補足（「1st ドリッパー」）に使ってよいプレートの幅の割合と、文字の大きさの下限 */
const CAPTION_FILL = 0.88;
const CAPTION_MIN = 20;
/** 番号と補足のすき間 */
const CAPTION_GAP = 4;
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
/** 準備中バーの見出し（準備中・Preparing）の幅 */
const PREP_LABEL_W = 136;
/** 準備中バーの左右の余白（px-10）と、見出し・区切り線・番号の間（gap-8） */
const PREP_BAR_PADDING_X = 40;
const PREP_BAR_GAP = 32;
/** 準備中の番号札の文字の大きさ（text-5xl）、左右の余白と枠線（px-5・border）、札どうしのすき間（gap-4） */
const PREP_FONT = 48;
const PREP_CHIP_EDGE = 20 * 2 + 2;
const PREP_CHIP_GAP = 16;

// 色は tailwind.css のテーマカラーから取る（年度でテーマカラーが変わっても追従する）。
// テーマカラーの深い青の地に、撫子色の光と金の差し色を置く（cashier-mini と同じ組み合わせ）
/** CM に重ねる帯の地 */
const GRAD_DEEP =
  "linear-gradient(135deg in oklch, var(--color-theme-deep), color-mix(in oklch, var(--color-theme-deep) 65%, black))";
const EASE = "cubic-bezier(0.4, 0, 0.2, 1)";
/** 件数が変わったときに、プレートが新しい場所へ滑る長さ */
const SLIDE_MS = 300;
/** 入ってきたプレートが浮かぶ長さ */
const ENTER_MS = 360;

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

/**
 * 件数を rowCount 行に、行ごとの件数がそろうように分ける。余りは下の行に回す（7 件を 2 行なら [3, 4]）
 */
const evenRows = (count: number, rowCount: number): number[] => {
  const base = Math.floor(count / rowCount);
  const extra = count % rowCount;
  return Array.from(
    { length: rowCount },
    (_, row) => base + (row >= rowCount - extra ? 1 : 0),
  );
};

/**
 * 補足の幅（文字の大きさに対する比）。英数字は 0.6、かなと記号は 1 に字間（tracking 0.08em）を足し、多めに見積もる
 */
const captionEm = (caption: string) =>
  [...caption].reduce(
    (sum, char) => sum + (char.charCodeAt(0) < 0x80 ? 0.6 : 1) + 0.08,
    0,
  );

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
  /** 補足の文字の大きさ。補足が無ければ 0 */
  captionFontSize: number;
  /** 上から何段目か */
  row: number;
};

/**
 * 与えられた枠に全件を可能な限り大きく敷き詰める。
 * 行割りを渡さなければ件数ごとの行割り（ROWS）を使い、先頭のものほど上の行に来るので、呼び出しの新しいものが大きく残る。
 * 番号は桁数ぶんの幅がプレートに入る大きさにする（4 桁でもはみ出さない）
 */
export const layoutPlates = (
  items: PlateItem[],
  width: number,
  height: number,
  maxFontSize: number,
  rows: number[] = rowsFor(items.length),
): PlateRect[] => {
  if (items.length === 0 || height <= 0) return [];

  // 列数が少ない行ほど大きく取れるよう、1/列数 で高さを配分する。
  // ただし上の行より高くはしない（13 件以上で最後の行の件数が少なくても、古い番号を大きくしない）
  let widest = 0;
  const weights = rows.map((columns) => {
    widest = Math.max(widest, columns);
    return 1 / widest;
  });
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
      let fontSize = Math.min(
        box,
        (w * NUMBER_FILL) / (String(item.id).length * DIGIT_EM),
        maxFontSize,
      );
      let captionFontSize = 0;
      if (item.caption) {
        // 補足は番号の 0.24 倍（下限あり）。プレートの幅に入らなければ縮める
        captionFontSize = Math.min(
          Math.max(CAPTION_MIN, fontSize * 0.24),
          (w * CAPTION_FILL) / captionEm(item.caption),
        );
        // 補足が下限に掛かって大きくなった分は、番号を縮めて高さの 9 割に収める（補足は 1.25 行の高さ）
        fontSize = Math.min(
          fontSize,
          h * 0.9 - CAPTION_GAP - captionFontSize * 1.25,
        );
      }
      rects.push({
        ...item,
        x: column * (w + GAP),
        y,
        w,
        h,
        fontSize: Math.round(fontSize),
        captionFontSize: Math.floor(captionFontSize),
        row: rowIndex,
      });
      index++;
    }

    y += h + GAP;
  });

  return rects;
};

/**
 * ドリップ中のプレートを並べる。行数は、いちばん小さく出る番号がいちばん大きくなるものを選ぶ（同じなら行の少ないほう）。
 * ドリップ中の欄は横長なので、ドリッパーの台数（6）ほどまでは 1 行に並び、ドリッパーの番号順に左から読める。
 * お呼び出し中と違って新しいものを大きく残す理由が無いので、行ごとの件数はそろえる
 */
export const layoutDripPlates = (
  items: PlateItem[],
  width: number,
  height: number,
  maxFontSize: number,
): PlateRect[] => {
  let best: PlateRect[] = [];
  let bestSize = Number.NEGATIVE_INFINITY;
  for (let rowCount = 1; rowCount <= items.length; rowCount++) {
    const plates = layoutPlates(
      items,
      width,
      height,
      maxFontSize,
      evenRows(items.length, rowCount),
    );
    const size = Math.min(...plates.map((plate) => plate.fontSize));
    if (size > bestSize) {
      best = plates;
      bestSize = size;
    }
  }
  return best;
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

/**
 * プリズムで分けた光の色。白い芯の両側に、撫子色・紫・青・水色を並べる。
 * 分光の色のうち黄色（と黄緑）は入れない。テーマカラーではなく光の色なので、ここに直に書く
 */
const PRISM_LIGHT =
  "linear-gradient(90deg in oklch, transparent 0%, oklch(0.82 0.1 0 / 0.5) 18%, oklch(0.74 0.17 340 / 0.75) 32%, oklch(0.97 0.02 300 / 0.95) 50%, oklch(0.7 0.16 285 / 0.8) 64%, oklch(0.74 0.13 245 / 0.65) 78%, oklch(0.86 0.09 210 / 0.45) 90%, transparent 100%)";

/** 光らせている間の地が浮かぶ長さ */
const GLOW_IN_MS = 340;
/** プリズムの光が抜け始めるまで（地が浮かび切るころ）と、抜けるのにかける長さ */
const PRISM_DELAY_MS = 220;
const PRISM_MS = 1460;

/**
 * 光り始めてから ms 後を、アニメーションの開始の遅れ（animation-delay）に直す。
 * プレートが作り直されても（CM と呼び出し画面の切り替えなど）、頭からではなく光り始めからの続きを出すため
 */
function useFlashDelay(startedAt: number) {
  const [mountedAt] = useState(() => performance.now());
  return (ms: number) => `${Math.round(startedAt + ms - mountedAt)}ms`;
}

/**
 * 光らせている間の地。深い青から撫子色を浮かべ、FLASH_MS の終わりの FLASH_FADE_MS で元に戻す
 */
function GlowBase({ startedAt }: { startedAt: number }) {
  const delay = useFlashDelay(startedAt);

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 rounded-[inherit]"
      style={{
        backgroundImage:
          "linear-gradient(40deg in oklch, var(--color-theme-sub-deep), var(--color-theme-deep))",
        animation: `call-glow-in ${GLOW_IN_MS}ms ease-out ${delay(0)} both, call-glow-out ${FLASH_FADE_MS}ms ease-in-out ${delay(FLASH_MS - FLASH_FADE_MS)} forwards`,
      }}
    />
  );
}

/** プリズムのような光の帯。地が浮かび切ってから、左の外から右の外へ一度抜ける */
function PrismLight({ startedAt }: { startedAt: number }) {
  const delay = useFlashDelay(startedAt);

  return (
    <div
      aria-hidden
      className="-inset-y-[10%] pointer-events-none absolute left-0 w-[55%] mix-blend-screen"
      style={{
        background: PRISM_LIGHT,
        filter: "blur(10px)",
        animation: `prism-sweep ${PRISM_MS}ms ease-in-out ${delay(PRISM_DELAY_MS)} both`,
      }}
    />
  );
}

// 呼び出し催促した番号は、地は変えずに金の縁を脈打たせる
/** 脈打つ金の縁。縁の内側だけを光らせ、番号の後ろは明るくしない */
const URGENT_RIM =
  "inset 0 0 0 4px color-mix(in oklch, var(--color-theme-gold) 70%, white), inset 0 0 56px 4px color-mix(in oklch, var(--color-theme-gold) 45%, transparent)";
/** プレートの外ににじませる金の光（プレートは中身をはみ出させないので、外の光は脈打たせず一定で出す） */
const URGENT_HALO =
  "0 0 48px 4px color-mix(in oklch, var(--color-theme-gold) 50%, transparent)";
/** 縁の光が消えてから光り切るまでの長さ（行き来するので、1 回の脈はこの 2 倍） */
const URGENT_PULSE_MS = 700;

/**
 * 呼び出し催促した番号の縁。金の縁と内側の光をゆっくり脈打たせ、URGENT_MS の終わりの FLASH_FADE_MS で消す。
 * 脈も光り始めからの続きを出すので、プレートが作り直されても拍子がずれない
 */
function UrgentRim({ startedAt }: { startedAt: number }) {
  const delay = useFlashDelay(startedAt);

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 rounded-[inherit]"
      style={{
        animation: `call-glow-in ${GLOW_IN_MS}ms ease-out ${delay(0)} both, call-glow-out ${FLASH_FADE_MS}ms ease-in-out ${delay(URGENT_MS - FLASH_FADE_MS)} forwards`,
      }}
    >
      <div
        className="absolute inset-0 rounded-[inherit]"
        style={{
          boxShadow: URGENT_RIM,
          animation: `call-urgent-pulse ${URGENT_PULSE_MS}ms ease-in-out ${delay(0)} infinite alternate`,
        }}
      />
    </div>
  );
}

/** 段が変わったら別のプレートとして作り直す */
const plateKey = (plate: PlateRect) => `${plate.id}:${plate.row}`;

type PlateBoardProps = {
  plates: PlateRect[];
  /** calling はお呼び出し中（金の縁で目立たせる）、drip はドリップ中 */
  tone: "calling" | "drip";
  flashesOf: (id: number) => readonly Flash[];
  /** 呼び出し催促で目立たせている回（お呼び出し中だけ渡す） */
  urgentsOf?: (id: number) => readonly Flash[];
  /** CM に重ねる帯では影を消す */
  shadow?: boolean;
};

/**
 * プレートを並べる領域。位置と大きさは絶対指定で、
 * 件数が変わったときは、同じ段に残るプレートは滑って移動する（どれも同じ速さで動くので、すき間を保ったまま重ならない）。
 * 新しく入った番号と段が変わる番号は作り直し、ほかのプレートが滑り終わってから、その場所に浮かべる
 * （そのまま滑らせると、段をまたいで斜めに横切ったり、どいていくプレートの下から出てきたりして重なる）。
 * プレートは地が透ける硝子のカード。新しく入った番号は光の地を浮かべてプリズムの光を流し、終われば硝子のカードに戻る。
 * 光らせている最中にまた呼ばれたら、地は重ね、光の帯はそれぞれ流す。
 * 呼び出し催促した番号は、目立たせている間は金の縁を脈打たせ、外に金の光をにじませる（また催促されたら、縁を重ねて後の回で続ける）
 */
export function PlateBoard({
  plates,
  tone,
  flashesOf,
  urgentsOf,
  shadow = true,
}: PlateBoardProps) {
  // プレート（番号と段）ごとの、浮かべ始めるまでの待ち。初めて出たときに決めて、あとは変えない
  const enterDelaysRef = useRef(new Map<string, number>());
  const prevDelays = enterDelaysRef.current;
  const keys = plates.map(plateKey);
  // 前から残るプレートがあれば、それが滑り終わるのを待つ。無ければ（最初の 1 件など）すぐ浮かべる
  const othersSlide = keys.some((key) => prevDelays.has(key));
  const enterDelays = new Map(
    keys.map((key) => [
      key,
      prevDelays.get(key) ?? (othersSlide ? SLIDE_MS : 0),
    ]),
  );
  enterDelaysRef.current = enterDelays;

  return (
    <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
      {plates.map((plate) => {
        const key = plateKey(plate);
        const flashes = flashesOf(plate.id);
        const urgents = urgentsOf?.(plate.id) ?? [];
        // 縁と文字は、元に戻るフェードに入ったら地と一緒に戻す
        const lit = flashes.some((flash) => !flash.fading);
        const hurried = urgents.some((urgent) => !urgent.fading);
        const litTransition = `${lit || hurried ? GLOW_IN_MS : FLASH_FADE_MS}ms ${EASE}`;

        return (
          <div
            key={key}
            className={cn(
              "isolate flex flex-col items-center justify-center overflow-hidden rounded-2xl border",
              tone === "calling" ? "bg-white/[0.1]" : "bg-white/[0.07]",
              // 光らせている間は金の縁を白にする（光に黄色を混ぜない）。催促した番号は金の縁を濃くする
              lit
                ? "border-white/60"
                : hurried
                  ? "border-theme-gold"
                  : tone === "calling"
                    ? "border-theme-gold/50"
                    : "border-white/15",
              shadow &&
                "shadow-[0_12px_30px_rgba(0,0,0,0.25),inset_0_1px_0_rgba(255,255,255,0.12)]",
            )}
            style={{
              position: "absolute",
              left: `${plate.x}px`,
              top: `${plate.y}px`,
              width: `${plate.w}px`,
              height: `${plate.h}px`,
              gap: plate.caption ? `${CAPTION_GAP}px` : 0,
              boxShadow: hurried ? URGENT_HALO : undefined,
              transition: `left ${SLIDE_MS}ms ${EASE}, top ${SLIDE_MS}ms ${EASE}, width ${SLIDE_MS}ms ${EASE}, height ${SLIDE_MS}ms ${EASE}, border-color ${litTransition}, box-shadow ${litTransition}`,
              // 出てきたときだけ流れる（作り直さない限り、二度は流れない）
              animation: `plate-enter ${ENTER_MS}ms ${EASE} ${enterDelays.get(key)}ms both`,
            }}
          >
            {/* 地を全部敷いてから光の帯を重ねる（後の地で前の光の帯が隠れないように）。催促の金の縁は、光の上に重ねる */}
            {flashes.map((flash) => (
              <GlowBase key={flash.key} startedAt={flash.startedAt} />
            ))}
            {flashes.map((flash) => (
              <PrismLight key={flash.key} startedAt={flash.startedAt} />
            ))}
            {urgents.map((urgent) => (
              <UrgentRim key={urgent.key} startedAt={urgent.startedAt} />
            ))}
            <div
              className={cn(
                "relative font-semibold font-zen text-white tabular-nums leading-none",
                // 光の白い芯が重なっても白い番号が沈まないよう、影を敷く
                lit && "[text-shadow:0_2px_18px_rgba(0,0,0,0.45)]",
              )}
              style={{
                fontSize: `${plate.fontSize}px`,
                transition: `font-size ${SLIDE_MS}ms ${EASE}, text-shadow ${litTransition}`,
              }}
            >
              {plate.id}
            </div>
            {plate.caption && (
              <div
                className={cn(
                  "relative whitespace-nowrap font-medium font-noto leading-tight tracking-[0.08em]",
                  lit ? "text-white" : "text-theme-gold",
                )}
                style={{
                  fontSize: `${plate.captionFontSize}px`,
                  transition: `font-size ${SLIDE_MS}ms ${EASE}, color ${litTransition}`,
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

/** 準備中の番号札の幅 */
const prepChipWidth = (orderId: number) =>
  String(orderId).length * DIGIT_EM * PREP_FONT + PREP_CHIP_EDGE;

/** 「他 N件」の幅（text-2xl の太字。「他」「件」と空白に、数字 1 桁あたり 0.6em を多めに見積もる） */
const prepRestWidth = (rest: number) => 24 * (2.3 + 0.6 * String(rest).length);

/**
 * 準備中バーに出す件数。番号札の幅を桁数から出し、入るだけ（PREP_BAR_CAP まで）出す。
 * 入りきらないときは「他 N件」の分を空ける（4 桁の番号でも、札が途中で切れたり「他 N件」が隠れたりしないように）
 */
const preparingShownCount = (orderIds: number[], overlay: boolean) => {
  // 呼び出し画面では額縁の内側に枠線つきで置き、CM の上では端から端まで敷く
  const barW = overlay ? STAGE_W : BOARD_W - 2;
  const listW =
    barW - PREP_BAR_PADDING_X * 2 - PREP_LABEL_W - PREP_BAR_GAP * 2 - 1;
  const widthOf = (count: number) => {
    const chips = orderIds
      .slice(0, count)
      .reduce(
        (sum, orderId) => sum + prepChipWidth(orderId) + PREP_CHIP_GAP,
        0,
      );
    const rest = orderIds.length - count;
    return rest > 0 ? chips + prepRestWidth(rest) : chips - PREP_CHIP_GAP;
  };

  let count = Math.min(orderIds.length, PREP_BAR_CAP);
  while (count > 0 && widthOf(count) > listW) count--;
  return count;
};

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
  const shown = orderIds.slice(0, preparingShownCount(orderIds, overlay));
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
      <div
        className="flex shrink-0 flex-col gap-1"
        style={{ width: `${PREP_LABEL_W}px` }}
      >
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
  flashesOf: (id: number) => readonly Flash[];
  preparingCount: number;
};

/**
 * CM の下側に重ねるドリップ中の帯。
 * 呼び出しが無い間はここだけ出して CM は流し続ける。
 */
export function DripBand({ plates, flashesOf, preparingCount }: DripBandProps) {
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
        flashesOf={flashesOf}
        shadow={false}
      />
    </div>
  );
}

export const dripBandLayout = (items: PlateItem[]) =>
  layoutDripPlates(items, BAND_BOARD_W, DRIP_BAND_BOARD_H, 200);
