import createClient from "openapi-fetch";
import {
  responseToOrderEntity,
  responseToPrintJob,
} from "../firebase-utils/converter";
import type { WithId } from "../lib/typeguard";
import type { OrderEntity } from "../models/order";
import type { PrintJob } from "../models/printJob";
import type { paths } from "../types/api";
import { API_BASE_URL } from "./item";

// 印刷キュー（/api/print-jobs）。レジ・マスター・CaOS は積むだけで、「この端末で印刷する」にした端末が
// 積んだ順に 1 件ずつ取り（claim）、印刷して済み（done）・失敗（failed）にする。
// まだ終わっていない仕事は WebSocket の {"type":"print_jobs"} で全部の画面に届く（useOrdersWS の printJobs）。
// 失敗は画面にそのまま出すので、どの関数も理由（error）を返し、投げない。

const client = createClient<paths>({ baseUrl: API_BASE_URL });

export type PrintJobResult<T> =
  | { result: T; error?: undefined }
  | { result?: undefined; error: string };

const unreachable = { error: "cafeore-pos につながりません" } as const;

const resultOf = <T, R>(
  data: R | undefined,
  error: { error?: string } | undefined,
  response: Response,
  convert: (data: R) => T,
  fallback: string,
): PrintJobResult<T> =>
  data !== undefined && response.ok
    ? { result: convert(data) }
    : { error: error?.error || `${fallback}（${response.status}）` };

/**
 * そのカップの緊急の印刷（「緊急」のシール → そのカップの本物と同じシール）を積む（マスターの緊急ボタン）
 */
export const enqueueEmergencyPrint = async (
  orderId: string,
  cupId: string,
  source: "master" | "cashier" = "master",
): Promise<PrintJobResult<PrintJob>> => {
  try {
    const { data, error, response } = await client.POST("/api/print-jobs", {
      body: { kind: "emergency", source, order_id: orderId, cup_id: cupId },
    });
    return resultOf(
      data,
      error,
      response,
      responseToPrintJob,
      "緊急の印刷を積めませんでした",
    );
  } catch {
    return unreachable;
  }
};

/** 取った仕事と、印刷に要る注文 */
export type ClaimedPrintJob = { job: PrintJob; order: WithId<OrderEntity> };

/**
 * 印刷する端末が、次の仕事を 1 件取る。待ちが無ければ result が null。
 * サーバーが 1 件ずつ取るので、印刷する端末が複数あっても同じ仕事を 2 台が取らない
 */
export const claimPrintJob = async (
  printerId: string,
): Promise<PrintJobResult<ClaimedPrintJob | null>> => {
  try {
    const { data, response } = await client.POST("/api/print-jobs/claim", {
      body: { printer_id: printerId },
    });
    if (response.status === 204) return { result: null };
    if (!response.ok || !data || !("job" in data)) {
      return { error: `印刷の仕事を取れませんでした（${response.status}）` };
    }
    return {
      result: {
        job: responseToPrintJob(data.job),
        order: responseToOrderEntity(data.order),
      },
    };
  } catch {
    return unreachable;
  }
};

/** 印刷できた（取った端末だけが済みにできる） */
export const completePrintJob = async (
  id: number,
  printerId: string,
): Promise<PrintJobResult<PrintJob>> => {
  try {
    const { data, error, response } = await client.POST(
      "/api/print-jobs/{id}/done",
      { params: { path: { id } }, body: { printer_id: printerId } },
    );
    return resultOf(
      data,
      error,
      response,
      responseToPrintJob,
      "済みにできませんでした",
    );
  } catch {
    return unreachable;
  }
};

/** 印刷できなかった（失敗として残し、画面に出す） */
export const failPrintJob = async (
  id: number,
  printerId: string,
  reason: string,
): Promise<PrintJobResult<PrintJob>> => {
  try {
    const { data, error, response } = await client.POST(
      "/api/print-jobs/{id}/failed",
      {
        params: { path: { id } },
        body: { printer_id: printerId, error: reason.slice(0, 500) },
      },
    );
    return resultOf(
      data,
      error,
      response,
      responseToPrintJob,
      "失敗を記録できませんでした",
    );
  } catch {
    return unreachable;
  }
};

/** もう一度印刷する（失敗した・止まった仕事を待ちに戻す） */
export const retryPrintJob = async (
  id: number,
): Promise<PrintJobResult<PrintJob>> => {
  try {
    const { data, error, response } = await client.POST(
      "/api/print-jobs/{id}/retry",
      { params: { path: { id } } },
    );
    return resultOf(
      data,
      error,
      response,
      responseToPrintJob,
      "もう一度印刷できませんでした",
    );
  } catch {
    return unreachable;
  }
};

/** 印刷をやめる（待ち・失敗した・止まった仕事を取り消す） */
export const cancelPrintJob = async (
  id: number,
): Promise<PrintJobResult<PrintJob>> => {
  try {
    const { data, error, response } = await client.POST(
      "/api/print-jobs/{id}/cancel",
      { params: { path: { id } } },
    );
    return resultOf(
      data,
      error,
      response,
      responseToPrintJob,
      "取り消せませんでした",
    );
  } catch {
    return unreachable;
  }
};
