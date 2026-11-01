import { apiClient } from "../api/client";
import { openapiEnumLabels } from "../lib/openapi-enum";
import type { components } from "../types/api";

/**
 * ラベル用とレシート用のプリンターの IP アドレス、ラベル用の用紙の種類（ダイカットラベルか、1 枚ごとに切るレシート紙か）と
 * シールの大きさ（長さ・印字幅・余白）と向き（180° 回すか）と一連の印刷の最後の送り方、
 * レシート用のプリンターの用紙（幅と種類）と機種。全レジで共通
 */
export type PrinterSettings = components["schemas"]["PrinterSettingsResponse"];

/** レシート用のプリンターの機種。レシート・領収書の画像の幅が変わる */
export type ReceiptPrinterModel = components["schemas"]["ReceiptPrinterModel"];

/** プリンターに入れる紙の幅。刷るものの幅が変わる */
export type PrinterPaperWidth = components["schemas"]["PrinterPaperWidth"];

/**
 * プリンターに入れる紙の種類（レシート紙・ダイカットラベル）。レシート用は刷るものの幅が変わる。
 * ラベル用は、レシート紙ならシールを 1 枚刷るたびに切る（label/infra/epos.ts の labelPrinterAt）
 */
export type PrinterPaperType = components["schemas"]["PrinterPaperType"];

/** ラベル用のプリンターで、一連の印刷の最後にどう送るか（空のシールを 1 枚送る・剥離位置まで送る） */
export type LabelPrinterTrailingFeed =
  components["schemas"]["LabelPrinterTrailingFeed"];

/** 一度も保存していないときのレシート用のプリンターの機種。サーバーの既定値（models.DefaultReceiptPrinterModel）とそろえる */
export const DEFAULT_RECEIPT_PRINTER_MODEL: ReceiptPrinterModel = "tm_l90";

/**
 * 一度も保存していないときの用紙（幅と種類）。サーバーの既定値（models.DefaultLabelPrinterPaperWidth など）とそろえる
 */
export const DEFAULT_LABEL_PRINTER_PAPER_WIDTH: PrinterPaperWidth = "80mm";
export const DEFAULT_RECEIPT_PRINTER_PAPER_WIDTH: PrinterPaperWidth = "58mm";
export const DEFAULT_LABEL_PRINTER_PAPER_TYPE: PrinterPaperType =
  "die_cut_label";
export const DEFAULT_RECEIPT_PRINTER_PAPER_TYPE: PrinterPaperType = "receipt";

/**
 * 一度も保存していないときのラベル用のシールの大きさ。サーバーの既定値（models.DefaultLabelPrinterLabelLengthMm など）とそろえる
 *
 * 今のラベルロール（台紙 約 57mm、シール 約 53 × 30mm）でテスト印刷して決めた値。
 */
export const DEFAULT_LABEL_PRINTER_LABEL_LENGTH_MM = 29;
export const DEFAULT_LABEL_PRINTER_PRINT_WIDTH_DOTS = 360;
export const DEFAULT_LABEL_PRINTER_MARGIN_MM = 0;

/** 一度も保存していないときに、ラベル用のシールを 180° 回して刷るか。サーバーの既定値（models.DefaultLabelPrinterRotate180）とそろえる */
export const DEFAULT_LABEL_PRINTER_ROTATE_180 = true;

/** 一度も保存していないときの、ラベル用のプリンターの一連の印刷の最後の送り方。サーバーの既定値（models.DefaultLabelPrinterTrailingFeed）とそろえる */
export const DEFAULT_LABEL_PRINTER_TRAILING_FEED: LabelPrinterTrailingFeed =
  "blank_label";

/** ラベル用のシールの大きさの範囲。サーバー（handlers/printer_setting.go）・openapi.yaml とそろえる */
export const LABEL_SIZE_LIMITS = {
  lengthMm: { min: 5, max: 100 },
  printWidthDots: { min: 64, max: 576, step: 8 },
  marginMm: { min: 0, max: 10 },
  /** 余白の内側に、縦にも横にもこれだけ（mm）は残す */
  printableMinMm: 2,
} as const;

/** 1mm のドット数（203dpi） */
export const PRINTER_DOTS_PER_MM = 8;

const inRange = (value: unknown, range: { min: number; max: number }) =>
  typeof value === "number" && value >= range.min && value <= range.max;

/** 受け付けられるシールの長さ（mm）か */
export const isLabelLengthMm = (value: unknown): value is number =>
  inRange(value, LABEL_SIZE_LIMITS.lengthMm);

/** 受け付けられる印字幅（ドット。8 の倍数）か */
export const isLabelPrintWidthDots = (value: unknown): value is number =>
  inRange(value, LABEL_SIZE_LIMITS.printWidthDots) &&
  (value as number) % LABEL_SIZE_LIMITS.printWidthDots.step === 0;

/** 受け付けられる余白（mm）か。長さ・印字幅と合わせて、内側に印字する所が残るかは labelMarginFits で見る */
export const isLabelMarginMm = (value: unknown): value is number =>
  inRange(value, LABEL_SIZE_LIMITS.marginMm);

/** 余白の内側に、縦にも横にも印字する所（LABEL_SIZE_LIMITS.printableMinMm）が残るか */
export const labelMarginFits = (
  lengthMm: number,
  printWidthDots: number,
  marginMm: number,
) =>
  marginMm * 2 <=
  Math.min(lengthMm, printWidthDots / PRINTER_DOTS_PER_MM) -
    LABEL_SIZE_LIMITS.printableMinMm;

const receiptPrinterModelLabels = openapiEnumLabels("ReceiptPrinterModel");
const printerPaperWidthLabels = openapiEnumLabels("PrinterPaperWidth");
const printerPaperTypeLabels = openapiEnumLabels("PrinterPaperType");
const labelPrinterTrailingFeedLabels = openapiEnumLabels(
  "LabelPrinterTrailingFeed",
);

/** 知っているレシート用のプリンターの機種か */
export const isReceiptPrinterModel = (
  value: unknown,
): value is ReceiptPrinterModel =>
  typeof value === "string" && Object.hasOwn(receiptPrinterModelLabels, value);

/** 知っている用紙の幅か */
export const isPrinterPaperWidth = (
  value: unknown,
): value is PrinterPaperWidth =>
  typeof value === "string" && Object.hasOwn(printerPaperWidthLabels, value);

/** 知っている用紙の種類か */
export const isPrinterPaperType = (value: unknown): value is PrinterPaperType =>
  typeof value === "string" && Object.hasOwn(printerPaperTypeLabels, value);

/** 知っている、一連の印刷の最後の送り方か */
export const isLabelPrinterTrailingFeed = (
  value: unknown,
): value is LabelPrinterTrailingFeed =>
  typeof value === "string" &&
  Object.hasOwn(labelPrinterTrailingFeedLabels, value);

/** IP アドレスのほかは、無い・知らない値かもしれない設定（前の API・端末に覚えた設定） */
type LoosePrinterSettings = Pick<
  PrinterSettings,
  "label_printer_ip" | "receipt_printer_ip"
> & {
  receipt_printer_model?: unknown;
  label_printer_paper_width?: unknown;
  receipt_printer_paper_width?: unknown;
  label_printer_paper_type?: unknown;
  receipt_printer_paper_type?: unknown;
  label_printer_label_length_mm?: unknown;
  label_printer_print_width_dots?: unknown;
  label_printer_margin_mm?: unknown;
  label_printer_rotate_180?: unknown;
  label_printer_trailing_feed?: unknown;
};

/** シールの大きさ。無い・知らない値なら既定にする。3 つそろって余白が収まらなければ、3 つとも既定にする */
const labelSizeWithDefaults = (settings: LoosePrinterSettings) => {
  const size = {
    label_printer_label_length_mm: isLabelLengthMm(
      settings.label_printer_label_length_mm,
    )
      ? settings.label_printer_label_length_mm
      : DEFAULT_LABEL_PRINTER_LABEL_LENGTH_MM,
    label_printer_print_width_dots: isLabelPrintWidthDots(
      settings.label_printer_print_width_dots,
    )
      ? settings.label_printer_print_width_dots
      : DEFAULT_LABEL_PRINTER_PRINT_WIDTH_DOTS,
    label_printer_margin_mm: isLabelMarginMm(settings.label_printer_margin_mm)
      ? settings.label_printer_margin_mm
      : DEFAULT_LABEL_PRINTER_MARGIN_MM,
  };
  return labelMarginFits(
    size.label_printer_label_length_mm,
    size.label_printer_print_width_dots,
    size.label_printer_margin_mm,
  )
    ? size
    : {
        label_printer_label_length_mm: DEFAULT_LABEL_PRINTER_LABEL_LENGTH_MM,
        label_printer_print_width_dots: DEFAULT_LABEL_PRINTER_PRINT_WIDTH_DOTS,
        label_printer_margin_mm: DEFAULT_LABEL_PRINTER_MARGIN_MM,
      };
};

/**
 * 機種・用紙の幅・種類・シールの大きさ・向き・最後の送り方が無い・知らない値なら、既定にする
 *
 * レジと API は別々に出すので、機種や用紙・シールの大きさ・向き・最後の送り方を返す前の API に届くことがある。
 * そのときも刷るものの大きさを決められるように。
 */
export const withPrinterSettingDefaults = (
  settings: LoosePrinterSettings,
): PrinterSettings => ({
  label_printer_ip: settings.label_printer_ip,
  receipt_printer_ip: settings.receipt_printer_ip,
  receipt_printer_model: isReceiptPrinterModel(settings.receipt_printer_model)
    ? settings.receipt_printer_model
    : DEFAULT_RECEIPT_PRINTER_MODEL,
  label_printer_paper_width: isPrinterPaperWidth(
    settings.label_printer_paper_width,
  )
    ? settings.label_printer_paper_width
    : DEFAULT_LABEL_PRINTER_PAPER_WIDTH,
  receipt_printer_paper_width: isPrinterPaperWidth(
    settings.receipt_printer_paper_width,
  )
    ? settings.receipt_printer_paper_width
    : DEFAULT_RECEIPT_PRINTER_PAPER_WIDTH,
  label_printer_paper_type: isPrinterPaperType(
    settings.label_printer_paper_type,
  )
    ? settings.label_printer_paper_type
    : DEFAULT_LABEL_PRINTER_PAPER_TYPE,
  receipt_printer_paper_type: isPrinterPaperType(
    settings.receipt_printer_paper_type,
  )
    ? settings.receipt_printer_paper_type
    : DEFAULT_RECEIPT_PRINTER_PAPER_TYPE,
  ...labelSizeWithDefaults(settings),
  label_printer_rotate_180:
    typeof settings.label_printer_rotate_180 === "boolean"
      ? settings.label_printer_rotate_180
      : DEFAULT_LABEL_PRINTER_ROTATE_180,
  label_printer_trailing_feed: isLabelPrinterTrailingFeed(
    settings.label_printer_trailing_feed,
  )
    ? settings.label_printer_trailing_feed
    : DEFAULT_LABEL_PRINTER_TRAILING_FEED,
});

const errorMessage = (error: unknown, fallback: string): string => {
  if (
    typeof error === "object" &&
    error !== null &&
    "error" in error &&
    typeof error.error === "string"
  ) {
    return error.error;
  }
  return fallback;
};

export const printerSettingRepository = {
  /** まだ一度も保存していなければ、サーバーの既定値が返る */
  async get(): Promise<PrinterSettings> {
    const { data, error } = await apiClient.GET("/api/printer-settings");
    if (!data) {
      throw new Error(errorMessage(error, "プリンター設定を取得できません"));
    }
    return withPrinterSettingDefaults(data);
  },
  async save(settings: PrinterSettings): Promise<PrinterSettings> {
    const { data, error } = await apiClient.PUT("/api/printer-settings", {
      body: settings,
    });
    if (!data) {
      throw new Error(errorMessage(error, "プリンター設定を保存できません"));
    }
    return withPrinterSettingDefaults(data);
  },
};
