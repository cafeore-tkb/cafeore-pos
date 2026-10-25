import { type StickerLabel, packImage } from "./document";
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

/** 描いたシールを白黒にして詰める */
export const toStickerLabel = (
  ctx: CanvasRenderingContext2D,
): StickerLabel => ({
  type: "sticker",
  image: packImage(toRasterImage(ctx)),
});

const EMERGENCY_TEXT = "緊急";

/** 大きさは余白の内側に合わせて変える（size は倍率を掛ける前の大きさ） */
const EMERGENCY: TextStyle = { size: 100, weight: 900, align: "center" };

/** 余白の内側のうち、「緊急」で埋める割合（縦・横とも） */
const EMERGENCY_FILL = 0.85;

/** 余白の内側の真ん中に、収まるいちばん大きな「緊急」を描く */
const drawEmergencySticker = async (geometry: LabelGeometry) => {
  await loadFonts([EMERGENCY_TEXT]);
  const { ctx, inner } = createStickerCanvas(geometry);
  const scale = Math.min(
    (inner.width * EMERGENCY_FILL) / textWidth(ctx, EMERGENCY_TEXT, EMERGENCY),
    (inner.height * EMERGENCY_FILL) / EMERGENCY.size,
  );
  ctx.translate(inner.width / 2, inner.height / 2);
  ctx.scale(scale, scale);
  drawText(ctx, EMERGENCY_TEXT, 0, 0, EMERGENCY);
  return toStickerLabel(ctx);
};

// 中身はいつも同じなので、シールの大きさごとに 1 回だけ描く（同時に頼まれても、頼まれた順に返る）
const emergencyStickers = new Map<string, Promise<StickerLabel>>();

/**
 * 緊急のシール（「緊急」とだけ大きく書いた 1 枚）。緊急で淹れ直したカップのシールの前に刷る
 *
 * カップのシールはレジで刷るものと同じなので、続けて刷るこれで、淹れ直しのシールだと分かるようにする。
 * 描けなかったら（canvas が使えないなど）reject し、次はもう一度描く。
 */
export const emergencySticker = (
  geometry: LabelGeometry,
): Promise<StickerLabel> => {
  const key = `${geometry.width}x${geometry.height}+${geometry.margin}`;
  const cached = emergencyStickers.get(key);
  if (cached) return cached;
  const drawing = drawEmergencySticker(geometry);
  emergencyStickers.set(key, drawing);
  drawing.catch(() => emergencyStickers.delete(key));
  return drawing;
};
