import type {
  PrinterPaperType,
  PrinterPaperWidth,
  PrinterSettings,
  ReceiptPrinterModel,
} from "@cafeore/common";

/** 紙の幅ごとの、印字できる幅（ドット。1 ドットは 1/8mm） */
type PrintableWidths = Record<PrinterPaperWidth, number>;

/**
 * レシート紙（ロール紙・連続ラベル）の印字幅
 *
 * 印字幅より広く刷ると右端が切れる（レシートを 576 ドットで描いて 58mm の紙に刷ったときに切れた）ので、
 * 刷るものは印字幅に収める。
 * 80mm の紙はどの機種も 576 ドット（72mm）。58mm の紙は機種で違い、TM-L90 は 416 ドット（52mm）、
 * TM-m30 は 420 ドット（52.5mm）。
 */
export const RECEIPT_PAPER_WIDTHS = {
  tm_l90: { "58mm": 416, "80mm": 576 },
  tm_m30: { "58mm": 420, "80mm": 576 },
} satisfies Record<ReceiptPrinterModel, PrintableWidths>;

/**
 * ダイカットラベル（台紙に 1 枚ずつ並んだシール）の印字幅。レシート紙より狭い
 *
 * TM-L90 の値。80mm は 560 ドット（70mm。ePOS-Print の TM-L90 の仕様の、ダイカットラベルのページモードの幅）。
 * 58mm は資料で 48mm（台紙の幅 − 10mm）と 50mm（− 8mm）に分かれるので、狭い方の 384 ドットにする。
 * ほかの機種のダイカットラベルの値は確かめていないので、どの機種でもこれを使う。
 */
export const DIE_CUT_LABEL_WIDTHS = {
  "58mm": 384,
  "80mm": 560,
} satisfies PrintableWidths;

/**
 * 紙の種類と機種で決まる、紙の幅ごとの印字幅
 *
 * 機種を選ばないラベル用は model を省く。58mm のレシート紙がどちらの機種でも切れない、狭い方（TM-L90）の値になる。
 */
export const printableWidths = (
  paperType: PrinterPaperType,
  model: ReceiptPrinterModel = "tm_l90",
): PrintableWidths =>
  paperType === "die_cut_label"
    ? DIE_CUT_LABEL_WIDTHS
    : RECEIPT_PAPER_WIDTHS[model];

/** ラベル用のプリンターの印字幅（ドット） */
export const labelPrintableWidth = (settings: PrinterSettings) =>
  printableWidths(settings.label_printer_paper_type)[
    settings.label_printer_paper_width
  ];

/** レシート用のプリンターの印字幅（ドット） */
export const receiptPrintableWidth = (settings: PrinterSettings) =>
  printableWidths(
    settings.receipt_printer_paper_type,
    settings.receipt_printer_model,
  )[settings.receipt_printer_paper_width];
