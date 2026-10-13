import { afterEach, describe, expect, test, vi } from "vitest";
import {
  type CallVoiceBucket,
  callAnnouncement,
  callVoiceCacheKey,
  callVoiceRequestBody,
  callVoiceSegments,
  dripAnnouncement,
  handleCallVoice,
  parseAnnouncement,
} from "./call-voice";

// 片の音声の代わり（MP3 のフレームの形にはしていないので、つないでもそのまま並ぶ）
const audioOf = (text: string) => new TextEncoder().encode(`<${text}>`).buffer;
const textOf = async (res: Response) =>
  new TextDecoder().decode(await res.arrayBuffer());

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

/** ElevenLabs の代わり。送られた文の片をそのまま音声にして返す */
const elevenLabs = () =>
  vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string);
    const text: string = body.inputs[0].text;
    return new Response(audioOf(text.replace("[スムーズなナレーターで]", "")), {
      headers: { "content-type": "audio/mpeg" },
    });
  });

const keyOf = (segment: string) =>
  callVoiceCacheKey(callVoiceRequestBody(segment));

const get = (path: string) => new Request(`https://pos.example${path}`);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("[unit] 呼び出しの音声の文", () => {
  test("呼び出しは番号の片と決まった片。順番が前後するときは冒頭で断る", () => {
    expect(callAnnouncement(12, false)).toEqual([
      "12番のお客様、",
      "提供口までお越しください。",
    ]);
    expect(callAnnouncement(12, true)).toEqual([
      "順番が前後いたします。",
      "12番のお客様、",
      "提供口までお越しください。",
    ]);
  });

  test("ドリップの案内は番号の片を呼び出しと同じものにし、ドリッパーは読みで渡す", () => {
    expect(dripAnnouncement([12], 1)).toEqual([
      "12番のお客様、",
      "ファーストにてドリップいたします。",
      "よろしければぜひ、お近くでご覧ください。",
    ]);
    // 立て続けの案内では「よろしければ…」を省く
    expect(dripAnnouncement([12], 2, false)).toEqual([
      "12番のお客様、",
      "セカンドにてドリップいたします。",
    ]);
    expect(dripAnnouncement([12, 13], 3)).toEqual([
      "12番のお客様、",
      "13番のお客様、",
      "サードにてドリップいたします。",
      "よろしければぜひ、お近くでご覧ください。",
    ]);
  });

  test("片ごとに ElevenLabs へ送り、声の調子の指定を頭に付ける", () => {
    expect(callVoiceRequestBody("12番のお客様、").inputs).toEqual([
      {
        text: "[スムーズなナレーターで]12番のお客様、",
        voice_id: "gHBfNp2PWSyFgpPlzCOd",
      },
    ]);
  });

  test("溜める鍵は同じ片なら同じ、違えば違う", async () => {
    expect(await keyOf("1番のお客様、")).toBe(await keyOf("1番のお客様、"));
    expect(await keyOf("1番のお客様、")).not.toBe(await keyOf("2番のお客様、"));
    expect(await keyOf("1番のお客様、")).toMatch(
      /^call-voice\/[0-9a-f]{64}\.mp3$/,
    );
  });

  test("URL が決まりに合わなければ読まない", () => {
    const parse = (path: string) =>
      parseAnnouncement(new URL(`https://pos.example${path}`));
    expect(parse("/call-voice/call?order=7")).toEqual(
      callAnnouncement(7, false),
    );
    expect(parse("/call-voice/drip?order=7&order=8&dripper=6")).toEqual(
      dripAnnouncement([7, 8], 6),
    );
    expect(parse("/call-voice/drip?order=7&dripper=6&invite=0")).toEqual(
      dripAnnouncement([7], 6, false),
    );
    for (const path of [
      "/call-voice/call",
      "/call-voice/call?order=abc",
      "/call-voice/call?order=0",
      "/call-voice/call?order=12345",
      "/call-voice/call?order=1&order=2",
      "/call-voice/drip?order=1",
      "/call-voice/drip?order=1&dripper=7",
      "/call-voice/drip?order=1&order=2&order=3&dripper=1",
      "/call-voice/other?order=1",
    ]) {
      expect(parse(path)).toBe(null);
    }
  });
});

describe("[unit] /call-voice", () => {
  test("片をつないで 1 本で返す。溜めてある片は ElevenLabs を呼ばない", async () => {
    const { bucket } = memoryBucket({
      [await keyOf(callVoiceSegments.callTail)]: audioOf("溜めた尻"),
    });
    const fetchMock = elevenLabs();
    vi.stubGlobal("fetch", fetchMock);
    const { ctx, settle } = context();

    const res = await handleCallVoice(
      get("/call-voice/call?order=12&reordered=1"),
      { CALL_VOICES: bucket, ELEVENLABS_API_KEY: "secret-key" },
      ctx,
    );
    await settle();

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/mpeg");
    expect(res.headers.get("x-call-voice-cache")).toBe("miss");
    expect(await textOf(res)).toBe(
      "<順番が前後いたします。><12番のお客様、><溜めた尻>",
    );
    // 作ったのは溜めていなかった 2 つの片だけ
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://api.elevenlabs.io/v1/text-to-dialogue?output_format=mp3_44100_128",
    );
    expect(new Headers(init.headers).get("xi-api-key")).toBe("secret-key");
  });

  test("作った片は溜め、番号の片は呼び出しとドリップの案内で使い回す", async () => {
    const { bucket, put } = memoryBucket();
    const fetchMock = elevenLabs();
    vi.stubGlobal("fetch", fetchMock);
    const env = { CALL_VOICES: bucket, ELEVENLABS_API_KEY: "key" };

    const first = context();
    await handleCallVoice(
      get("/call-voice/drip?order=12&dripper=1"),
      env,
      first.ctx,
    );
    await first.settle();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(put).toHaveBeenCalledTimes(3);

    // 呼び出しで新しく作るのは「提供口までお越しください。」だけ
    const second = context();
    const call = await handleCallVoice(
      get("/call-voice/call?order=12"),
      env,
      second.ctx,
    );
    await second.settle();
    expect(await textOf(call)).toBe(
      "<12番のお客様、><提供口までお越しください。>",
    );
    expect(fetchMock).toHaveBeenCalledTimes(4);

    // 全部溜まっていれば ElevenLabs を呼ばない
    const again = await handleCallVoice(
      get("/call-voice/call?order=12"),
      env,
      context().ctx,
    );
    expect(again.headers.get("x-call-voice-cache")).toBe("hit");
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  test("鍵が無ければ、溜めていない片は作れないので 503", async () => {
    vi.stubGlobal("fetch", elevenLabs());
    const res = await handleCallVoice(
      get("/call-voice/call?order=3"),
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
      get("/call-voice/call?order=3"),
      { CALL_VOICES: bucket, ELEVENLABS_API_KEY: "key" },
      context().ctx,
    );

    expect(res.status).toBe(502);
    expect(put).not.toHaveBeenCalled();
  });

  test("ElevenLabs から返事が来なければ打ち切って 504 で、溜めない", async () => {
    const { bucket, put } = memoryBucket();
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      expect(init.signal).toBeInstanceOf(AbortSignal);
      throw new DOMException("The operation timed out.", "TimeoutError");
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await handleCallVoice(
      get("/call-voice/call?order=3"),
      { CALL_VOICES: bucket, ELEVENLABS_API_KEY: "key" },
      context().ctx,
    );

    expect(res.status).toBe(504);
    expect(fetchMock).toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  test("決まりに合わない URL・GET 以外は断り、ElevenLabs を呼ばない", async () => {
    const fetchMock = elevenLabs();
    vi.stubGlobal("fetch", fetchMock);
    const env = { CALL_VOICES: memoryBucket().bucket, ELEVENLABS_API_KEY: "k" };

    const bad = await handleCallVoice(
      get("/call-voice/call?order=abc"),
      env,
      context().ctx,
    );
    expect(bad.status).toBe(404);
    const post = new Request("https://pos.example/call-voice/call?order=1", {
      method: "POST",
    });
    expect((await handleCallVoice(post, env, context().ctx)).status).toBe(405);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
