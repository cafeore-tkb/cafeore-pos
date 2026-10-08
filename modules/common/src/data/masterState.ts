import createClient from "openapi-fetch";
// src/data/masterState.ts
import useSWR from "swr";
import { API_BASE_URL } from "../repositories";
import type { components, paths } from "../types/api";

const client = createClient<paths>({ baseUrl: API_BASE_URL });

export type MasterStateResponse = components["schemas"]["MasterStateResponse"];

export type MasterState = {
  createdAt: string;
  type: string;
};

export const responseToMasterState = (
  res: MasterStateResponse,
): MasterState => {
  return {
    createdAt: res.created_at,
    type: res.type,
  };
};

/** オーダーストップ・再開の記録を古い順に取得する */
export const getMasterState = async (): Promise<MasterState[]> => {
  const { data, error, response } = await client.GET("/api/master-status", {});

  if (error || !response.ok || !data) {
    throw new Error("Failed to fetch master states");
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
