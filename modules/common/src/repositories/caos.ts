import createClient from "openapi-fetch";
import type { components, paths } from "../types/api";
import { API_BASE_URL } from "./item";

/**
 * CaOS（ドリップ管制）の盤面のカード。WebSocket の {"type":"drips"} で今日の分が全部届く。
 * 中身はカップの ID だけで、商品・注文番号・指名は注文（orders）のカップから引く。
 * 未割当のカードは保存されていない（id が null。cups の ID の組で指す）
 */
export type CaosCard = components["schemas"]["CaosCard"];
/** カードの指し方（配られたカードの id と cups の ID をそのまま送る） */
export type CaosCardRef = components["schemas"]["CaosCardRef"];
/** 盤面への操作（割当・未割当に戻す・次へ・統合・緊急・1つ戻す） */
export type CaosOp = components["schemas"]["CaosOp"];
export type CaosOpResult = components["schemas"]["CaosOpResult"];

/** カードを操作で指す形にする */
export const caosCardRef = (card: CaosCard): CaosCardRef => ({
  id: card.id,
  cup_ids: card.cups.map((cup) => cup.id),
});

const client = createClient<paths>({ baseUrl: API_BASE_URL });

/**
 * 盤面への操作を送る（POST /api/caos/ops）。結果の盤面は WebSocket の drips で全部の画面に届く。
 * ルールに合わない操作は何も変えずに断られるので、その理由（error）を返す。画面にそのまま出す。
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
