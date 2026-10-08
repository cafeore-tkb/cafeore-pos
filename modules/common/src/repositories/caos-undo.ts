import createClient from "openapi-fetch";
import type { CaosUndoCupJSON } from "../lib/caos-undo";
import type { paths } from "../types/api";
import { API_BASE_URL } from "./item";

// CaOS の「1つ戻す」（POST /api/caos/undo）。今の値がその操作で書いた値（current）のときだけ、操作の前の値（restore）に書き戻す。
// 書き戻した結果は、書いた注文の配信で全部の画面に届く。

const client = createClient<paths>({ baseUrl: API_BASE_URL });

/**
 * 書き戻せなかったときは理由（error）を返す。retry が true なら、つながらない・サーバーの不具合なので、もう一度押せる。
 * false（ほかの画面が先に変えた・提供済みになった、など）なら、何度押しても戻せない
 */
export type CaosUndoResult =
  | { error?: undefined }
  | { error: string; retry: boolean };

export const undoCaosCups = async (
  cups: CaosUndoCupJSON[],
): Promise<CaosUndoResult> => {
  try {
    const { error, response } = await client.POST("/api/caos/undo", {
      body: { cups },
    });
    if (response.ok) return {};
    return {
      error: error?.error || `戻せませんでした（${response.status}）`,
      retry: response.status >= 500,
    };
  } catch {
    return { error: "cafeore-pos につながりません", retry: true };
  }
};
