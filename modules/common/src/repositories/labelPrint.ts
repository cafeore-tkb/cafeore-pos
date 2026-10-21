import { apiClient } from "../api/client";
import type { components } from "../types/api";

// 代理印刷。端末（CaOS・マスターの緊急）がラベル用のプリンターに直接刷れなかったシールを、代理印刷をオンにしたレジに刷ってもらう。
// 頼み（POST /api/label-print-requests）はサーバーが持ち、共有の WebSocket で配る。レジは引き受けてから刷り（2 台で刷らないように）、刷れたら知らせる。
// どれも例外は投げず、つながらない・断られたら失敗を返す（呼ぶ側は間をあけて送り直す）。

/** まだ刷れていない代理印刷の頼み。job はシールの印刷データ（POS の PrintJob。サーバーは解釈しない） */
export type LabelPrintRequest =
  components["schemas"]["LabelPrintRequestResponse"];

/** 代理印刷を引き受けた結果。missing は頼みが無い（緊急を取り消した）、error はつながらない・断られた */
export type LabelPrintClaim =
  | { status: "claimed"; job: LabelPrintRequest["job"] }
  | { status: "busy" | "printed" | "missing" | "error" };

// 送って、通れば true
const ok = async (request: Promise<{ response: Response }>) => {
  try {
    return (await request).response.ok;
  } catch {
    return false;
  }
};

/**
 * 緊急（淹れ直し）のシールをレジに代わりに刷ってもらう（POST /api/label-print-requests）。id は淹れ直しの id。
 * 同じ id を送り直しても 1 つだけ（2 枚刷らない）。受け取ってもらえたら true（刷れたかではない）。
 * 淹れ直しが無い（取り消した）・つながらないときは false（頼む端末は未印刷に残す。取り消しの知らせで消える）
 */
export const requestLabelPrint = (
  id: string,
  job: { labels: readonly Record<string, unknown>[] },
) =>
  ok(
    apiClient.POST("/api/label-print-requests", {
      body: { id, job: { labels: [...job.labels] } },
    }),
  );

/** 今日のまだ刷れていない代理印刷（GET /api/label-print-requests。古い順）。読めなければ null */
export const getLabelPrintRequests = async (): Promise<
  LabelPrintRequest[] | null
> => {
  try {
    const { data, response } = await apiClient.GET("/api/label-print-requests");
    return response.ok && data ? data : null;
  } catch {
    return null;
  }
};

/** 代理印刷を引き受ける（POST /api/label-print-requests/{id}/claim）。deviceId は刷るレジ（ページを開くたびに作る id） */
export const claimLabelPrint = async (
  id: string,
  deviceId: string,
): Promise<LabelPrintClaim> => {
  try {
    const { data, response } = await apiClient.POST(
      "/api/label-print-requests/{id}/claim",
      { params: { path: { id } }, body: { device_id: deviceId } },
    );
    if (response.status === 404) return { status: "missing" };
    if (!response.ok || !data) return { status: "error" };
    if (data.status === "claimed")
      return data.job
        ? { status: "claimed", job: data.job }
        : { status: "error" };
    return { status: data.status };
  } catch {
    return { status: "error" };
  }
};

/**
 * 引き受けた代理印刷を刷れた（POST /api/label-print-requests/{id}/printed）。
 * 知らせられたら true（頼みが無い（緊急を取り消した）ときも、もう知らせることは無いので true）
 */
export const markLabelPrinted = async (id: string, deviceId: string) => {
  try {
    const { response } = await apiClient.POST(
      "/api/label-print-requests/{id}/printed",
      { params: { path: { id } }, body: { device_id: deviceId } },
    );
    return response.ok || response.status === 404;
  } catch {
    return false;
  }
};

/** 引き受けた代理印刷を刷れなかった（POST /api/label-print-requests/{id}/release）。ほかのレジが引き受けられるようになる */
export const releaseLabelPrint = (id: string, deviceId: string) =>
  ok(
    apiClient.POST("/api/label-print-requests/{id}/release", {
      params: { path: { id } },
      body: { device_id: deviceId },
    }),
  );
