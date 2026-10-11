import useSWR from "swr";
import { apiClient, throwApiError } from "../api/client";
import type { components } from "../types/api";

export type MasterState = {
  createdAt: string;
  type: string;
};

export const responseToMasterState = (
  res: components["schemas"]["MasterStateResponse"],
): MasterState => {
  return {
    createdAt: res.created_at,
    type: res.type,
  };
};

/** オーダーストップ・再開の記録を古い順に取得する */
export const getMasterState = async (): Promise<MasterState[]> => {
  const { data, error, response } = await apiClient.GET("/api/master-status");

  if (error || !response.ok || !data) {
    throwApiError(response, error, "Failed to fetch master states");
  }

  return data.map(responseToMasterState);
};

const MASTER_STATE_KEY = "master-states";

export const useMasterState = () => {
  const {
    data = [],
    error,
    isLoading,
    mutate,
  } = useSWR<MasterState[]>(MASTER_STATE_KEY, getMasterState);

  return {
    masterStates: data,
    isLoading,
    error,
    mutateMasterStates: mutate,
  };
};
