// 呼び出し画面で流す音声（/call-voice/call・/call-voice/drip）。
//
//   - 呼び出し：「（順番が前後いたします。）N番のお客様、提供口までお越しください。」
//   - ドリップの案内：「N番のお客様、ファーストにてドリップいたします。よろしければぜひ、お近くでご覧ください。」
//
// 文はここで決め、画面からは注文番号・「順番が前後するか」・ドリッパーの番号だけを受け取る
// （任意の文を読ませないため。ElevenLabs の利用枠を使うのはこの決まった文だけになる）。
//
// 文は片（「N番のお客様、」「提供口までお越しください。」など）に分けて ElevenLabs で作り、つないで 1 本で返す。
// 片ごとに R2（CALL_VOICES）に溜めるので、番号の片は呼び出しとドリップの案内で同じものを使い、
// 決まった文の片は一度作れば済む。溜める鍵は、ElevenLabs に送る中身のハッシュ。文や声を変えれば別の鍵になり、作り直される。
//
// ElevenLabs の鍵は Worker の secret の ELEVENLABS_API_KEY。デプロイの workflow が GitHub の secret の
// ELEVENLABS_API_KEY から --secrets-file で入れる（本番もプレビューも同じ）。

import { concatMp3 } from "./mp3";

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

const ELEVENLABS_URL =
  "https://api.elevenlabs.io/v1/text-to-dialogue?output_format=mp3_44100_128";
const MODEL_ID = "eleven_v4";
const VOICE_ID = "gHBfNp2PWSyFgpPlzCOd";
/** 声の調子の指定。片ごとに頭に付ける */
const VOICE_DIRECTION = "[スムーズなナレーターで]";
/** 鍵を変えずに作り直したいとき（ElevenLabs 側の声が変わったなど）はここを上げる */
const CACHE_VERSION = 1;
/** ElevenLabs の返事を待つ上限。返事が来ないまま Worker を待たせない */
const ELEVENLABS_TIMEOUT_MS = 20_000;

/** 注文番号は 1〜4 桁だけ受け付ける（作る片の数に上限を付ける） */
const ORDER_NO = /^[1-9]\d{0,3}$/;
/** ドリップの案内で一度に読む注文の数（1 枚のカードは最大 2 杯） */
const MAX_DRIP_ORDERS = 2;

/** ドリッパーの読み（画面の 1st〜6th。英字のままだと読み方が揺れうるので仮名で渡す） */
const DRIPPER_READINGS: Record<number, string> = {
  1: "ファースト",
  2: "セカンド",
  3: "サード",
  4: "フォース",
  5: "フィフス",
  6: "シックス",
};

/** 片の文 */
export const callVoiceSegments = {
  reordered: "順番が前後いたします。",
  orderNo: (orderNo: number) => `${orderNo}番のお客様、`,
  callTail: "提供口までお越しください。",
  dripper: (dripper: number) =>
    `${DRIPPER_READINGS[dripper]}にてドリップいたします。`,
  dripTail: "よろしければぜひ、お近くでご覧ください。",
};

/** 呼び出しの片 */
export const callAnnouncement = (orderNo: number, reordered: boolean) => [
  ...(reordered ? [callVoiceSegments.reordered] : []),
  callVoiceSegments.orderNo(orderNo),
  callVoiceSegments.callTail,
];

/** ドリップの案内の片 */
export const dripAnnouncement = (orderNos: number[], dripper: number) => [
  ...orderNos.map(callVoiceSegments.orderNo),
  callVoiceSegments.dripper(dripper),
  callVoiceSegments.dripTail,
];

/** ElevenLabs の text-to-dialogue に送る中身（片 1 つ分） */
export const callVoiceRequestBody = (segment: string) => ({
  model_id: MODEL_ID,
  language_code: "ja",
  inputs: [{ text: `${VOICE_DIRECTION}${segment}`, voice_id: VOICE_ID }],
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

/** 読む片。URL が決まりに合わなければ null */
export const parseAnnouncement = (url: URL): string[] | null => {
  const orders = url.searchParams.getAll("order");
  if (orders.length === 0 || !orders.every((no) => ORDER_NO.test(no))) {
    return null;
  }
  const orderNos = orders.map(Number);
  if (url.pathname === "/call-voice/call") {
    if (orderNos.length !== 1) return null;
    return callAnnouncement(
      orderNos[0],
      url.searchParams.get("reordered") === "1",
    );
  }
  if (url.pathname === "/call-voice/drip") {
    const dripper = Number(url.searchParams.get("dripper"));
    if (!(dripper in DRIPPER_READINGS)) return null;
    if (orderNos.length > MAX_DRIP_ORDERS) return null;
    return dripAnnouncement(orderNos, dripper);
  }
  return null;
};

type SegmentResult =
  | { audio: ArrayBuffer; cache: "hit" | "miss" }
  | { error: Response };

const errorResponse = (status: number, error: string) =>
  Response.json({ error }, { status });

/** 片 1 つの音声。溜めてあればそれ、無ければ ElevenLabs で作って溜める */
const segmentAudio = async (
  segment: string,
  env: CallVoiceEnv,
  ctx: CallVoiceContext,
): Promise<SegmentResult> => {
  const body = callVoiceRequestBody(segment);
  const key = await callVoiceCacheKey(body);

  const cached = await env.CALL_VOICES?.get(key).catch((error) => {
    // 読めなくても ElevenLabs で作れば流せるので、ログに残して進める
    console.error("call-voice: R2 から読めなかった", error);
    return null;
  });
  if (cached) return { audio: await cached.arrayBuffer(), cache: "hit" };

  if (!env.ELEVENLABS_API_KEY) {
    return {
      error: errorResponse(503, "ELEVENLABS_API_KEY が設定されていません"),
    };
  }

  let audio: ArrayBuffer;
  try {
    // 打ち切りは本文を読むところまで効く
    const res = await fetch(ELEVENLABS_URL, {
      method: "POST",
      headers: {
        "xi-api-key": env.ELEVENLABS_API_KEY,
        "content-type": "application/json",
        accept: "audio/mpeg",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(ELEVENLABS_TIMEOUT_MS),
    });
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok || !type.startsWith("audio/")) {
      const detail = (await res.text().catch(() => "")).slice(0, 500);
      console.error("call-voice: ElevenLabs が音声を返さなかった", {
        status: res.status,
        type,
        detail,
      });
      return { error: errorResponse(502, "音声を作れませんでした") };
    }
    audio = await res.arrayBuffer();
  } catch (error) {
    // 時間切れ（TimeoutError）か、つながらなかった
    console.error("call-voice: ElevenLabs から返事が来なかった", error);
    return {
      error: errorResponse(504, "音声を作るのに時間がかかりすぎました"),
    };
  }

  if (env.CALL_VOICES) {
    // 溜めるのを待たずに返す。溜められなければ次の呼び出しでまた作る。
    // 返す方と取り合わないよう、溜める方には写しを渡す
    ctx.waitUntil(
      env.CALL_VOICES.put(key, audio.slice(0), {
        httpMetadata: { contentType: "audio/mpeg" },
        // R2 の中を見たときに何の音声か分かるように（ヘッダーに載るので URL エンコードする）
        customMetadata: { text: encodeURIComponent(segment) },
      }).catch((error) => {
        console.error("call-voice: R2 に溜められなかった", error);
      }),
    );
  }
  return { audio, cache: "miss" };
};

export async function handleCallVoice(
  request: Request,
  env: CallVoiceEnv,
  ctx: CallVoiceContext,
): Promise<Response> {
  const segments = parseAnnouncement(new URL(request.url));
  if (!segments) return errorResponse(404, "読む内容が正しくありません");
  if (request.method !== "GET") {
    return errorResponse(405, "GET だけを受け付けます");
  }

  // 片は同時に用意する（溜めていない片が複数あれば、ElevenLabs にも同時に頼む）
  const results = await Promise.all(
    segments.map((segment) => segmentAudio(segment, env, ctx)),
  );
  const failed = results.find((result) => "error" in result);
  if (failed && "error" in failed) return failed.error;
  const parts = results.flatMap((result) =>
    "audio" in result ? [result] : [],
  );

  return new Response(concatMp3(parts.map((part) => part.audio)), {
    headers: {
      "content-type": "audio/mpeg",
      // 画面は同じ番号を何度も呼ぶので、しばらくはブラウザにも持たせる。
      // 文を変えたデプロイの後も、長くて 1 時間で新しい音声になる
      "cache-control": "private, max-age=3600",
      // 片がどれも溜めてあったか（確かめる用）
      "x-call-voice-cache": parts.every((part) => part.cache === "hit")
        ? "hit"
        : "miss",
    },
  });
}
