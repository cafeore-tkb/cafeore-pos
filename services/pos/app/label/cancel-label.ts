import type { OrderEntity } from "@cafeore/common";
import type { PrintJob, RasterImage } from "./document";
import {
  type TextStyle,
  createCanvas,
  drawText,
  loadFonts,
  toRasterImage,
} from "./receipt-canvas";

/**
 * キャンセルした注文のシール（ラベル用のプリンターで刷る）
 *
 * カップのシールを貼ったカップを作らなくてよいと一目で分かるよう、黒地に白抜きで番号と「キャンセル」を刷る。
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

const NUMBER: TextStyle = {
  size: 64,
  weight: 900,
  align: "center",
  color: "#fff",
};
const CANCELLED: TextStyle = {
  size: 84,
  weight: 900,
  align: "center",
  color: "#fff",
};

/** キャンセルのシールを刷る注文か（カップのシールを刷った注文。order-label の orderLabelJob が空でない） */
export const hasCancelLabel = (order: OrderEntity) =>
  order.getCoffeeCups().length > 0;

/** 印字幅（width ドット）いっぱいを黒く塗り、番号と「キャンセル」を白で描く */
const drawCancelLabel = async (
  orderId: number,
  width: number,
): Promise<RasterImage> => {
  const number = `No.${orderId}`;
  await loadFonts([number, CANCELLED_TEXT]);

  const scale = width / DESIGN_WIDTH;
  const { ctx } = createCanvas(width, Math.round(DESIGN_HEIGHT * scale));
  // 縮める前に塗る（縮めた高さの端数で、下の端に白い線が残らないように）
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.scale(scale, scale);

  drawText(ctx, number, DESIGN_WIDTH / 2, 60, NUMBER);
  drawText(ctx, CANCELLED_TEXT, DESIGN_WIDTH / 2, 148, CANCELLED);

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
