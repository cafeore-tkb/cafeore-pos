import createClient from "openapi-fetch";
import type { MasterData } from "../lib/master-csv";
import type { components, paths } from "../types/api";
import { API_BASE_URL, throwApiError } from "./item";

const client = createClient<paths>({ baseUrl: API_BASE_URL });

export type MasterImportResult = components["schemas"]["MasterImportResult"];

// 取り込めない行があったときのエラー。problems に行ごとの理由が入る。
export class MasterImportError extends Error {
  constructor(
    message: string,
    readonly problems: string[],
  ) {
    super(message);
  }
}

export const exportMasterData = async (): Promise<MasterData> => {
  const { data, error, response } = await client.GET("/api/master-data");
  if (error || !response.ok || !data) {
    return await throwApiError(response, "Failed to export master data");
  }
  return data;
};

/**
 * アイテムタイプ・アイテム・メニューをまとめて取り込む。
 * dryRun なら検証と件数の集計だけして書き込まない。
 */
export const importMasterData = async (
  body: MasterData,
  { dryRun }: { dryRun: boolean },
): Promise<MasterImportResult> => {
  const { data, error, response } = dryRun
    ? await client.POST("/api/master-data/import/dry-run", { body })
    : await client.POST("/api/master-data/import", { body });
  if (data) return data;
  if (error && "problems" in error) {
    throw new MasterImportError(error.error, error.problems);
  }
  return await throwApiError(response, "Failed to import master data");
};
