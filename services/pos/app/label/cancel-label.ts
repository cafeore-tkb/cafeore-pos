import type { OrderEntity } from "@cafeore/common";
import type { PrintJob } from "./document";
import type { LabelGeometry } from "./paper";
import {
  type TextStyle,
  drawText,
  loadFonts,
  textWidth,
} from "./receipt-canvas";
import { createStickerCanvas, toStickerLabel } from "./sticker";

/**
 * キャンセルした注文のシール（ラベル用のプリンターで刷る）
 *
 * カップのシールを貼ったカップを作らなくてよいと一目で分かるよう、黒地に白抜きで「キャンセル」と番号を刷る。
 * どのカップか探せるよう、番号を大きくする。
 * プリンターの文字では地を塗れない（反転は文字の枠だけ）ので、画面で描いた白黒の画像を刷る（sticker.ts）。
 * 注文につき 1 枚で、カップのシールを刷らない注文（抽出が要るものが無い）には刷らない。
 */

/** 寸法を決めている座標の幅と高さ。刷るときは、シールの余白の内側に収まるよう縮めて真ん中に置く */
const DESIGN_WIDTH = 560;
const DESIGN_HEIGHT = 208;

const CANCELLED_TEXT = "キャンセル";

const CANCELLED: TextStyle = {
  size: 40,
  weight: 900,
  align: "center",
  color: "#fff",
};
const NUMBER_PREFIX: TextStyle = {
  size: 56,
  weight: 900,
  baseline: "alphabetic",
  color: "#fff",
};
const NUMBER: TextStyle = {
  size: 168,
  weight: 900,
  baseline: "alphabetic",
  color: "#fff",
};

/** 番号の行の基準線（数字の下端） */
const NUMBER_BASELINE = 192;

/** 番号の行の左右の余白 */
const PADDING_X = 24;

/** キャンセルのシールを刷る注文か（カップのシールを刷った注文。order-label の orderLabelJob が空でない） */
export const hasCancelLabel = (order: OrderEntity) =>
  order.getCoffeeCups().length > 0;

/** 小さい「No.」と大きい番号を、下端をそろえて中央に並べる。桁が多くて入らなければ行ごと縮める */
const drawNumber = (ctx: CanvasRenderingContext2D, orderId: number) => {
  const parts = [
    ["No.", NUMBER_PREFIX],
    [`${orderId}`, NUMBER],
  ] as const;
  const widths = parts.map(([text, style]) => textWidth(ctx, text, style));
  const total = widths.reduce((sum, w) => sum + w, 0);
  const fit = Math.min(1, (DESIGN_WIDTH - PADDING_X * 2) / total);
  ctx.save();
  ctx.translate(DESIGN_WIDTH / 2, NUMBER_BASELINE);
  ctx.scale(fit, fit);
  let x = -total / 2;
  parts.forEach(([text, style], i) => {
    drawText(ctx, text, x, 0, style);
    x += widths[i];
  });
  ctx.restore();
};

/** 余白の内側いっぱいを黒く塗り、上に小さく「キャンセル」、下に大きく番号を白で描く */
const drawCancelLabel = async (orderId: number, geometry: LabelGeometry) => {
  await loadFonts([`No.${orderId}`, CANCELLED_TEXT]);

  const { ctx, inner } = createStickerCanvas(geometry);
  // 縮める前に塗る（縮めた端数で、端に白い線が残らないように）
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, inner.width, inner.height);
  const scale = Math.min(
    inner.width / DESIGN_WIDTH,
    inner.height / DESIGN_HEIGHT,
  );
  ctx.translate(
    (inner.width - DESIGN_WIDTH * scale) / 2,
    (inner.height - DESIGN_HEIGHT * scale) / 2,
  );
  ctx.scale(scale, scale);

  drawText(ctx, CANCELLED_TEXT, DESIGN_WIDTH / 2, 36, CANCELLED);
  drawNumber(ctx, orderId);

  return toStickerLabel(ctx);
};

/**
 * キャンセルした注文のシール。geometry はラベル用のシールの大きさ（paper.ts の labelGeometry）
 *
 * シール 1 枚分の画像で、シールの先頭から刷る。刷らない注文なら null
 */
export const cancelLabelJob = async (
  order: OrderEntity,
  geometry: LabelGeometry,
): Promise<PrintJob | null> =>
  hasCancelLabel(order)
    ? { labels: [await drawCancelLabel(order.orderId, geometry)] }
    : null;
