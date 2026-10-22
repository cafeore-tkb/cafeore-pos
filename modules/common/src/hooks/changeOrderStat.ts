import { apiClient, throwApiError } from "../api/client";
import type { OrderStatType } from "../models/global";
import type { components } from "../types/api";

/**
 * オーダーストップ・再開する。状態を書くのは API だけで、各画面には WebSocket の master_state で届く
 */
export const updateMasterStatus = async (
  type: OrderStatType,
  expected?: components["schemas"]["MasterStateExpected"],
) => {
  const { data, error, response } = await apiClient.POST("/api/master-status", {
    body: {
      type,
      ...(expected ? { expected } : {}),
    },
  });

  if (error || !response.ok) {
    throwApiError(response, error, "受付状態を更新できませんでした");
  }

  return data;
};
