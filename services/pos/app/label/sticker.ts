import { type StickerLabel, packImage, rotateImage180 } from "./document";
import type { LabelGeometry } from "./paper";
import {
  type TextStyle,
  createCanvas,
  drawText,
  loadFonts,
  textWidth,
  toRasterImage,
} from "./receipt-canvas";

/**
 * ダイカットラベル 1 枚分の画像のシール（緊急・キャンセル・テスト印刷）を描く
 *
 * ラベル用のシールの大きさ（印字幅 × 長さ。paper.ts の labelGeometry）の白黒の画像に描き、
 * プリンターはシールの先頭へ送ってから左端から刷る（infra/epos.ts）。中身は四辺の余白の内側に描く。
 * 180° 回して刷るときは、描いた画像を回す（シールと同じ大きさなので、シールの真ん中を中心に回る）。
 * カップのシールは、プリンターの文字（ページモード）のまま刷る（order-label.ts）。
 */

/** 余白の内側（中身を描く所）の大きさ */
export const stickerInner = ({ width, height, margin }: LabelGeometry) => ({
  width: width - margin * 2,
  height: height - margin * 2,
});

/** シールの大きさの白い canvas。ctx は余白の内側の左上を (0, 0) にずらしてある */
export const createStickerCanvas = (geometry: LabelGeometry) => {
  const { ctx } = createCanvas(geometry.width, geometry.height);
  ctx.translate(geometry.margin, geometry.margin);
  return { ctx, inner: stickerInner(geometry) };
};

/**
 * 描いたシールを白黒にして詰める。rotate180 なら 180° 回す
 * （詰めるときに下の白い行を落とすので、回してから詰める）
 */
export const toStickerLabel = (
  ctx: CanvasRenderingContext2D,
  rotate180: boolean,
): StickerLabel => {
  const image = toRasterImage(ctx);
  return {
    type: "sticker",
    image: packImage(rotate180 ? rotateImage180(image) : image),
  };
};

const EMERGENCY_TEXT = "緊急";

/**
 * 緊急のシールの帯に書く文字と、帯を置く側。帯は台紙の上で挟んだカップのシールの側に置き、両脇の三角でそちらを指す。
 * 「ここから」は紙の送りで後ろ（後に刷るカップのシールの側）、「ここまで」は前（先に刷ったカップのシールの側）
 */
const MARKERS = {
  start: { text: "ここから", band: "trailing" },
  end: { text: "ここまで", band: "leading" },
} as const;

type Marker = keyof typeof MARKERS;

/** 大きさは置く所に合わせて変える（size は倍率を掛ける前の大きさ） */
const EMERGENCY: TextStyle = {
  size: 100,
  weight: 900,
  align: "center",
  color: "#fff",
};
const MARKER: TextStyle = { size: 100, weight: 900, align: "center" };

/** 帯の三角の幅・高さと、三角と文字の間（帯の文字の大きさに対する割合） */
const TRIANGLE = { width: 0.7, height: 0.6, gap: 0.9 };

/** 余白の内側の高さのうち、帯の高さの割合 */
const BAND_RATIO = 0.25;

/** 置く所のうち、「緊急」・帯の中身で埋める割合 */
const EMERGENCY_FILL = 0.85;
const MARKER_FILL = { width: 0.8, height: 0.6 };

type Area = { top: number; width: number; height: number };

/** 黒く塗った所の真ん中に、縦横とも EMERGENCY_FILL に収まるいちばん大きな「緊急」を白で描く */
const drawEmergencyText = (ctx: CanvasRenderingContext2D, area: Area) => {
  const scale = Math.min(
    (area.width * EMERGENCY_FILL) / textWidth(ctx, EMERGENCY_TEXT, EMERGENCY),
    (area.height * EMERGENCY_FILL) / EMERGENCY.size,
  );
  ctx.save();
  ctx.translate(area.width / 2, area.top + area.height / 2);
  ctx.scale(scale, scale);
  drawText(ctx, EMERGENCY_TEXT, 0, 0, EMERGENCY);
  ctx.restore();
};

/** 白い帯の真ん中に、両脇に三角を付けた text を黒で描く。三角は onTop なら上、そうでなければ下を指す（帯の側） */
const drawBand = (
  ctx: CanvasRenderingContext2D,
  text: string,
  onTop: boolean,
  area: Area,
) => {
  const textW = textWidth(ctx, text, MARKER);
  const triangleW = MARKER.size * TRIANGLE.width;
  const triangleH = MARKER.size * TRIANGLE.height;
  const gap = MARKER.size * TRIANGLE.gap;
  const scale = Math.min(
    (area.width * MARKER_FILL.width) / (textW + (gap + triangleW) * 2),
    (area.height * MARKER_FILL.height) / MARKER.size,
  );
  ctx.save();
  ctx.translate(area.width / 2, area.top + area.height / 2);
  ctx.scale(scale, scale);
  drawText(ctx, text, 0, 0, MARKER);
  // 下向きなら先が下（drawText のあとも塗りは黒のまま）
  const tip = onTop ? -triangleH / 2 : triangleH / 2;
  for (const side of [-1, 1]) {
    const center = side * (textW / 2 + gap + triangleW / 2);
    ctx.beginPath();
    ctx.moveTo(center - triangleW / 2, -tip);
    ctx.lineTo(center + triangleW / 2, -tip);
    ctx.lineTo(center, tip);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
};

/**
 * 緊急のシール 1 枚：余白の内側を、白い帯と、黒地に白抜きで大きく「緊急」を描いた所に分ける。
 *
 * 帯は台紙の上で挟んだカップのシールの側に置く。回さなければ紙の送りの前が上なので、「ここから」は下で ▼、「ここまで」は上で ▲。
 * 180° 回すなら、描いたあと画像ごと回る（読む向きでは紙の送りの後ろが上になる）ので、上下を入れ替えて
 * 「ここから」は上で ▲、「ここまで」は下で ▼ に描く。どちらでも、三角は挟んだカップのシールを指す
 */
const drawEmergencySticker = (geometry: LabelGeometry, marker: Marker) => {
  const { ctx, inner } = createStickerCanvas(geometry);
  const { text, band } = MARKERS[marker];
  const bandHeight = Math.round(inner.height * BAND_RATIO);
  const bandOnTop = (band === "leading") !== geometry.rotate180;
  const body = {
    top: bandOnTop ? bandHeight : 0,
    width: inner.width,
    height: inner.height - bandHeight,
  };
  ctx.fillStyle = "#000";
  ctx.fillRect(0, body.top, body.width, body.height);
  drawEmergencyText(ctx, body);
  drawBand(ctx, text, bandOnTop, {
    top: bandOnTop ? 0 : body.height,
    width: inner.width,
    height: bandHeight,
  });
  return toStickerLabel(ctx, geometry.rotate180);
};

/** 一度に淹れ直したカップのシールを挟む緊急のシール。start（ここから）を前に、end（ここまで）を後ろに刷る */
export type EmergencyStickers = { start: StickerLabel; end: StickerLabel };

const drawEmergencyStickers = async (
  geometry: LabelGeometry,
): Promise<EmergencyStickers> => {
  await loadFonts([EMERGENCY_TEXT, MARKERS.start.text, MARKERS.end.text]);
  return {
    start: drawEmergencySticker(geometry, "start"),
    end: drawEmergencySticker(geometry, "end"),
  };
};

// 中身はいつも同じなので、シールの大きさと向きごとに 1 回だけ描く（同時に頼まれても、頼まれた順に返る）
const emergencyStickerCache = new Map<string, Promise<EmergencyStickers>>();

/**
 * 緊急のシール（「ここから」と「ここまで」）。緊急で淹れ直したカップのシールを、一度に足した分まとめて挟む（order-label.ts の emergencyLabelJobs）
 *
 * カップのシールはレジで刷るものと同じなので、挟むことで、淹れ直しのシールだと分かるようにする。
 * 描けなかったら（canvas が使えないなど）reject し、次はもう一度描く。
 */
export const emergencyStickers = (
  geometry: LabelGeometry,
): Promise<EmergencyStickers> => {
  const key = `${geometry.width}x${geometry.height}+${geometry.margin}${geometry.rotate180 ? "@180" : ""}`;
  const cached = emergencyStickerCache.get(key);
  if (cached) return cached;
  const drawing = drawEmergencyStickers(geometry);
  emergencyStickerCache.set(key, drawing);
  drawing.catch(() => emergencyStickerCache.delete(key));
  return drawing;
};
