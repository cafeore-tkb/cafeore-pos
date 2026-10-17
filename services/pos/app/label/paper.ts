import type { PrinterPaperWidth, ReceiptPrinterModel } from "@cafeore/common";

/**
 * 紙の幅ごとの、印字できる幅（ドット。1 ドットは 1/8mm）
 *
 * 印字幅より広く刷ると右端が切れる（レシートを 576 ドットで描いて 58mm の紙に刷ったときに切れた）ので、
 * 刷るものは印字幅に収める。
 * 80mm の紙はどの機種も 576 ドット（72mm）。58mm の紙は機種で違い、TM-L90 は 416 ドット（52mm）、
 * TM-m30 は 420 ドット（52.5mm）。
 */
export const RECEIPT_WIDTHS = {
  tm_l90: { "58mm": 416, "80mm": 576 },
  tm_m30: { "58mm": 420, "80mm": 576 },
} satisfies Record<ReceiptPrinterModel, Record<PrinterPaperWidth, number>>;

/**
 * ラベル用のプリンターの印字幅（ドット）
 *
 * ラベル用は機種を選ばないので、どちらの機種でも切れない狭い方（58mm は TM-L90 の 416 ドット）にする。
 */
export const LABEL_WIDTHS = {
  "58mm": 416,
  "80mm": 576,
} satisfies Record<PrinterPaperWidth, number>;
