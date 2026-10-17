import { apiClient } from "../api/client";
import type { CaosCupsWrite } from "../lib/caos-board";
import type { CaosOutboxOp } from "../lib/caos-outbox";
import type { components } from "../types/api";

export type CaosLogEntry = components["schemas"]["CaosLogEntry"];

// CaOS（ドリップ管制）の書き込み。盤面は注文のカップの列で持つので、読むのは注文の一覧（共有の WebSocket の orders）。
// 書いた結果は、書いた注文の配信（{"type":"order"}）で全部の画面に届く。
// ルールに合わない（400）・ほかの端末が先に書いた（409）ときは何も変わらず、その理由（error）を返す。画面にそのまま出す。
// status は HTTP のステータス（つながらなければ無い。CaOS の書き込みを送り直すかを決める。lib/caos-outbox.ts）。

type CaosResult<T = unknown> =
  | { data: T; error?: undefined }
  | { error: string; status?: number };

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
      status: response.status,
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

// 押した時刻（pressedAt。エポックのミリ秒）と、送る今（どちらも端末の時計）。サーバーは抽出の開始・終了をこれで付ける
const pressOf = (pressedAt: number) => ({ at: pressedAt, sent_at: Date.now() });

/** カップに CaOS の値を書く（PUT /api/caos/cups）。writes は 1 つのトランザクションで書く。pressedAt は押した時刻 */
export const putCaosCups = async (
  writes: CaosCupsWrite[],
  pressedAt: number,
): Promise<CaosResult> =>
  writes.length === 0
    ? { data: undefined }
    : send(
        apiClient.PUT("/api/caos/cups", {
          body: { writes, press: pressOf(pressedAt) },
        }),
      );

/**
 * 「次へ」（POST /api/caos/drippers/{dripper}/next）。抽出中のカードを終え、待機の先頭を始める（startNext が false なら終えるだけ）。
 * dripId は画面が抽出中と見ているカード（無いと見ているなら null）。今と違えば断られる。
 * startDripId を渡すと、待機の先頭がそのカードのときだけ始める（違えば断られる）。pressedAt は押した時刻
 */
export const nextCaosDripper = async (
  dripper: number,
  dripId: string | null,
  pressedAt: number,
  {
    startNext = true,
    startDripId,
  }: { startNext?: boolean; startDripId?: string } = {},
): Promise<CaosResult> =>
  send(
    apiClient.POST("/api/caos/drippers/{dripper}/next", {
      params: { path: { dripper } },
      body: {
        drip_id: dripId,
        start_next: startNext,
        start_drip_id: startDripId,
        press: pressOf(pressedAt),
      },
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

/** 緊急の入力に出す理由の候補（GET /api/cup-emergencies/reasons）。前の日までも含めた全部の入れ直しの理由を、よく使う順に */
export const getCupEmergencyReasons = async () =>
  send(apiClient.GET("/api/cup-emergencies/reasons"));

/**
 * 緊急（入れ直し）を取り消す（DELETE /api/cup-emergencies/{id}）。まだ抽出を始めていない（未割当か待機の）入れ直しだけ。
 * 入れ直しで減らした在庫も戻る。取り消したことは共有の WebSocket の {"type":"cup_emergency_cancelled"} で全部の画面に届く
 */
export const cancelCupEmergency = async (id: string): Promise<CaosResult> =>
  send(
    apiClient.DELETE("/api/cup-emergencies/{id}", {
      params: { path: { id } },
    }),
  );

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

/**
 * 今の担当者の上級生かだけを直す（POST /api/caos/lanes/seniors。sohosai-shift の名簿を読み直したとき）。
 * サーバーは、担当者の名前が lanes の name のままのドリッパーだけ直し、交代の記録は足さない。同じ値を何度送っても同じ
 */
export const updateCaosLaneSeniors = async (
  lanes: components["schemas"]["CaosLaneSenior"][],
): Promise<CaosResult> =>
  send(apiClient.POST("/api/caos/lanes/seniors", { body: { lanes } }));

/**
 * 端末に残した CaOS の操作を送る（lib/caos-outbox.ts の createCaosOutbox が、サーバーの今の値で作ったものを 1 つずつ）。
 * pressedAt は操作を押した時刻（抽出を始める・終える操作は、サーバーがこの時刻で付ける）
 */
export const sendCaosOutboxRequest = (
  request: CaosOutboxOp,
  pressedAt: number,
): Promise<CaosResult> => {
  switch (request.kind) {
    case "cups":
      return putCaosCups(request.writes, pressedAt);
    case "next":
      return nextCaosDripper(request.dripper, request.dripId, pressedAt, {
        startNext: request.startNext,
        // 押した待機のカードを始めるときは、サーバーでもそれが待機の先頭かを確かめる
        startDripId:
          request.startPressed && request.startId ? request.startId : undefined,
      });
    case "cancel-emergency":
      return cancelCupEmergency(request.id);
    case "lane":
      return putCaosLane(request.dripper, request.name, request.senior);
    case "swap":
      return swapCaosLanes(request.first, request.second);
    case "seniors":
      return updateCaosLaneSeniors(request.lanes);
  }
};
