import createClient from "openapi-fetch";
import type { CaosCupsWrite } from "../lib/caos-board";
import type { paths } from "../types/api";
import { API_BASE_URL } from "./item";

// CaOS（ドリップ管制）の書き込み。盤面は注文のカップの列で持つので、読むのは注文の一覧（共有の WebSocket の orders）。
// 書いた結果は、書いた注文の配信（{"type":"order"}）で全部の画面に届く。
// ルールに合わない・ほかの端末が先に書いた（409）ときは何も変わらず、その理由（error）を返す。画面にそのまま出す。

const client = createClient<paths>({ baseUrl: API_BASE_URL });

type CaosResult = { error?: undefined } | { error: string };

const failed = (status: number, error?: { error?: string }) => ({
  error:
    error?.error ||
    (status === 409
      ? "ほかの端末で先に変わりました。もう一度操作してください"
      : `操作に失敗しました（${status}）`),
});

/** カップに CaOS の値を書く（PUT /api/caos/cups）。writes は 1 つのトランザクションで書く */
export const putCaosCups = async (
  writes: CaosCupsWrite[],
): Promise<CaosResult> => {
  if (writes.length === 0) return {};
  try {
    const { error, response } = await client.PUT("/api/caos/cups", {
      body: { writes },
    });
    return response.ok ? {} : failed(response.status, error);
  } catch {
    return { error: "cafeore-pos につながりません" };
  }
};

/**
 * 「次へ」（POST /api/caos/drippers/{dripper}/next）。抽出中のカードを終え、そのカップだけを準備完了にし、待機の先頭を始める。
 * dripId は画面が抽出中と見ているカード（無いと見ているなら null）。今と違えば断られる。
 * 通ったら、終えたカードと始めたカード（「1つ戻す」で使う）を返す
 */
export const nextCaosDripper = async (
  dripper: number,
  dripId: string | null,
): Promise<
  CaosResult & { finishedDripId?: string | null; startedDripId?: string | null }
> => {
  try {
    const { data, error, response } = await client.POST(
      "/api/caos/drippers/{dripper}/next",
      { params: { path: { dripper } }, body: { drip_id: dripId } },
    );
    return response.ok
      ? {
          finishedDripId: data?.finished_drip_id ?? null,
          startedDripId: data?.started_drip_id ?? null,
        }
      : failed(response.status, error);
  } catch {
    return { error: "cafeore-pos につながりません" };
  }
};
