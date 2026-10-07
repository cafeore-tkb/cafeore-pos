import { apiClient, apiErrorDetail, throwApiError } from "../api/client";
import {
  type MasterCall,
  type MasterSnapshot,
  resolveCallBody,
} from "../lib/master-transfer";
import type { components } from "../types/api";

type Schemas = components["schemas"];

const errorMessage = (error: unknown, response: Response) =>
  apiErrorDetail(error) ?? `${response.status} ${response.statusText}`;

/** 一括取り込み・書き出しで使う、今の DB の内容 */
export const fetchMasterSnapshot = async (): Promise<MasterSnapshot> => {
  const [itemTypes, items, menus, colorSettings] = await Promise.all([
    apiClient.GET("/api/item-types"),
    apiClient.GET("/api/items"),
    apiClient.GET("/api/menus"),
    apiClient.GET("/api/color-settings"),
  ]);
  for (const { error, response } of [itemTypes, items, menus, colorSettings]) {
    if (error || !response.ok) {
      throwApiError(response, error, `${response.url} を読めませんでした`);
    }
  }
  return {
    item_types: itemTypes.data ?? [],
    items: items.data ?? [],
    menus: menus.data ?? [],
    color_settings: colorSettings.data ?? [],
  };
};

const send = (call: MasterCall, body: Record<string, unknown>) => {
  // 本文は planMasterImport でスキーマに当ててあるので、ここでは型を合わせるだけ
  switch (call.path) {
    case "/api/item-types":
      return apiClient.POST(call.path, {
        body: body as Schemas["ItemTypeCreateRequest"],
      });
    case "/api/items":
      return apiClient.POST(call.path, {
        body: body as Schemas["ItemCreateRequest"],
      });
    case "/api/menus":
      return apiClient.POST(call.path, {
        body: body as Schemas["MenuCreateRequest"],
      });
    case "/api/color-settings":
      return apiClient.PUT(call.path, {
        body: body as Schemas["ColorSettingUpsertRequest"],
      });
  }
};

export type MasterImportResult = {
  // 送り終えた呼び出しの数（先頭から）
  done: number;
  failed?: { call: MasterCall; message: string };
};

/**
 * 計画した呼び出しを順に送る。既存の API はまとめて取り消せないので、
 * 失敗したらそこで止め、どこまで送ったかを返す。
 */
export const runMasterImport = async (
  calls: MasterCall[],
  onProgress?: (done: number) => void,
): Promise<MasterImportResult> => {
  const ids = new Map<string, string>();
  for (const [index, call] of calls.entries()) {
    try {
      const { data, error, response } = await send(
        call,
        resolveCallBody(call, ids),
      );
      if (error || !response.ok || !data) {
        return {
          done: index,
          failed: { call, message: errorMessage(error, response) },
        };
      }
      if (call.creates) ids.set(call.creates, data.id);
    } catch (e) {
      return {
        done: index,
        failed: {
          call,
          message: e instanceof Error ? e.message : String(e),
        },
      };
    }
    onProgress?.(index + 1);
  }
  return { done: calls.length };
};
