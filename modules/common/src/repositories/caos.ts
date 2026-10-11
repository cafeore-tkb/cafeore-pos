import { apiClient } from "../api/client";
import type { CaosCupsWrite } from "../lib/caos-board";
import type { components } from "../types/api";

// CaOS（ドリップ管制）の書き込み。盤面は注文のカップの列で持つので、読むのは注文の一覧（共有の WebSocket の orders）。
// 書いた結果は、書いた注文の配信（{"type":"order"}）で全部の画面に届く。
// ルールに合わない（400）・ほかの端末が先に書いた（409）ときは何も変わらず、その理由（error）を返す。画面にそのまま出す。

type CaosResult<T = unknown> =
  | { data: T; error?: undefined }
  | { error: string };

// 送って、通れば応答の中身を、断られたら理由を返す（どの書き込みも同じ）
const send = async <T>(
  request: Promise<{
    data?: T;
    error?: { error?: string };
    response: Response;
  }>,
): Promise<CaosResult<T>> => {
  try {
    const { data, error, response } = await request;
    if (response.ok) return { data: data as T };
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
    ? { data: undefined }
    : send(apiClient.PUT("/api/caos/cups", { body: { writes } }));

/**
 * 「次へ」（POST /api/caos/drippers/{dripper}/next）。抽出中のカードを終え、そのカップだけを準備完了にし、待機の先頭を始める。
 * dripId は画面が抽出中と見ているカード（無いと見ているなら null）。今と違えば断られる
 */
export const nextCaosDripper = async (
  dripper: number,
  dripId: string | null,
): Promise<CaosResult> =>
  send(
    apiClient.POST("/api/caos/drippers/{dripper}/next", {
      params: { path: { dripper } },
      body: { drip_id: dripId },
    }),
  );

/**
 * カップを緊急（入れ直し）にする（POST /api/cup-emergencies）。1 杯につき入れ直しを 1 つ足す（同じカップに何度でも）。
 * reason は入れ直す理由（空なら理由なし）。入れ直しはカップの emergencies に入り、CaOS で未割当の入れ直しのカードになる。
 * data.ids は足した入れ直しの id（cupIds と同じ順）
 */
export const addCupEmergencies = async (cupIds: string[], reason: string) =>
  send(
    apiClient.POST("/api/cup-emergencies", {
      body: { order_cup_ids: cupIds, reason },
    }),
  );

/**
 * 緊急（入れ直し）を取り消す（DELETE /api/cup-emergencies/{id}）。まだ抽出を始めていない（未割当か待機の）入れ直しだけ。
 * 入れ直しで減らした在庫も戻る
 */
export const cancelCupEmergency = async (id: string): Promise<CaosResult> =>
  send(
    apiClient.DELETE("/api/cup-emergencies/{id}", {
      params: { path: { id } },
    }),
  );

/**
 * 「1つ戻す」（POST /api/caos/undo）。カップの今の値が current のときだけ restore に書き戻す（@cafeore/common の caosUndoCups で作る）。
 * ほかの端末があとで変えていたら断られる
 */
export const undoCaosCups = async (
  cups: components["schemas"]["CaosUndoCup"][],
): Promise<CaosResult> =>
  send(apiClient.POST("/api/caos/undo", { body: { cups } }));

/**
 * ドリッパーの担当者の交代（PUT /api/caos/lanes/{dripper}）。name が空なら担当者なし。senior は sohosai-shift の名簿で判定した値。
 * 変えた結果は全部の画面に共有の WebSocket の {"type":"caos_lanes"} で届く
 */
export const putCaosLane = async (
  dripper: number,
  name: string,
  senior: boolean,
): Promise<CaosResult> =>
  send(
    apiClient.PUT("/api/caos/lanes/{dripper}", {
      params: { path: { dripper } },
      body: { name, senior },
    }),
  );

/** 2 つのドリッパーの担当者を入れ替える（POST /api/caos/lanes/swap） */
export const swapCaosLanes = async (
  first: number,
  second: number,
): Promise<CaosResult> =>
  send(apiClient.POST("/api/caos/lanes/swap", { body: { first, second } }));
