import { apiClient } from "../api/client";
import { openapiEnumLabels } from "../lib/openapi-enum";
import type { components } from "../types/api";

/** ラベル用とレシート用のプリンターの IP アドレスと、レシート用のプリンターの機種。全レジで共通 */
export type PrinterSettings = components["schemas"]["PrinterSettingsResponse"];

/** レシート用のプリンターの機種。レシート・領収書の画像の幅が変わる */
export type ReceiptPrinterModel = components["schemas"]["ReceiptPrinterModel"];

/** 一度も保存していないときのレシート用のプリンターの機種。サーバーの既定値（models.DefaultReceiptPrinterModel）とそろえる */
export const DEFAULT_RECEIPT_PRINTER_MODEL: ReceiptPrinterModel = "tm_l90";

const receiptPrinterModelLabels = openapiEnumLabels("ReceiptPrinterModel");

/** 知っているレシート用のプリンターの機種か */
export const isReceiptPrinterModel = (
  value: unknown,
): value is ReceiptPrinterModel =>
  typeof value === "string" && Object.hasOwn(receiptPrinterModelLabels, value);

/**
 * 機種が無い・知らない機種なら、既定の機種にする
 *
 * レジと API は別々に出すので、機種を返す前の API に届くことがある。そのときも画像の幅を決められるように。
 */
export const withReceiptPrinterModel = (
  settings: PrinterSettings,
): PrinterSettings => ({
  ...settings,
  receipt_printer_model: isReceiptPrinterModel(settings.receipt_printer_model)
    ? settings.receipt_printer_model
    : DEFAULT_RECEIPT_PRINTER_MODEL,
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
    return withReceiptPrinterModel(data);
  },
  async save(settings: PrinterSettings): Promise<PrinterSettings> {
    const { data, error } = await apiClient.PUT("/api/printer-settings", {
      body: settings,
    });
    if (!data) {
      throw new Error(errorMessage(error, "プリンター設定を保存できません"));
    }
    return withReceiptPrinterModel(data);
  },
};
