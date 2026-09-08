import { FaCoffee } from "react-icons/fa";
import { HiBell } from "react-icons/hi2";
import { LuHourglass } from "react-icons/lu";

// 呼び出し画面は 1920x1080 の固定レイアウトで組み、表示側では拡大縮小だけで合わせる。
// 実機の解像度に関わらず、番号の大きさとすき間の比率が変わらないようにするため。
export const STAGE_W = 1920;
export const STAGE_H = 1080;

const STAGE_PADDING = 8;
const SECTION_PADDING = 16;
const SECTION_GAP = 8;
/** プレート同士のすき間 */
const GAP = 16;
const BANNER_H = 62;
/** バナーと下のプレート領域を合わせた高さ */
const BANNER_BLOCK = BANNER_H + SECTION_GAP;
/** PV に重ねる／呼び出し画面の下に敷く「準備中」バーの高さ */
export const PREP_BAR_H = 148;
/** PV に重ねる「ドリップ中」帯の高さ */
export const DRIP_BAND_H = 376;
/** 帯の中のプレート領域の高さ */
const DRIP_BAND_BOARD_H = 268;
const DRIP_BAND_PADDING = 24;

/** 呼び出し画面のプレート領域の幅 */
export const BOARD_W = STAGE_W - STAGE_PADDING * 2 - SECTION_PADDING * 2;
/** PV に重ねるドリップ帯のプレート領域の幅 */
const BAND_BOARD_W = STAGE_W - DRIP_BAND_PADDING * 2;

/** 準備中バーに並べる最大件数。あふれた分は件数だけ出す */
const PREP_BAR_CAP = 10;

const GRAD_DRIP = "linear-gradient(135deg, #00524f, #00403e, #002e2d)";
export const GRAD_PLATE = "linear-gradient(135deg, #007d79, #006763, #00524f)";
export const GRAD_CALLING =
  "linear-gradient(135deg, #14b8a6, #0d9488, #14b8a6)";
const GRAD_CALL_BANNER = "linear-gradient(to right, #f97316, #006763, #14b8a6)";
const PLATE_SHADOW =
  "8px 8px 16px rgba(0, 0, 0, 0.3), -8px -8px 16px rgba(255, 255, 255, 0.5), inset 0 0 0 1px rgba(255, 255, 255, 0.1)";
const BANNER_SHADOW =
  "0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)";
const CARD_BG = "#ffffff";
const CARD_BORDER = "#e5e5e5";
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
  /** 番号の下に出す補足。ドリップ中なら「1番ドリッパー」 */
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
  const calling = hasDrip ? Math.round(rest * 0.68) : rest;
  const drip = hasDrip ? rest - calling : 0;

  return {
    calling,
    drip,
    // プレート領域はバナーとそのすき間の分だけ低くなる
    callingBoard: calling - BANNER_BLOCK,
    dripBoard: hasDrip ? drip - BANNER_BLOCK : 0,
  };
};

type PlateBoardProps = {
  plates: PlateRect[];
  gradient: string;
  isFlashing: (id: number) => boolean;
  /** PV に重ねる帯では影を消す */
  shadow?: string;
};

/**
 * プレートを並べる領域。位置と大きさは絶対指定で、
 * 件数が変わったときは同じプレートが滑って移動する。
 */
export function PlateBoard({
  plates,
  gradient,
  isFlashing,
  shadow = PLATE_SHADOW,
}: PlateBoardProps) {
  return (
    <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
      {plates.map((plate) => {
        const on = isFlashing(plate.id);

        return (
          <div
            key={plate.id}
            style={{
              position: "absolute",
              left: `${plate.x}px`,
              top: `${plate.y}px`,
              width: `${plate.w}px`,
              height: `${plate.h}px`,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: plate.caption ? "4px" : 0,
              overflow: "hidden",
              background: on ? "transparent" : CARD_BG,
              backgroundImage: on ? gradient : "none",
              border: `1px solid ${CARD_BORDER}`,
              borderRadius: "1rem",
              boxShadow: shadow,
              transition: `left 300ms ${EASE}, top 300ms ${EASE}, width 300ms ${EASE}, height 300ms ${EASE}`,
            }}
          >
            <div
              style={{
                fontWeight: 800,
                fontSize: `${plate.fontSize}px`,
                lineHeight: 1,
                backgroundImage: on ? "none" : gradient,
                WebkitBackgroundClip: on ? "border-box" : "text",
                backgroundClip: on ? "border-box" : "text",
                color: on ? "#fff" : "transparent",
              }}
            >
              {plate.id}
            </div>
            {plate.caption && (
              <div
                style={{
                  fontWeight: 500,
                  fontSize: `${Math.max(20, Math.round(plate.fontSize * 0.26))}px`,
                  lineHeight: 1.2,
                  color: on ? "#fff" : "#006763",
                  whiteSpace: "nowrap",
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

const bannerStyle = (background: string): React.CSSProperties => ({
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "0.5rem",
  flexShrink: 0,
  height: `${BANNER_H}px`,
  borderRadius: "9999px",
  backgroundImage: background,
  color: "#fff",
  boxShadow: BANNER_SHADOW,
  fontSize: "1.875rem",
  fontWeight: 700,
});

export function CallingBanner() {
  return (
    <div style={bannerStyle(GRAD_CALL_BANNER)}>
      <HiBell size={30} />
      お呼び出し中
      <HiBell size={30} />
    </div>
  );
}

export function DripBanner() {
  return (
    <div style={bannerStyle(GRAD_DRIP)}>
      <FaCoffee size={30} />
      ドリップ中
    </div>
  );
}

/**
 * 準備中の番号を並べる帯。呼び出し画面でも PV の上でも同じものを使う。
 */
export function PreparingBar({ orderIds }: { orderIds: number[] }) {
  const shown = orderIds.slice(0, PREP_BAR_CAP);
  const rest = orderIds.length - shown.length;

  return (
    <div
      style={{
        flexShrink: 0,
        height: `${PREP_BAR_H}px`,
        display: "flex",
        alignItems: "center",
        gap: "28px",
        padding: "0 32px",
        boxSizing: "border-box",
        backgroundImage: GRAD_DRIP,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "10px",
          flexShrink: 0,
          color: "#fff",
          fontSize: "1.875rem",
          fontWeight: 700,
          whiteSpace: "nowrap",
        }}
      >
        <LuHourglass size={30} />
        <span>準備中</span>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "12px",
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
        }}
      >
        {shown.map((orderId) => (
          <div
            key={orderId}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              background: CARD_BG,
              border: `1px solid ${CARD_BORDER}`,
              borderRadius: "0.75rem",
              padding: "0.5rem 1rem",
            }}
          >
            <div
              style={{
                fontSize: "3rem",
                fontWeight: 700,
                lineHeight: 1,
                backgroundImage: GRAD_PLATE,
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                color: "transparent",
              }}
            >
              {orderId}
            </div>
          </div>
        ))}
        {rest > 0 && (
          <div
            style={{
              flexShrink: 0,
              color: "#fff",
              fontSize: "1.5rem",
              fontWeight: 700,
              whiteSpace: "nowrap",
            }}
          >
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
 * PV の下側に重ねるドリップ中の帯。
 * 呼び出しが無い間はここだけ出して PV は流し続ける。
 */
export function DripBand({
  plates,
  isFlashing,
  preparingCount,
}: DripBandProps) {
  return (
    <div
      style={{
        position: "absolute",
        bottom: 0,
        left: 0,
        right: 0,
        height: `${DRIP_BAND_H}px`,
        display: "flex",
        flexDirection: "column",
        gap: "12px",
        padding: `20px ${DRIP_BAND_PADDING}px`,
        boxSizing: "border-box",
        backgroundImage: GRAD_DRIP,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "12px",
          flexShrink: 0,
          color: "#fff",
        }}
      >
        <FaCoffee size={30} />
        <span style={{ fontSize: "1.875rem", fontWeight: 700 }}>
          ドリップ中
        </span>
        <span style={{ marginLeft: "auto", fontSize: "1.5rem" }}>
          準備中 {preparingCount}件
        </span>
      </div>
      <PlateBoard
        plates={plates}
        gradient={GRAD_PLATE}
        isFlashing={isFlashing}
        shadow="none"
      />
    </div>
  );
}

export const dripBandLayout = (items: PlateItem[]) =>
  layoutPlates(items, BAND_BOARD_W, DRIP_BAND_BOARD_H, 200);
