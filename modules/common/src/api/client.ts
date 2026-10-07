import createClient from "openapi-fetch";
import type { paths } from "../types/api";

/** API の接続先。HTTP も WebSocket もここから決める */
export const API_BASE_URL: string =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:8080";

/** API の WebSocket の URL（http → ws、https → wss） */
export const apiWebSocketUrl = (path: string) =>
  `${API_BASE_URL.replace(/^http/, "ws").replace(/\/$/, "")}${path}`;

/**
 * API のクライアント。どのリポジトリもこれを使う。
 *
 * fetch は呼ぶたびに globalThis から読む。openapi-fetch は作ったときの fetch を
 * 掴むので、テストで fetch を差し替えても、先に作られたクライアントには届かないため
 */
export const apiClient = createClient<paths>({
  baseUrl: API_BASE_URL,
  fetch: (request) => globalThis.fetch(request),
});

/** API がエラーを返したときに投げる。status は HTTP のステータス */
export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/**
 * エラーの本文から、API が書いた理由を取り出す。
 *
 * API は `{"error": "..."}` を返す。openapi-fetch は本文を読んで error に入れる
 * （JSON でなければ文字列のまま）ので、response.json() はもう読めない。
 */
export const apiErrorDetail = (error: unknown): string | undefined => {
  if (typeof error === "string") return error.trim() || undefined;
  if (error && typeof error === "object" && "error" in error) {
    const detail = (error as { error: unknown }).error;
    if (typeof detail === "string" && detail) return detail;
  }
  return undefined;
};

/**
 * API の呼び出しが失敗したときに投げる。理由が取れればメッセージの後ろに付ける。
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
  const detail =
    apiErrorDetail(error) ?? `${response.status} ${response.statusText}`.trim();
  throw new ApiError(`${message}: ${detail}`, response.status);
}
