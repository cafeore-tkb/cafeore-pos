// 呼び出しの音声を溜めておくところ（worker/call-voice.ts の CallVoiceBucket）を GCS で作る。
// Workers では R2 だったところ。鍵も中身も同じ形で置く。
//
// 認証は Application Default Credentials（Cloud Run ではサービスのサービスアカウント）。
// そのサービスアカウントには、バケットのオブジェクトを読み書きできる権限が要る。

import type { CallVoiceBucket } from "../worker/call-voice";

/** @google-cloud/storage の Bucket のうち、ここで使うところだけ（テストで差し替える） */
export interface GcsBucket {
  file(name: string): {
    download(): Promise<[Buffer]>;
    save(
      data: Buffer,
      options: {
        resumable: boolean;
        contentType?: string;
        metadata?: { metadata?: Record<string, string> };
      },
    ): Promise<void>;
  };
}

const isNotFound = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  error.code === 404;

export const gcsCallVoiceBucket = (bucket: GcsBucket): CallVoiceBucket => ({
  async get(key) {
    let data: Buffer;
    try {
      [data] = await bucket.file(key).download();
    } catch (error) {
      // 溜めていない（R2 の get が null を返すのと同じ）
      if (isNotFound(error)) return null;
      throw error;
    }
    // Buffer は大きな領域の一部のことがあるので、その分だけを切り出す
    const audio = data.buffer.slice(
      data.byteOffset,
      data.byteOffset + data.byteLength,
    ) as ArrayBuffer;
    return { arrayBuffer: async () => audio };
  },

  async put(key, value, options) {
    await bucket.file(key).save(Buffer.from(value), {
      // 小さいので一度に送る（resumable は余計に往復する）
      resumable: false,
      contentType: options?.httpMetadata?.contentType,
      // R2 の customMetadata にあたるもの（x-goog-meta-*）
      metadata: options?.customMetadata
        ? { metadata: options.customMetadata }
        : undefined,
    });
  },
});
