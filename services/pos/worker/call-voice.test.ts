import { afterEach, describe, expect, test, vi } from "vitest";
import {
  type CallVoiceBucket,
  callVoiceCacheKey,
  callVoiceRequestBody,
  callVoiceText,
  handleCallVoice,
} from "./call-voice";

const AUDIO = new Uint8Array([0x49, 0x44, 0x33, 0x04]).buffer;

const memoryBucket = (initial: Record<string, ArrayBuffer> = {}) => {
  const store = new Map(Object.entries(initial));
  const put = vi.fn(async (key: string, value: ArrayBuffer) => {
    store.set(key, value);
  });
  const bucket: CallVoiceBucket = {
    get: async (key) => {
      const value = store.get(key);
      return value ? { arrayBuffer: async () => value } : null;
    },
    put,
  };
  return { bucket, store, put };
};

const context = () => {
  const pending: Promise<unknown>[] = [];
  return {
    ctx: { waitUntil: (promise: Promise<unknown>) => pending.push(promise) },
    settle: () => Promise.all(pending),
  };
};

const elevenLabsOk = () =>
  vi.fn(
    async () =>
      new Response(AUDIO, { headers: { "content-type": "audio/mpeg" } }),
  );

const get = (path: string) => new Request(`https://pos.example${path}`);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("[unit] 呼び出しの音声の文面", () => {
  test("番号を読み、順番が前後するときは冒頭で断る", () => {
    expect(callVoiceText(12, false)).toBe(
      "[スムーズなナレーターで]12番でお待ちのお客様、提供口までお越しください。",
    );
    expect(callVoiceText(12, true)).toBe(
      "[スムーズなナレーターで]順番が前後いたします。12番でお待ちのお客様、提供口までお越しください。",
    );
  });

  test("溜める鍵は同じ文面なら同じ、違えば違う", async () => {
    const a = await callVoiceCacheKey(
      callVoiceRequestBody(callVoiceText(1, false)),
    );
    const b = await callVoiceCacheKey(
      callVoiceRequestBody(callVoiceText(1, false)),
    );
    const c = await callVoiceCacheKey(
      callVoiceRequestBody(callVoiceText(1, true)),
    );
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^call-voice\/[0-9a-f]{64}\.mp3$/);
  });
});

describe("[unit] /call-voice", () => {
  test("溜めてあれば ElevenLabs を呼ばずに返す", async () => {
    const key = await callVoiceCacheKey(
      callVoiceRequestBody(callVoiceText(7, false)),
    );
    const { bucket } = memoryBucket({ [key]: AUDIO });
    const fetchMock = elevenLabsOk();
    vi.stubGlobal("fetch", fetchMock);

    const res = await handleCallVoice(
      get("/call-voice/7"),
      { CALL_VOICES: bucket, ELEVENLABS_API_KEY: "key" },
      context().ctx,
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/mpeg");
    expect(res.headers.get("x-call-voice-cache")).toBe("hit");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(
      new Uint8Array(AUDIO),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("無ければ ElevenLabs で作って溜める。次は溜めたものを返す", async () => {
    const { bucket, put } = memoryBucket();
    const fetchMock = elevenLabsOk();
    vi.stubGlobal("fetch", fetchMock);
    const env = { CALL_VOICES: bucket, ELEVENLABS_API_KEY: "secret-key" };

    const { ctx, settle } = context();
    const res = await handleCallVoice(
      get("/call-voice/12?reordered=1"),
      env,
      ctx,
    );
    await settle();

    expect(res.status).toBe(200);
    expect(res.headers.get("x-call-voice-cache")).toBe("miss");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(
      new Uint8Array(AUDIO),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(
      "https://api.elevenlabs.io/v1/text-to-dialogue?output_format=mp3_44100_128",
    );
    expect(new Headers(init.headers).get("xi-api-key")).toBe("secret-key");
    expect(JSON.parse(init.body as string)).toEqual(
      callVoiceRequestBody(callVoiceText(12, true)),
    );

    expect(put).toHaveBeenCalledTimes(1);
    const again = await handleCallVoice(
      get("/call-voice/12?reordered=1"),
      env,
      context().ctx,
    );
    expect(again.headers.get("x-call-voice-cache")).toBe("hit");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("鍵が無ければ作らない（溜めてあるものは返す）", async () => {
    vi.stubGlobal("fetch", elevenLabsOk());
    const res = await handleCallVoice(
      get("/call-voice/3"),
      { CALL_VOICES: memoryBucket().bucket },
      context().ctx,
    );
    expect(res.status).toBe(503);
  });

  test("ElevenLabs が断ったら 502 で、溜めない", async () => {
    const { bucket, put } = memoryBucket();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ detail: "quota" }, { status: 401 })),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await handleCallVoice(
      get("/call-voice/3"),
      { CALL_VOICES: bucket, ELEVENLABS_API_KEY: "key" },
      context().ctx,
    );

    expect(res.status).toBe(502);
    expect(put).not.toHaveBeenCalled();
  });

  test("番号でないもの・5 桁以上・GET 以外は断る", async () => {
    const fetchMock = elevenLabsOk();
    vi.stubGlobal("fetch", fetchMock);
    const env = { CALL_VOICES: memoryBucket().bucket, ELEVENLABS_API_KEY: "k" };

    for (const path of [
      "/call-voice/abc",
      "/call-voice/0",
      "/call-voice/12345",
    ]) {
      expect(
        (await handleCallVoice(get(path), env, context().ctx)).status,
      ).toBe(404);
    }
    const post = new Request("https://pos.example/call-voice/1", {
      method: "POST",
    });
    expect((await handleCallVoice(post, env, context().ctx)).status).toBe(405);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
