import useSWR from "swr";
import { apiClient, throwApiError } from "../api/client";
import type { components } from "../types/api";

export type CaosBrewModel = components["schemas"]["CaosBrewModelResponse"];
export type CaosBrewRecord = components["schemas"]["CaosBrewRecordResponse"];

export const useCaosBrewModel = (enabled = true) => {
  const result = useSWR(
    enabled ? "/api/caos/brew-model" : null,
    async () => {
      const { data, error, response } = await apiClient.GET(
        "/api/caos/brew-model",
      );
      if (!response.ok || !data)
        throwApiError(response, error, "抽出予測を取得できませんでした");
      return data;
    },
    { refreshInterval: 15000, dedupingInterval: 2000, keepPreviousData: true },
  );
  return {
    model: enabled ? result.data : undefined,
    error: result.error,
    refresh: result.mutate,
  };
};

export const useCaosBrewRecords = (day: string, offset = 0) =>
  useSWR(
    ["/api/caos/brew-records", day, offset],
    async () => {
      const { data, error, response } = await apiClient.GET(
        "/api/caos/brew-records",
        { params: { query: { day, offset, limit: 100 } } },
      );
      if (!response.ok || !data)
        throwApiError(response, error, "抽出実績を取得できませんでした");
      return data;
    },
    { refreshInterval: 15000 },
  );
