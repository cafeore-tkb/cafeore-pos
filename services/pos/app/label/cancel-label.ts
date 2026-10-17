import type { OrderEntity } from "@cafeore/common";
import type { PrintJob, RasterImage } from "./document";
import {
  type TextStyle,
  createCanvas,
  drawText,
  loadFonts,
  textWidth,
  toRasterImage,
} from "./receipt-canvas";

/**
 * キャンセルした注文のシール（ラベル用のプリンターで刷る）
 *
 * カップのシールを貼ったカップを作らなくてよいと一目で分かるよう、黒地に白抜きで「キャンセル」と番号を刷る。
 * どのカップか探せるよう、番号を大きくする。
 * プリンターの文字では地を塗れない（反転は文字の枠だけ）ので、画面で描いた白黒の画像を刷る。
 * 注文につき 1 枚で、カップのシールを刷らない注文（抽出が要るものが無い）には刷らない。
 */

/** 寸法を決めている座標の幅（80mm のダイカットラベルの印字幅）。刷るときは印字幅に合わせて縮める */
const DESIGN_WIDTH = 560;

/**
 * 寸法を決めている座標の高さ
 *
 * テスト印刷の確認ページ（208 ドット）と同じく、カップのシールの範囲の終わり（234 ドット）より低くする
 * （超えるとシールの切れ目にかかり、次のシールを飛ばして白紙が出る）。
 */
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

/** 印字幅（width ドット）いっぱいを黒く塗り、上に小さく「キャンセル」、下に大きく番号を白で描く */
const drawCancelLabel = async (
  orderId: number,
  width: number,
): Promise<RasterImage> => {
  await loadFonts([`No.${orderId}`, CANCELLED_TEXT]);

  const scale = width / DESIGN_WIDTH;
  const { ctx } = createCanvas(width, Math.round(DESIGN_HEIGHT * scale));
  // 縮める前に塗る（縮めた高さの端数で、下の端に白い線が残らないように）
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.scale(scale, scale);

  drawText(ctx, CANCELLED_TEXT, DESIGN_WIDTH / 2, 36, CANCELLED);
  drawNumber(ctx, orderId);

  return toRasterImage(ctx);
};

/**
 * キャンセルした注文のシール。width は刷るプリンターの印字幅（ドット）
 *
 * シールの先頭から刷る（シールの切れ目にかからないように）。刷らない注文なら null
 */
export const cancelLabelJob = async (
  order: OrderEntity,
  width: number,
): Promise<PrintJob | null> =>
  hasCancelLabel(order)
    ? {
        labels: [
          {
            type: "image",
            image: await drawCancelLabel(order.orderId, width),
            top: true,
          },
        ],
      }
    : null;
