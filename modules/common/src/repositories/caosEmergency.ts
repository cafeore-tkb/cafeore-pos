import createClient from "openapi-fetch";
import type { paths } from "../types/api";
import { API_BASE_URL } from "./item";

// 緊急（入れ直し）と緊急のシール。結果は書いた注文の配信（{"type":"order"}）で全部の画面に届く。

const client = createClient<paths>({ baseUrl: API_BASE_URL });

type EmergencyResult = { error?: undefined } | { error: string };

/**
 * カップを緊急（入れ直し）にする（POST /api/caos/emergency）。マスターの緊急ボタンと CaOS の入れ直しのパネルが使う。
 * interrupt なら、そのカップの抽出中のカードを中断する（カードのカップを全部緊急にし、ドリッパーの待機の先頭を始める）。
 * もう緊急のカップは何もしない
 */
export const markCaosEmergency = async (
  cupIds: string[],
  interrupt: boolean,
): Promise<EmergencyResult> => {
  try {
    const { error, response } = await client.POST("/api/caos/emergency", {
      body: { cup_ids: cupIds, interrupt },
    });
    if (response.ok) return {};
    return {
      error:
        error?.error ||
        (response.status === 409
          ? "ほかの端末で先に変わりました。もう一度操作してください"
          : `緊急にできませんでした（${response.status}）`),
    };
  } catch {
    return { error: "cafeore-pos につながりません" };
  }
};

/**
 * 緊急のシールを印刷する役を取る。emergency_printed_at がまだ空なら付け、付けられたときだけ印刷した時刻を返す
 * （レジが 2 台あっても 1 台だけが取れる）。取れなければ null。つながらないときは例外
 */
export const claimEmergencyLabel = async (
  orderId: string,
  cupId: string,
): Promise<Date | null> => {
  const { data, response } = await client.POST(
    "/api/orders/{id}/cups/{cupId}/emergency-label/claim",
    { params: { path: { id: orderId, cupId } } },
  );
  if (!response.ok || !data) {
    throw new Error(
      `緊急のシールの印を付けられませんでした（${response.status}）`,
    );
  }
  return data.claimed && data.emergency_printed_at
    ? new Date(data.emergency_printed_at)
    : null;
};

/** 緊急のシールの印刷に失敗したので、印刷した時刻（claim で付けた時刻）を空に戻す。次の更新で試し直す */
export const releaseEmergencyLabel = async (
  orderId: string,
  cupId: string,
  printedAt: Date,
): Promise<void> => {
  await client.POST("/api/orders/{id}/cups/{cupId}/emergency-label/release", {
    params: { path: { id: orderId, cupId } },
    body: { emergency_printed_at: printedAt.toISOString() },
  });
};
