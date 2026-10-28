import { apiClient, apiErrorReason } from "../api/client";
import type { components } from "../types/api";

/** 営業データのリセットの前の状態（消す表と行数・残す表・受付を止めているか・確認の文字） */
export type DataResetStatus = components["schemas"]["DataResetStatus"];

/** 表と行数 */
export type DataResetTable = components["schemas"]["DataResetTable"];

/** ダウンロードしたバックアップ。リセットのときに sha256 を送る */
export type DataResetBackupFile = {
  blob: Blob;
  /** ファイルの SHA-256（16 進の小文字） */
  sha256: string;
  /** サーバーが付けたファイル名。取れなければ手元で作る */
  fileName: string;
};

/** バイト列の SHA-256 を 16 進の小文字にする */
export const sha256Hex = async (data: ArrayBuffer): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
};

/** Content-Disposition の filename。無ければ null */
export const attachmentFileName = (header: string | null): string | null =>
  header?.match(/filename="([^"]+)"/)?.[1] ?? null;

/**
 * 営業データのリセット（/api/admin/data-reset）。管理者だけが使える。
 * 失敗したら、API が返した理由（そのまま画面に出せる文）で投げる
 */
export const dataResetRepository = {
  async getStatus(): Promise<DataResetStatus> {
    const { data, error, response } = await apiClient.GET(
      "/api/admin/data-reset",
    );
    if (!data) throw new Error(apiErrorReason(response, error));
    return data;
  },

  /** 消す表の中身を全部ダウンロードし、SHA-256 を計算する（保存はしない） */
  async downloadBackup(): Promise<DataResetBackupFile> {
    const { data, error, response } = await apiClient.GET(
      "/api/admin/data-reset/backup",
      { parseAs: "blob" },
    );
    if (!response.ok || !data) throw new Error(apiErrorReason(response, error));
    return {
      blob: data,
      sha256: await sha256Hex(await data.arrayBuffer()),
      fileName:
        attachmentFileName(response.headers.get("Content-Disposition")) ??
        `cafeore-pos-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
    };
  },

  /** 営業データを消す。消した表と、消した行数を返す */
  async reset(
    confirmation: string,
    backupSha256: string,
  ): Promise<DataResetTable[]> {
    const { data, error, response } = await apiClient.POST(
      "/api/admin/data-reset",
      { body: { confirmation, backupSha256 } },
    );
    if (!data) throw new Error(apiErrorReason(response, error));
    return data.tables;
  },
};
