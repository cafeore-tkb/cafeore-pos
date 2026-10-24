import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { type Server, createServer, request } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brotliCompressSync, gzipSync } from "node:zlib";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import {
  type CallVoiceBucket,
  type CallVoiceEnv,
  callAnnouncement,
  callVoiceCacheKey,
  callVoiceRequestBody,
} from "../worker/call-voice";
import { createApp } from "./app";
import {
  IMMUTABLE_CACHE,
  REVALIDATE_CACHE,
  acceptsEncoding,
  shouldFallbackToIndex,
} from "./static-files";

const INDEX_HTML = "<!doctype html><title>POS</title>";
const APP_JS = `console.log(${JSON.stringify("x".repeat(2000))});`;
// 0〜255 を繰り返す 1000 バイト（Range の確かめ用の動画の代わり）
const VIDEO = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 256));
const SECRET = "build/client の外にあるもの";

interface Reply {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
}

let dir: string;
let root: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "pos-web-"));
  root = join(dir, "client");
  await mkdir(join(root, "assets"), { recursive: true });
  await writeFile(join(root, "index.html"), INDEX_HTML);
  await writeFile(join(root, "assets", "app-abc123.js"), APP_JS);
  await writeFile(
    join(root, "assets", "app-abc123.js.br"),
    brotliCompressSync(APP_JS),
  );
  await writeFile(join(root, "assets", "app-abc123.js.gz"), gzipSync(APP_JS));
  await writeFile(join(root, "video.mp4"), VIDEO);
  await writeFile(join(root, "epos.js"), "window.epson = {};");
  await writeFile(join(root, ".env"), SECRET);
  await writeFile(join(dir, "secret.txt"), SECRET);
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

type Send = (
  path: string,
  headers?: Record<string, string>,
  method?: string,
) => Promise<Reply>;

/** サーバーを立てて、終わったら閉じる */
const withServer = async (
  callVoice: CallVoiceEnv,
  run: (send: Send) => Promise<void>,
  waitUntilTimeoutMs?: number,
) => {
  const server = createServer(
    createApp({ root, callVoice, waitUntilTimeoutMs }),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await run((...args) => sendTo(server, ...args));
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
};

/** fetch は Accept-Encoding や Sec-Fetch-Mode を勝手に付けるので、node:http で送る */
const sendTo = (
  server: Server,
  path: string,
  headers: Record<string, string> = {},
  method = "GET",
): Promise<Reply> =>
  new Promise((resolve, reject) => {
    const { port } = server.address() as AddressInfo;
    const req = request(
      { host: "127.0.0.1", port, path, method, headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks),
          }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });

const NAVIGATE = {
  accept: "text/html,application/xhtml+xml,*/*;q=0.8",
  "sec-fetch-mode": "navigate",
};

describe("[unit] Cloud Run の画面のサーバー: 静的ファイル", () => {
  test("あるファイルはそのまま返し、ハッシュ付きのものは 1 年持たせる", async () => {
    await withServer({}, async (send) => {
      const res = await send("/assets/app-abc123.js");
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/javascript/);
      expect(res.headers["cache-control"]).toBe(IMMUTABLE_CACHE);
      expect(res.headers.etag).toBeTruthy();
      expect(res.headers["last-modified"]).toBeTruthy();
      expect(res.body.toString()).toBe(APP_JS);
    });
  });

  test("/ と、ハッシュの無いファイルは毎回確かめさせる", async () => {
    await withServer({}, async (send) => {
      const index = await send("/", NAVIGATE);
      expect(index.status).toBe(200);
      expect(index.headers["content-type"]).toBe("text/html; charset=utf-8");
      expect(index.headers["cache-control"]).toBe(REVALIDATE_CACHE);
      expect(index.body.toString()).toBe(INDEX_HTML);

      const epos = await send("/epos.js");
      expect(epos.status).toBe(200);
      expect(epos.headers["cache-control"]).toBe(REVALIDATE_CACHE);
    });
  });

  test("画面のパス（/cashier など）は index.html を 200 で返す", async () => {
    await withServer({}, async (send) => {
      const cases: Record<string, string>[] = [NAVIGATE, { accept: "*/*" }, {}];
      for (const headers of cases) {
        const res = await send("/cashier", headers);
        expect(res.status).toBe(200);
        expect(res.headers["content-type"]).toBe("text/html; charset=utf-8");
        expect(res.headers["cache-control"]).toBe(REVALIDATE_CACHE);
        expect(res.body.toString()).toBe(INDEX_HTML);
      }
      const deep = await send("/master-sheet/orders/12?tab=1", NAVIGATE);
      expect(deep.body.toString()).toBe(INDEX_HTML);
    });
  });

  test("/assets/ の下に無いものは、画面を開くリクエストでも 404 にする（index.html を返さない）", async () => {
    await withServer({}, async (send) => {
      for (const headers of [{}, NAVIGATE]) {
        const res = await send("/assets/old-chunk-zzz.js", headers);
        expect(res.status).toBe(404);
        expect(res.headers["content-type"]).not.toMatch(/html/);
        expect(res.headers["cache-control"]).toBe("no-store");
      }
    });
  });

  test("ブラウザが勝手に取りに来るファイル（. のあるパス）は、無ければ 404", async () => {
    await withServer({}, async (send) => {
      const icon = await send("/apple-touch-icon.png", { accept: "image/*" });
      expect(icon.status).toBe(404);
      // 画面として開いたときは index.html（SPA の 404 の画面を出す）
      const navigated = await send("/apple-touch-icon.png", NAVIGATE);
      expect(navigated.status).toBe(200);
      expect(navigated.body.toString()).toBe(INDEX_HTML);
    });
  });

  test("/api・/status・/health は中継せず、JSON の 404 を返す", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await withServer({}, async (send) => {
      for (const [path, method] of [
        ["/api/orders", "GET"],
        ["/api/orders", "POST"],
        ["/api", "GET"],
        ["/status", "GET"],
        ["/health", "GET"],
      ]) {
        const res = await send(path, NAVIGATE, method);
        expect(res.status).toBe(404);
        expect(res.headers["content-type"]).toBe(
          "application/json; charset=utf-8",
        );
        expect(JSON.parse(res.body.toString())).toHaveProperty("error");
      }
    });
    // 来るはずのないものなので、ログに残して気づけるようにする
    expect(warn).toHaveBeenCalledTimes(5);
  });

  test("Range で一部だけを返す（Safari の動画）", async () => {
    await withServer({}, async (send) => {
      const full = await send("/video.mp4");
      expect(full.status).toBe(200);
      expect(full.headers["accept-ranges"]).toBe("bytes");
      expect(full.headers["content-type"]).toBe("video/mp4");

      const probe = await send("/video.mp4", { range: "bytes=0-1" });
      expect(probe.status).toBe(206);
      expect(probe.headers["content-range"]).toBe("bytes 0-1/1000");
      expect(probe.headers["content-length"]).toBe("2");
      expect([...probe.body]).toEqual([0, 1]);

      const middle = await send("/video.mp4", { range: "bytes=300-" });
      expect(middle.status).toBe(206);
      expect(middle.headers["content-range"]).toBe("bytes 300-999/1000");
      expect(middle.body.equals(VIDEO.subarray(300))).toBe(true);

      const suffix = await send("/video.mp4", { range: "bytes=-10" });
      expect(suffix.headers["content-range"]).toBe("bytes 990-999/1000");
      expect(suffix.body.equals(VIDEO.subarray(990))).toBe(true);

      const outside = await send("/video.mp4", { range: "bytes=5000-" });
      expect(outside.status).toBe(416);
      expect(outside.headers["content-range"]).toBe("bytes */1000");
    });
  });

  test("ETag が合えば 304 を返す。HEAD は本文を返さない", async () => {
    await withServer({}, async (send) => {
      const first = await send("/assets/app-abc123.js");
      const etag = first.headers.etag as string;
      const again = await send("/assets/app-abc123.js", {
        "if-none-match": etag,
      });
      expect(again.status).toBe(304);
      expect(again.body.byteLength).toBe(0);
      expect(again.headers["cache-control"]).toBe(IMMUTABLE_CACHE);

      const head = await send("/video.mp4", {}, "HEAD");
      expect(head.status).toBe(200);
      expect(head.headers["content-length"]).toBe("1000");
      expect(head.body.byteLength).toBe(0);
    });
  });

  test("圧縮版があれば Accept-Encoding に合わせて返す", async () => {
    await withServer({}, async (send) => {
      const br = await send("/assets/app-abc123.js", {
        "accept-encoding": "gzip, deflate, br",
      });
      expect(br.headers["content-encoding"]).toBe("br");
      expect(br.headers["content-type"]).toMatch(/javascript/);
      expect(br.headers.vary).toBe("Accept-Encoding");
      expect(br.headers["cache-control"]).toBe(IMMUTABLE_CACHE);
      expect(br.body.equals(brotliCompressSync(APP_JS))).toBe(true);

      const gz = await send("/assets/app-abc123.js", {
        "accept-encoding": "br;q=0, gzip",
      });
      expect(gz.headers["content-encoding"]).toBe("gzip");

      const plain = await send("/assets/app-abc123.js");
      expect(plain.headers["content-encoding"]).toBeUndefined();
      expect(plain.headers.vary).toBe("Accept-Encoding");
      expect(plain.body.toString()).toBe(APP_JS);
    });
  });

  test("build/client の外やドットファイルは返さない", async () => {
    await withServer({}, async (send) => {
      for (const path of [
        "/../secret.txt",
        "/..%2fsecret.txt",
        "/assets/..%2f..%2fsecret.txt",
        "/%2e%2e/secret.txt",
        "/.env",
      ]) {
        const res = await send(path);
        expect(res.body.toString()).not.toContain(SECRET);
      }
      expect((await send("/.env")).status).toBe(404);
    });
  });

  test("GET・HEAD 以外は受け付けない", async () => {
    await withServer({}, async (send) => {
      const res = await send("/cashier", {}, "POST");
      expect(res.status).toBe(405);
      expect(res.headers.allow).toBe("GET, HEAD");
    });
  });
});

describe("[unit] Cloud Run の画面のサーバー: 無いパスの扱い", () => {
  test("index.html を返すのは /assets の外で、画面を開くか . の無いパス", () => {
    expect(shouldFallbackToIndex("/cashier", {})).toBe(true);
    expect(shouldFallbackToIndex("/cashier", NAVIGATE)).toBe(true);
    expect(shouldFallbackToIndex("/robots.txt", {})).toBe(false);
    expect(shouldFallbackToIndex("/robots.txt", NAVIGATE)).toBe(true);
    expect(shouldFallbackToIndex("/assets/a.js", NAVIGATE)).toBe(false);
    expect(shouldFallbackToIndex("/assets/sub", {})).toBe(false);
  });

  test("Accept-Encoding の q=0 は断りとみなす", () => {
    expect(acceptsEncoding("gzip, br", "br")).toBe(true);
    expect(acceptsEncoding("gzip;q=1.0, br;q=0.5", "br")).toBe(true);
    expect(acceptsEncoding("br;q=0", "br")).toBe(false);
    expect(acceptsEncoding("gzip", "br")).toBe(false);
    expect(acceptsEncoding(undefined, "gzip")).toBe(false);
  });
});

// 片の音声の代わり（worker/call-voice.test.ts と同じ）
const audioOf = (text: string) => new TextEncoder().encode(`<${text}>`).buffer;
const keyOf = (segment: string) =>
  callVoiceCacheKey(callVoiceRequestBody(segment));

/** 中身を Map に持つバケット。put は gate が開くまで終わらない */
const memoryBucket = (initial: Record<string, ArrayBuffer> = {}) => {
  const store = new Map(Object.entries(initial));
  let open: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  let putCalled: () => void = () => {};
  const putStarted = new Promise<void>((resolve) => {
    putCalled = resolve;
  });
  const bucket: CallVoiceBucket = {
    get: async (key) => {
      const value = store.get(key);
      return value ? { arrayBuffer: async () => value } : null;
    },
    put: vi.fn(async (key: string, value: ArrayBuffer) => {
      putCalled();
      await gate;
      store.set(key, value);
    }),
  };
  return { bucket, store, open, putStarted };
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

describe("[unit] Cloud Run の画面のサーバー: 呼び出しの音声", () => {
  const segments = callAnnouncement(12, false);
  const expected = segments.map((segment) => `<${segment}>`).join("");

  test("溜めてあれば ElevenLabs を呼ばずに返す", async () => {
    const initial: Record<string, ArrayBuffer> = {};
    for (const segment of segments) {
      initial[await keyOf(segment)] = audioOf(segment);
    }
    const { bucket } = memoryBucket(initial);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await withServer({ CALL_VOICES: bucket }, async (send) => {
      const res = await send("/call-voice/call?order=12");
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toBe("audio/mpeg");
      expect(res.headers["x-call-voice-cache"]).toBe("hit");
      expect(res.headers["content-length"]).toBe(String(res.body.byteLength));
      expect(res.body.toString()).toBe(expected);
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("溜めていなければ作り、溜め終わってから返す（Cloud Run は返した後の CPU を絞る）", async () => {
    const { bucket, store, open, putStarted } = memoryBucket();
    vi.stubGlobal("fetch", elevenLabs());

    await withServer(
      { CALL_VOICES: bucket, ELEVENLABS_API_KEY: "key" },
      async (send) => {
        let replied = false;
        const reply = send("/call-voice/call?order=12").then((res) => {
          replied = true;
          return res;
        });
        await putStarted;
        // 溜め終わるまでは返さない
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(replied).toBe(false);

        open();
        const res = await reply;
        expect(res.status).toBe(200);
        expect(res.headers["x-call-voice-cache"]).toBe("miss");
        expect(res.body.toString()).toBe(expected);
        expect([...store.keys()].sort()).toEqual(
          (await Promise.all(segments.map(keyOf))).sort(),
        );
      },
    );
  });

  test("溜めるのが終わらなくても、上限まで待ったら返す", async () => {
    const { bucket, putStarted } = memoryBucket();
    vi.stubGlobal("fetch", elevenLabs());
    vi.spyOn(console, "error").mockImplementation(() => {});

    await withServer(
      { CALL_VOICES: bucket, ELEVENLABS_API_KEY: "key" },
      async (send) => {
        const res = await send("/call-voice/call?order=12");
        await putStarted;
        expect(res.status).toBe(200);
        expect(res.body.toString()).toBe(expected);
      },
      50,
    );
  });

  test("鍵もバケットも無ければ Worker と同じ 503、決まりに合わない URL は 404", async () => {
    await withServer({}, async (send) => {
      const res = await send("/call-voice/call?order=12");
      expect(res.status).toBe(503);
      expect(JSON.parse(res.body.toString())).toEqual({
        error: "ELEVENLABS_API_KEY が設定されていません",
      });
      expect((await send("/call-voice/call?order=abc")).status).toBe(404);
      expect((await send("/call-voice/call?order=12", {}, "POST")).status).toBe(
        405,
      );
    });
  });
});
