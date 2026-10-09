import createClient from "openapi-fetch";
import type { paths } from "../types/api";

/** API の接続先。HTTP も WebSocket もここから決める */
export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:8080";

/** API の WebSocket の URL（http → ws、https → wss） */
export const apiWebSocketUrl = (path: string) =>
  `${API_BASE_URL.replace(/^http/, "ws").replace(/\/$/, "")}${path}`;

/** API のクライアント。どのリポジトリもこれを使う */
export const apiClient = createClient<paths>({ baseUrl: API_BASE_URL });

/**
 * API の呼び出しが失敗した理由。取れなければ HTTP のステータス。
 *
 * API は `{"error": "..."}` を返す。openapi-fetch は本文を読んで error に入れる
 * （JSON でなければ文字列のまま）ので、response.json() はもう読めない。
 */
export const apiErrorReason = (response: Response, error: unknown): string => {
  if (typeof error === "string" && error.trim()) return error.trim();
  const detail = (error as { error?: unknown } | null | undefined)?.error;
  if (typeof detail === "string" && detail) return detail;
  return `${response.status} ${response.statusText}`.trim();
};

/**
 * API の呼び出しが失敗したときに、何に失敗したかと理由を付けて投げる。
 *
 * @param response openapi-fetch が返した response
 * @param error openapi-fetch が返した error（エラーの本文）
 * @param message 何に失敗したか
 */
export function throwApiError(
  response: Response,
  error: unknown,
  message: string,
): never {
  throw new Error(`${message}: ${apiErrorReason(response, error)}`);
}
