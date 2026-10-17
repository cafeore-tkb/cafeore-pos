import { apiClient } from "../api/client";
import { openapiEnumLabels } from "../lib/openapi-enum";
import type { components } from "../types/api";

/** ラベル用とレシート用のプリンターの IP アドレスと用紙の幅、レシート用のプリンターの機種。全レジで共通 */
export type PrinterSettings = components["schemas"]["PrinterSettingsResponse"];

/** レシート用のプリンターの機種。レシート・領収書の画像の幅が変わる */
export type ReceiptPrinterModel = components["schemas"]["ReceiptPrinterModel"];

/** プリンターに入れる紙の幅。刷るものの幅が変わる */
export type PrinterPaperWidth = components["schemas"]["PrinterPaperWidth"];

/** 一度も保存していないときのレシート用のプリンターの機種。サーバーの既定値（models.DefaultReceiptPrinterModel）とそろえる */
export const DEFAULT_RECEIPT_PRINTER_MODEL: ReceiptPrinterModel = "tm_l90";

/**
 * 一度も保存していないときの用紙の幅。サーバーの既定値（models.DefaultLabelPrinterPaperWidth・
 * models.DefaultReceiptPrinterPaperWidth）とそろえる
 */
export const DEFAULT_LABEL_PRINTER_PAPER_WIDTH: PrinterPaperWidth = "80mm";
export const DEFAULT_RECEIPT_PRINTER_PAPER_WIDTH: PrinterPaperWidth = "58mm";

const receiptPrinterModelLabels = openapiEnumLabels("ReceiptPrinterModel");
const printerPaperWidthLabels = openapiEnumLabels("PrinterPaperWidth");

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

/** IP アドレスのほかは、無い・知らない値かもしれない設定（前の API・端末に覚えた設定） */
type LoosePrinterSettings = Pick<
  PrinterSettings,
  "label_printer_ip" | "receipt_printer_ip"
> & {
  receipt_printer_model?: unknown;
  label_printer_paper_width?: unknown;
  receipt_printer_paper_width?: unknown;
};

/**
 * 機種・用紙の幅が無い・知らない値なら、既定にする
 *
 * レジと API は別々に出すので、機種や用紙の幅を返す前の API に届くことがある。そのときも刷るものの幅を決められるように。
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
