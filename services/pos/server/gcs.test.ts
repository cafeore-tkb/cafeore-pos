import { afterEach, describe, expect, test, vi } from "vitest";
import { gcsBucket, multipartBody } from "./gcs";

const TOKEN_URL =
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token";
const KEY = "call-voice/0123abcd.mp3";
const OBJECT_URL =
  "https://storage.googleapis.com/storage/v1/b/cafeore-call-voices/o/call-voice%2F0123abcd.mp3?alt=media";
const UPLOAD_URL =
  "https://storage.googleapis.com/upload/storage/v1/b/cafeore-call-voices/o?uploadType=multipart&ifGenerationMatch=0";

const audio = () => new TextEncoder().encode("<音声>").buffer;

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;

/** メタデータサーバーと GCS の代わり。GCS へのリクエストは handler に任せる */
const gcs = (handler: Handler, tokens = ["token-1", "token-2"]) => {
  let issued = 0;
  const fetchMock = vi.fn(async (input: string, init: RequestInit) => {
    if (input === TOKEN_URL) {
      expect(new Headers(init.headers).get("metadata-flavor")).toBe("Google");
      return Response.json({
        access_token: tokens[issued++],
        expires_in: 3599,
        token_type: "Bearer",
      });
    }
    return handler(input, init);
  });
  vi.stubGlobal("fetch", fetchMock);
  const gcsCalls = () =>
    fetchMock.mock.calls.filter(([url]) => url !== TOKEN_URL);
  return {
    fetchMock,
    gcsCalls,
    tokenCalls: () => fetchMock.mock.calls.length - gcsCalls().length,
  };
};

const authOf = (init: RequestInit) =>
  new Headers(init.headers).get("authorization");

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("[unit] 呼び出しの音声の GCS のバケット", () => {
  test("溜めてあれば中身を返し、無ければ null", async () => {
    const { gcsCalls } = gcs((url) =>
      url === OBJECT_URL
        ? new Response(audio(), { headers: { "content-type": "audio/mpeg" } })
        : Response.json({ error: { code: 404 } }, { status: 404 }),
    );
    const bucket = gcsBucket("cafeore-call-voices");

    const hit = await bucket.get(KEY);
    expect(
      new Uint8Array((await hit?.arrayBuffer()) ?? new ArrayBuffer(0)),
    ).toEqual(new Uint8Array(audio()));
    expect(await bucket.get("call-voice/missing.mp3")).toBe(null);

    const [url, init] = gcsCalls()[0];
    expect(url).toBe(OBJECT_URL);
    expect(authOf(init)).toBe("Bearer token-1");
  });

  test("トークンは期限まで使い回し、同時に頼まれても 1 回だけ取りに行く", async () => {
    const { tokenCalls } = gcs(() => new Response(null, { status: 404 }));
    const bucket = gcsBucket("cafeore-call-voices");

    await Promise.all([bucket.get(KEY), bucket.get(KEY), bucket.get(KEY)]);
    await bucket.get(KEY);
    expect(tokenCalls()).toBe(1);
  });

  test("GCS が 401 を返したら、次はトークンを取り直す", async () => {
    let first = true;
    const { gcsCalls } = gcs(() => {
      if (first) {
        first = false;
        return new Response("expired", { status: 401 });
      }
      return new Response(null, { status: 404 });
    });
    const bucket = gcsBucket("cafeore-call-voices");

    await expect(bucket.get(KEY)).rejects.toThrow(/401/);
    expect(await bucket.get(KEY)).toBe(null);
    expect(authOf(gcsCalls()[1][1])).toBe("Bearer token-2");
  });

  test("読めなければ投げる（call-voice.ts がログに残して ElevenLabs で作る）", async () => {
    gcs(() => new Response("boom", { status: 500 }));
    await expect(gcsBucket("cafeore-call-voices").get(KEY)).rejects.toThrow(
      /500/,
    );
  });

  test("メタデータサーバーに届かなければ投げる", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    await expect(gcsBucket("cafeore-call-voices").get(KEY)).rejects.toThrow(
      "fetch failed",
    );
  });

  test("multipart で、中身と何の文の音声かを 1 回で溜める。無いときだけ作る", async () => {
    const { gcsCalls } = gcs(() => Response.json({ name: KEY }));
    const text = encodeURIComponent("じゅうに番のお客様、");

    await gcsBucket("cafeore-call-voices").put(KEY, audio(), {
      httpMetadata: { contentType: "audio/mpeg" },
      customMetadata: { text },
    });

    const [url, init] = gcsCalls()[0];
    expect(url).toBe(UPLOAD_URL);
    expect(init.method).toBe("POST");
    expect(authOf(init)).toBe("Bearer token-1");
    const type = new Headers(init.headers).get("content-type") ?? "";
    const boundary = /^multipart\/related; boundary=(.+)$/.exec(type)?.[1];
    expect(boundary).toBeTruthy();

    const body = new TextDecoder().decode(init.body as Uint8Array);
    const parts = body.split(`--${boundary}`);
    // 頭の空・メタデータ・中身・尻の "--\r\n"
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe("");
    expect(parts[3]).toBe("--\r\n");
    const [metaHead, metaJson] = parts[1].split("\r\n\r\n");
    expect(metaHead).toBe("\r\nContent-Type: application/json; charset=UTF-8");
    expect(JSON.parse(metaJson)).toEqual({
      name: KEY,
      contentType: "audio/mpeg",
      metadata: { text },
    });
    const [mediaHead, media] = parts[2].split("\r\n\r\n");
    expect(mediaHead).toBe("\r\nContent-Type: audio/mpeg");
    expect(media).toBe("<音声>\r\n");
  });

  test("もう同じ鍵のものがあれば（412）、溜まっているので成功とみなす", async () => {
    gcs(() => new Response("precondition", { status: 412 }));
    await expect(
      gcsBucket("cafeore-call-voices").put(KEY, audio()),
    ).resolves.toBeUndefined();
  });

  test("溜められなければ投げる（call-voice.ts がログに残す）", async () => {
    gcs(() => new Response("forbidden", { status: 403 }));
    await expect(
      gcsBucket("cafeore-call-voices").put(KEY, audio()),
    ).rejects.toThrow(/403/);
  });

  test("multipart の区切りは中身に現れないものにする", () => {
    const randomUUID = vi
      .spyOn(crypto, "randomUUID")
      .mockReturnValueOnce("0-0-0-0-0")
      .mockReturnValueOnce("1-1-1-1-1");
    const media = new TextEncoder().encode("xx call-voice-0-0-0-0-0 xx").buffer;
    const { contentType } = multipartBody({ name: "a" }, media, "audio/mpeg");
    expect(contentType).toBe(
      "multipart/related; boundary=call-voice-1-1-1-1-1",
    );
    expect(randomUUID).toHaveBeenCalledTimes(2);
  });
});
