import createClient from "openapi-fetch";
import type { components, paths } from "../types/api";
import { API_BASE_URL } from "./item";

/** CaOS（ドリップ管制）の抽出カード。WebSocket の {"type":"drips"} で今日の分が全部届く */
export type CaosDrip = components["schemas"]["CaosDrip"];
/**
 * 列（ドリッパー 1〜6）の担当者。WebSocket の {"type":"drips"} で 6 列が全部届く（担当者がいない列は name が空）。
 * senior は交代したときに CaOS の画面が sohosai-shift の名簿で判定したもの
 */
export type CaosLane = components["schemas"]["CaosLane"];
/** 盤面への操作（割当・戻す・次へ・統合・入れ直し・列の担当者の交代と入れ替え・1つ戻す） */
export type CaosOp = components["schemas"]["CaosOp"];
export type CaosOpResult = components["schemas"]["CaosOpResult"];

const client = createClient<paths>({ baseUrl: API_BASE_URL });

/**
 * 盤面への操作を送る（POST /api/caos/ops）。結果のカードは WebSocket の drips で全部の画面に届く。
 * ルールに合わない操作は 422 で何も変えずに断られるので、その理由（error）を返す。画面にそのまま出す。
 */
export const postCaosOp = async (
  op: CaosOp,
): Promise<
  | { result: CaosOpResult; error?: undefined }
  | { result?: undefined; error: string }
> => {
  try {
    const { data, error, response } = await client.POST("/api/caos/ops", {
      body: op,
    });
    if (data) return { result: data };
    return {
      error: error?.error || `操作に失敗しました（${response.status}）`,
    };
  } catch {
    return { error: "cafeore-pos につながりません" };
  }
};
