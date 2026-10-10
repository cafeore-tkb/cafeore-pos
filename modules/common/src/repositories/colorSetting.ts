import { apiClient, throwApiError } from "../api/client";
import type { ColorSettingRepository } from "./type";

export const colorSettingRepoFactory = (): ColorSettingRepository => ({
  // 対象と画面の組が既にあれば上書きされる
  save: async ({ target_type, target_id, screen, color }) => {
    const { data, error, response } = await apiClient.PUT(
      "/api/color-settings",
      {
        body: { target_type, target_id, screen, color },
      },
    );
    // 400 のレスポンス型があると error で data が絞り込まれないので、data も見る
    if (error || !response.ok || !data)
      throwApiError(response, error, "Failed to save color setting");
    return data;
  },
  delete: async (id) => {
    const { error, response } = await apiClient.DELETE(
      "/api/color-settings/{id}",
      { params: { path: { id } } },
    );
    if (error || !response.ok)
      throwApiError(response, error, "Failed to delete color setting");
  },
  findAll: async () => {
    const { data, error, response } = await apiClient.GET(
      "/api/color-settings",
    );
    if (error || !response.ok)
      throwApiError(response, error, "Failed to fetch color settings");
    // レスポンスはモデルと同じ形なので、そのまま返す
    return data;
  },
});

export const colorSettingRepository = colorSettingRepoFactory();
