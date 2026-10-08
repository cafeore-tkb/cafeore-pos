import createClient from "openapi-fetch";
import type { CaosCupsWrite } from "../lib/caos-board";
import type { paths } from "../types/api";
import { API_BASE_URL } from "./item";

// CaOS（ドリップ管制）の書き込み。盤面は注文のカップの列で持つので、読むのは注文の一覧（共有の WebSocket の orders）。
// 書いた結果は、書いた注文の配信（{"type":"order"}）で全部の画面に届く。
// ルールに合わない・ほかの端末が先に書いた（409）ときは何も変わらず、その理由（error）を返す。画面にそのまま出す。

const client = createClient<paths>({ baseUrl: API_BASE_URL });

type CaosResult = { error?: undefined } | { error: string };

// 送って、断られたら理由を返す（PUT と「次へ」で同じ）
const send = async (
  request: Promise<{ error?: { error?: string }; response: Response }>,
): Promise<CaosResult> => {
  try {
    const { error, response } = await request;
    if (response.ok) return {};
    return {
      error:
        error?.error ||
        (response.status === 409
          ? "ほかの端末で先に変わりました。もう一度操作してください"
          : `操作に失敗しました（${response.status}）`),
    };
  } catch {
    return { error: "cafeore-pos につながりません" };
  }
};

/** カップに CaOS の値を書く（PUT /api/caos/cups）。writes は 1 つのトランザクションで書く */
export const putCaosCups = async (
  writes: CaosCupsWrite[],
): Promise<CaosResult> =>
  writes.length === 0
    ? {}
    : send(client.PUT("/api/caos/cups", { body: { writes } }));

/**
 * 「次へ」（POST /api/caos/drippers/{dripper}/next）。抽出中のカードを終え、そのカップだけを準備完了にし、待機の先頭を始める。
 * dripId は画面が抽出中と見ているカード（無いと見ているなら null）。今と違えば断られる
 */
export const nextCaosDripper = async (
  dripper: number,
  dripId: string | null,
): Promise<CaosResult> =>
  send(
    client.POST("/api/caos/drippers/{dripper}/next", {
      params: { path: { dripper } },
      body: { drip_id: dripId },
    }),
  );
