import { apiClient } from "../api/client";
import type { components } from "../types/api";

/** ラベル用とレシート用のプリンターの IP アドレス。全レジで共通 */
export type PrinterSettings = components["schemas"]["PrinterSettingsResponse"];

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
    return data;
  },
  async save(settings: PrinterSettings): Promise<PrinterSettings> {
    const { data, error } = await apiClient.PUT("/api/printer-settings", {
      body: settings,
    });
    if (!data) {
      throw new Error(errorMessage(error, "プリンター設定を保存できません"));
    }
    return data;
  },
};
