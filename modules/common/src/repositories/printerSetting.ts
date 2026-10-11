import createClient from "openapi-fetch";
import type { components, paths } from "../types/api";
import { API_BASE_URL } from "./item";

const client = createClient<paths>({ baseUrl: API_BASE_URL });

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
    const { data, error } = await client.GET("/api/printer-settings");
    if (!data) {
      throw new Error(errorMessage(error, "プリンター設定を取得できません"));
    }
    return data;
  },
  async save(settings: PrinterSettings): Promise<PrinterSettings> {
    const { data, error } = await client.PUT("/api/printer-settings", {
      body: settings,
    });
    if (!data) {
      throw new Error(errorMessage(error, "プリンター設定を保存できません"));
    }
    return data;
  },
};
