import createClient from "openapi-fetch";
import type { CaosLanes } from "../lib/caosLanes";
import type { paths } from "../types/api";
import { API_BASE_URL } from "./item";

// CaOS（ドリップ管制）のドリッパーの担当者の書き込み（交代・入れ替え）。
// 変えた結果は全部の画面に共有の WebSocket の {"type":"caos_lanes"} で届く。応答の担当者はその場の反映に使える。

const client = createClient<paths>({ baseUrl: API_BASE_URL });

type CaosLanesResult =
  | { lanes: CaosLanes; error?: undefined }
  | { error: string };

const failed = (status: number, error?: { error?: string }) => ({
  error: error?.error || `担当者を替えられませんでした（${status}）`,
});

/** 交代（PUT /api/caos/lanes/{dripper}）。name が空なら担当者なし。senior は sohosai-shift の名簿で判定した値 */
export const putCaosLane = async (
  dripper: number,
  name: string,
  senior: boolean,
): Promise<CaosLanesResult> => {
  try {
    const { data, error, response } = await client.PUT(
      "/api/caos/lanes/{dripper}",
      { params: { path: { dripper } }, body: { name, senior } },
    );
    return data ? { lanes: data } : failed(response.status, error);
  } catch {
    return { error: "cafeore-pos につながりません" };
  }
};

/** 2 つのドリッパーの担当者を入れ替える（POST /api/caos/lanes/swap） */
export const swapCaosLanes = async (
  first: number,
  second: number,
): Promise<CaosLanesResult> => {
  try {
    const { data, error, response } = await client.POST(
      "/api/caos/lanes/swap",
      { body: { first, second } },
    );
    return data ? { lanes: data } : failed(response.status, error);
  } catch {
    return { error: "cafeore-pos につながりません" };
  }
};
