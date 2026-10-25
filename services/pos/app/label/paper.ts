import {
  PRINTER_DOTS_PER_MM,
  type PrinterPaperType,
  type PrinterPaperWidth,
  type PrinterSettings,
  type ReceiptPrinterModel,
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
 * ダイカットラベル（台紙に 1 枚ずつ並んだシール）の印字幅。レシート紙より狭い（レシート用のプリンターに入れたとき）
 *
 * TM-L90 の値。80mm は 560 ドット（70mm。ePOS-Print の TM-L90 の仕様の、ダイカットラベルのページモードの幅）。
 * 58mm は資料で 48mm（台紙の幅 − 10mm）と 50mm（− 8mm）に分かれるので、狭い方の 384 ドットにする。
 * ほかの機種のダイカットラベルの値は確かめていないので、どの機種でもこれを使う。
 * ラベル用のプリンターは用紙から決めず、管理画面で印字幅をドットで入れる（labelGeometry）。
 */
export const DIE_CUT_LABEL_WIDTHS = {
  "58mm": 384,
  "80mm": 560,
} satisfies PrintableWidths;

/**
 * 紙の種類と機種で決まる、紙の幅ごとの印字幅（レシート用のプリンター）
 *
 * model を省くと、58mm のレシート紙がどちらの機種でも切れない、狭い方（TM-L90）の値になる。
 */
export const printableWidths = (
  paperType: PrinterPaperType,
  model: ReceiptPrinterModel = "tm_l90",
): PrintableWidths =>
  paperType === "die_cut_label"
    ? DIE_CUT_LABEL_WIDTHS
    : RECEIPT_PAPER_WIDTHS[model];

/**
 * ラベル用のプリンターのシールの大きさ（ドット。1 ドットは 1/8mm）
 *
 * - width: 印字幅（8 の倍数）。どのシールもこの幅に収める
 * - height: シール 1 枚の長さ。緊急・キャンセル・テスト印刷のシール（sticker）は width × height の画像に描く
 * - margin: sticker の四辺の余白。中身は余白の内側に描く
 *
 * カップのシール（ページモードの文字）は、範囲の幅を width に縮めるだけで、長さ・余白は使わない。
 */
export type LabelGeometry = {
  width: number;
  height: number;
  margin: number;
};

/** プリンター設定のラベルの長さ・印字幅・余白（withPrinterSettingDefaults で確かめたもの）を、ドットにする */
export const labelGeometry = (
  settings: Pick<
    PrinterSettings,
    | "label_printer_label_length_mm"
    | "label_printer_print_width_dots"
    | "label_printer_margin_mm"
  >,
): LabelGeometry => ({
  width: settings.label_printer_print_width_dots,
  height: Math.round(
    settings.label_printer_label_length_mm * PRINTER_DOTS_PER_MM,
  ),
  margin: Math.round(settings.label_printer_margin_mm * PRINTER_DOTS_PER_MM),
});

/** レシート用のプリンターの印字幅（ドット） */
export const receiptPrintableWidth = (settings: PrinterSettings) =>
  printableWidths(
    settings.receipt_printer_paper_type,
    settings.receipt_printer_model,
  )[settings.receipt_printer_paper_width];
