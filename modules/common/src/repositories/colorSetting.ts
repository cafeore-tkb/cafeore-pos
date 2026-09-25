import createClient from "openapi-fetch";
import type { WithId } from "../lib/typeguard";
import type { ColorSetting } from "../models/colorSetting";
import type { components, paths } from "../types/api";
import { API_BASE_URL, throwApiError } from "./item";
import type { ColorSettingRepository } from "./type";

const client = createClient<paths>({ baseUrl: API_BASE_URL });

type ColorSettingResponse = components["schemas"]["ColorSettingResponse"];
type ColorSettingUpsertRequest =
  components["schemas"]["ColorSettingUpsertRequest"];

const responseToColorSetting = (
  response: ColorSettingResponse,
): WithId<ColorSetting> => ({
  id: response.id,
  target_type: response.target_type,
  target_id: response.target_id,
  screen: response.screen,
  color: response.color,
});

const colorSettingToUpsertRequest = (
  setting: ColorSetting,
): ColorSettingUpsertRequest => ({
  target_type: setting.target_type,
  target_id: setting.target_id,
  screen: setting.screen,
  color: setting.color,
});

export const colorSettingRepoFactory = (): ColorSettingRepository => ({
  // 対象と画面の組が既にあれば上書きされる
  save: async (setting) => {
    const { data, error, response } = await client.PUT("/api/color-settings", {
      body: colorSettingToUpsertRequest(setting),
    });
    // 400 のレスポンス型があると error で data が絞り込まれないので、data も見る
    if (error || !response.ok || !data)
      return throwApiError(response, "Failed to save color setting");
    return responseToColorSetting(data);
  },
  delete: async (id) => {
    const { error, response } = await client.DELETE(
      "/api/color-settings/{id}",
      { params: { path: { id } } },
    );
    if (error || !response.ok)
      await throwApiError(response, "Failed to delete color setting");
  },
  findAll: async () => {
    const { data, error, response } = await client.GET("/api/color-settings");
    if (error || !response.ok)
      await throwApiError(response, "Failed to fetch color settings");
    return data.map(responseToColorSetting);
  },
});

export const colorSettingRepository = colorSettingRepoFactory();
