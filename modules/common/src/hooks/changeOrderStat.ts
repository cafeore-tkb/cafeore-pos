import { apiClient, throwApiError } from "../api/client";
import type { OrderStatType } from "../models/global";

/**
 * オーダーストップ・再開する。状態を書くのは API だけで、各画面には WebSocket の master_state で届く
 */
export const updateMasterStatus = async (type: OrderStatType) => {
  const { data, error, response } = await apiClient.POST("/api/master-status", {
    body: {
      type,
    },
  });

  if (error || !response.ok) {
    throwApiError(response, error, "Failed to update master status");
  }

  return data;
};
