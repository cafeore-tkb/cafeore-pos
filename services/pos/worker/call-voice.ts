// 呼び出し画面で流す音声（/call-voice/<注文番号>）。
//
// 文面はここで決め、画面からは注文番号と「順番が前後するか」だけを受け取る
// （任意の文を読ませないため。ElevenLabs の利用枠を使うのはこの決まった文面だけになる）。
// 作った音声は R2（CALL_VOICES）に溜め、同じ文面（と声・モデル・設定）なら ElevenLabs を呼ばずに返す。
// 溜める鍵は、ElevenLabs に送る中身のハッシュ。文面や声を変えれば別の鍵になり、作り直される。
//
// ElevenLabs の鍵は Worker の secret の ELEVENLABS_API_KEY。デプロイの workflow が GitHub の secret の
// ELEVENLABS_API_KEY から --secrets-file で入れる（本番もプレビューも同じ）。

/** R2 のバケットのうち、ここで使うところだけ */
export interface CallVoiceBucket {
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
  put(
    key: string,
    value: ArrayBuffer,
    options?: {
      httpMetadata?: { contentType?: string };
      customMetadata?: Record<string, string>;
    },
  ): Promise<unknown>;
}

export interface CallVoiceEnv {
  ELEVENLABS_API_KEY?: string;
  CALL_VOICES?: CallVoiceBucket;
}

export interface CallVoiceContext {
  waitUntil(promise: Promise<unknown>): void;
}

/** 注文番号は 1〜4 桁だけ受け付ける（作る文面の数に上限を付ける） */
export const CALL_VOICE_PATH = /^\/call-voice\/([1-9]\d{0,3})$/;

const ELEVENLABS_URL =
  "https://api.elevenlabs.io/v1/text-to-dialogue?output_format=mp3_44100_128";
const MODEL_ID = "eleven_v4";
const VOICE_ID = "gHBfNp2PWSyFgpPlzCOd";
/** 鍵を変えずに作り直したいとき（ElevenLabs 側の声が変わったなど）はここを上げる */
const CACHE_VERSION = 1;

/**
 * 呼び出しの文面。順番が前後するとき（先に注文したお客様がまだ待っている）は冒頭で断る
 */
export const callVoiceText = (orderNo: number, reordered: boolean) =>
  `[スムーズなナレーターで]${reordered ? "順番が前後いたします。" : ""}${orderNo}番でお待ちのお客様、提供口までお越しください。`;

/** ElevenLabs の text-to-dialogue に送る中身 */
export const callVoiceRequestBody = (text: string) => ({
  model_id: MODEL_ID,
  language_code: "ja",
  inputs: [{ text, voice_id: VOICE_ID }],
  settings: { stability: 1.0, similarity: 0.75 },
});

/** R2 の鍵。送る中身と出力の形式が同じなら同じ鍵になる */
export const callVoiceCacheKey = async (
  body: ReturnType<typeof callVoiceRequestBody>,
) => {
  const source = JSON.stringify({
    version: CACHE_VERSION,
    url: ELEVENLABS_URL,
    body,
  });
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(source),
  );
  const hex = Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  return `call-voice/${hex}.mp3`;
};

const audioResponse = (audio: ArrayBuffer, cache: "hit" | "miss") =>
  new Response(audio, {
    headers: {
      "content-type": "audio/mpeg",
      // 画面は同じ番号を何度も呼ぶので、しばらくはブラウザにも持たせる。
      // 文面を変えたデプロイの後も、長くて 1 時間で新しい音声になる
      "cache-control": "private, max-age=3600",
      "x-call-voice-cache": cache,
    },
  });

const errorResponse = (status: number, error: string) =>
  Response.json({ error }, { status });

export async function handleCallVoice(
  request: Request,
  env: CallVoiceEnv,
  ctx: CallVoiceContext,
): Promise<Response> {
  const url = new URL(request.url);
  const match = CALL_VOICE_PATH.exec(url.pathname);
  if (!match) return errorResponse(404, "注文番号が正しくありません");
  if (request.method !== "GET") {
    return errorResponse(405, "GET だけを受け付けます");
  }

  const orderNo = Number(match[1]);
  const reordered = url.searchParams.get("reordered") === "1";
  const text = callVoiceText(orderNo, reordered);
  const body = callVoiceRequestBody(text);
  const key = await callVoiceCacheKey(body);

  const cached = await env.CALL_VOICES?.get(key).catch((error) => {
    // 読めなくても ElevenLabs で作れば流せるので、ログに残して進める
    console.error("call-voice: R2 から読めなかった", error);
    return null;
  });
  if (cached) return audioResponse(await cached.arrayBuffer(), "hit");

  if (!env.ELEVENLABS_API_KEY) {
    return errorResponse(503, "ELEVENLABS_API_KEY が設定されていません");
  }

  const res = await fetch(ELEVENLABS_URL, {
    method: "POST",
    headers: {
      "xi-api-key": env.ELEVENLABS_API_KEY,
      "content-type": "application/json",
      accept: "audio/mpeg",
    },
    body: JSON.stringify(body),
  });
  const type = res.headers.get("content-type") ?? "";
  if (!res.ok || !type.startsWith("audio/")) {
    const detail = (await res.text().catch(() => "")).slice(0, 500);
    console.error("call-voice: ElevenLabs が音声を返さなかった", {
      status: res.status,
      type,
      detail,
    });
    return errorResponse(502, "音声を作れませんでした");
  }

  const audio = await res.arrayBuffer();
  if (env.CALL_VOICES) {
    // 溜めるのを待たずに返す。溜められなければ次の呼び出しでまた作る
    // 応答の本文と取り合わないよう、溜める方には写しを渡す
    ctx.waitUntil(
      env.CALL_VOICES.put(key, audio.slice(0), {
        httpMetadata: { contentType: "audio/mpeg" },
        // R2 の中を見たときに何の音声か分かるように（ヘッダーに載るので URL エンコードする）
        customMetadata: { text: encodeURIComponent(text) },
      }).catch((error) => {
        console.error("call-voice: R2 に溜められなかった", error);
      }),
    );
  }
  return audioResponse(audio, "miss");
}
