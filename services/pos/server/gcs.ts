// 呼び出しの音声を溜める GCS のバケット。worker/call-voice.ts の CallVoiceBucket（R2 の形）を GCS で作る。
// バケットの名前は env の CALL_VOICE_BUCKET（Terraform が渡す）。
//
// @google-cloud/storage は使わず、GCS の JSON API を fetch で直接呼ぶ。使うのは「1 つ読む」「1 つ書く」だけで、
// どちらも 1 回の HTTP で済み、依存を増やすほどのことではないため（束ねる server/ が小さいままで済む）。
//
// ## 認証
//
// Cloud Run のメタデータサーバーが出す、サービスのサービスアカウント（web 専用の SA。Terraform が作り、
// バケットに roles/storage.objectUser を付ける）のアクセストークン。期限の少し前まで使い回す。
// 手元ではメタデータサーバーが無いので、CALL_VOICE_BUCKET を入れずに動かす（溜めずに毎回 ElevenLabs で作る）。
//
// ## 書き方
//
// multipart のアップロード（uploadType=multipart）にしている。中身と一緒に、何の文の音声か（call-voice.ts が渡す
// customMetadata の text）をオブジェクトのメタデータに 1 回で入れられ、コンソールで中を見たときに分かる。
// simple（uploadType=media）だと 1 回では中身しか入れられない。
//
// ifGenerationMatch=0 で、まだ無いときだけ作る。同じ片を同時に作ったときの 2 つ目は 412 になるが、
// もう溜まっているので成功とみなす（上書きしない）。

import type { CallVoiceBucket } from "../worker/call-voice";

const METADATA_TOKEN_URL =
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token";
const STORAGE_URL = "https://storage.googleapis.com/storage/v1";
const UPLOAD_URL = "https://storage.googleapis.com/upload/storage/v1";

/** メタデータサーバーは同じ所にあるので、すぐ返事が来る。来なければ諦めて溜めずに進む */
const TOKEN_TIMEOUT_MS = 3_000;
/** 読めなくても ElevenLabs で作れば流せる。待ちすぎない */
const GET_TIMEOUT_MS = 5_000;
/** 溜め終わるまで応答を待たせる（server/app.ts）ので、上限を付ける */
const PUT_TIMEOUT_MS = 10_000;
/** トークンの期限のこれだけ前に取り直す */
const TOKEN_MARGIN_MS = 60_000;

const errorDetail = async (res: Response) =>
  (await res.text().catch(() => "")).slice(0, 300);

/** メタデータサーバーのアクセストークン。期限の少し前まで使い回し、同時に頼まれても 1 回だけ取りに行く */
const metadataToken = () => {
  let cached: { token: string; expiresAt: number } | undefined;
  let pending: Promise<string> | undefined;

  const fetchToken = async () => {
    const res = await fetch(METADATA_TOKEN_URL, {
      headers: { "Metadata-Flavor": "Google" },
      signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(
        `メタデータサーバーからトークンを取れなかった（${res.status}）: ${await errorDetail(res)}`,
      );
    }
    const body = (await res.json()) as {
      access_token?: string;
      expires_in?: number;
    };
    if (!body.access_token) {
      throw new Error("メタデータサーバーの返事に access_token が無い");
    }
    cached = {
      token: body.access_token,
      expiresAt: Date.now() + (body.expires_in ?? 0) * 1000 - TOKEN_MARGIN_MS,
    };
    return body.access_token;
  };

  return {
    get: async () => {
      if (cached && Date.now() < cached.expiresAt) return cached.token;
      pending ??= fetchToken().finally(() => {
        pending = undefined;
      });
      return pending;
    },
    /** GCS が 401 を返したとき。次は取り直す */
    forget: () => {
      cached = undefined;
    },
  };
};

/** 読まない本文を捨てる（読まずに置いておくと、つないだままになる） */
const discard = (res: Response) => res.body?.cancel().catch(() => {});

/** multipart/related の本文（1 つ目がメタデータの JSON、2 つ目が中身） */
export const multipartBody = (
  metadata: Record<string, unknown>,
  media: ArrayBuffer,
  mediaType: string,
) => {
  const bytes = new Uint8Array(media);
  const encoder = new TextEncoder();
  let boundary: string;
  // 区切りが中身に現れると壊れるので、現れないものにする（乱数なのでまず 1 回で済む）
  do {
    boundary = `call-voice-${crypto.randomUUID()}`;
  } while (Buffer.from(media).includes(boundary));
  const head = encoder.encode(
    [
      `--${boundary}`,
      "Content-Type: application/json; charset=UTF-8",
      "",
      JSON.stringify(metadata),
      `--${boundary}`,
      `Content-Type: ${mediaType}`,
      "",
      "",
    ].join("\r\n"),
  );
  const tail = encoder.encode(`\r\n--${boundary}--\r\n`);
  const body = new Uint8Array(head.length + bytes.length + tail.length);
  body.set(head, 0);
  body.set(bytes, head.length);
  body.set(tail, head.length + bytes.length);
  return { body, contentType: `multipart/related; boundary=${boundary}` };
};

export const gcsBucket = (bucket: string): CallVoiceBucket => {
  const token = metadataToken();
  const authorized = async () => ({
    authorization: `Bearer ${await token.get()}`,
  });
  const checkAuth = (res: Response) => {
    if (res.status === 401) token.forget();
  };

  return {
    async get(key) {
      const res = await fetch(
        `${STORAGE_URL}/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(key)}?alt=media`,
        {
          headers: await authorized(),
          signal: AbortSignal.timeout(GET_TIMEOUT_MS),
        },
      );
      if (res.status === 404) {
        await discard(res);
        return null;
      }
      if (!res.ok) {
        checkAuth(res);
        throw new Error(
          `GCS から ${key} を読めなかった（${res.status}）: ${await errorDetail(res)}`,
        );
      }
      const audio = await res.arrayBuffer();
      return { arrayBuffer: async () => audio };
    },

    async put(key, value, options) {
      const contentType =
        options?.httpMetadata?.contentType ?? "application/octet-stream";
      const { body, contentType: multipartType } = multipartBody(
        {
          name: key,
          contentType,
          ...(options?.customMetadata
            ? { metadata: options.customMetadata }
            : {}),
        },
        value,
        contentType,
      );
      const res = await fetch(
        `${UPLOAD_URL}/b/${encodeURIComponent(bucket)}/o?uploadType=multipart&ifGenerationMatch=0`,
        {
          method: "POST",
          headers: { ...(await authorized()), "content-type": multipartType },
          body,
          signal: AbortSignal.timeout(PUT_TIMEOUT_MS),
        },
      );
      if (!res.ok && res.status !== 412) {
        checkAuth(res);
        throw new Error(
          `GCS に ${key} を溜められなかった（${res.status}）: ${await errorDetail(res)}`,
        );
      }
      // 412 はもう同じ鍵のものがある（同じ片を同時に作った）。溜まっているので成功とみなす
      await discard(res);
    },
  };
};
