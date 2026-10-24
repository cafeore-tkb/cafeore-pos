import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
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
  callVoiceCacheKey,
  callVoiceRequestBody,
  callVoiceSegments,
} from "../worker/call-voice";
import { callVoice, createWebServer } from "./app";
import { loadStaticFiles, parseRange } from "./static";

// サーバーに話しかけるのは本物の fetch。ElevenLabs の代わりは vi.stubGlobal で差し替える
const realFetch = globalThis.fetch;

const INDEX = "<!doctype html><title>POS</title>";
// 圧縮される大きさ（1 KiB 以上）にしておく
const SCRIPT = `console.log(${JSON.stringify("x".repeat(4000))});`;
const VIDEO = new Uint8Array(1000).map((_, i) => i % 256);

let dir: string;
let root: string;
let server: http.Server;
let origin: string;
let env: CallVoiceEnv;

const listen = async (s: http.Server) => {
  await new Promise<void>((resolve) => s.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
};

const get = (pathname: string, init?: RequestInit) =>
  realFetch(`${origin}${pathname}`, init);

/** fetch は .. をほどいてしまうので、パスをそのまま送る */
const rawGet = (pathname: string) =>
  new Promise<{ status: number; body: string }>((resolve, reject) => {
    const { hostname, port } = new URL(origin);
    http
      .get({ hostname, port, path: pathname }, (res) => {
        let body = "";
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      })
      .on("error", reject);
  });

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "pos-web-"));
  root = path.join(dir, "client");
  await mkdir(path.join(root, "assets"), { recursive: true });
  await mkdir(path.join(root, "images"), { recursive: true });
  await writeFile(path.join(root, "index.html"), INDEX);
  await writeFile(path.join(root, "assets", "app-1a2b3c.js"), SCRIPT);
  await writeFile(path.join(root, "images", "lotus.svg"), "<svg/>");
  await writeFile(path.join(root, "callscreen-cm.mp4"), VIDEO);
  await writeFile(path.join(root, ".env"), "SECRET=1");
  // build/client の外
  await writeFile(path.join(dir, "secret.txt"), "secret");

  env = {};
  server = createWebServer({ files: await loadStaticFiles(root), env });
  origin = await listen(server);
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await rm(dir, { recursive: true, force: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  env.CALL_VOICES = undefined;
  env.ELEVENLABS_API_KEY = undefined;
});

describe("[unit] web のサーバー: 静的ファイル", () => {
  test("index.html は no-cache で返す", async () => {
    for (const pathname of ["/", "/index.html"]) {
      const res = await get(pathname);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
      expect(res.headers.get("cache-control")).toBe("no-cache");
      expect(await res.text()).toBe(INDEX);
    }
  });

  test("画面の URL は SPA として index.html を返す", async () => {
    for (const pathname of ["/cashier", "/products?tab=items", "/items/x/y"]) {
      const res = await get(pathname);
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-cache");
      expect(await res.text()).toBe(INDEX);
    }
  });

  test("ファイルらしいパスで無いものと /assets/ の下で無いものは 404 で、覚えさせない", async () => {
    for (const pathname of [
      "/assets/app-old.js",
      "/assets/no-extension",
      "/favicon.png",
      "/images/missing.svg",
    ]) {
      const res = await get(pathname);
      expect(res.status, pathname).toBe(404);
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
  });

  test("/assets/ は 1 年 immutable、それ以外のファイルは no-cache", async () => {
    const asset = await get("/assets/app-1a2b3c.js");
    expect(asset.status).toBe(200);
    expect(asset.headers.get("content-type")).toBe(
      "text/javascript; charset=utf-8",
    );
    expect(asset.headers.get("cache-control")).toBe(
      "private, max-age=31536000, immutable",
    );
    expect(await asset.text()).toBe(SCRIPT);

    const image = await get("/images/lotus.svg");
    expect(image.headers.get("content-type")).toBe("image/svg+xml");
    expect(image.headers.get("cache-control")).toBe("no-cache");
  });

  test("ETag が合えば 304", async () => {
    const first = await get("/");
    const etag = first.headers.get("etag");
    expect(etag).toMatch(/^"[\w-]+"$/);
    const again = await get("/cashier", {
      headers: { "if-none-match": etag ?? "" },
    });
    expect(again.status).toBe(304);
    expect(again.headers.get("cache-control")).toBe("no-cache");
  });

  test("テキストは受け付けていれば br か gzip で返し、受け付けなければそのまま", async () => {
    const br = await get("/assets/app-1a2b3c.js", {
      headers: { "accept-encoding": "gzip, br" },
    });
    expect(br.headers.get("content-encoding")).toBe("br");
    expect(br.headers.get("vary")).toBe("accept-encoding");
    // fetch がほどいてくれる
    expect(await br.text()).toBe(SCRIPT);

    const gzip = await get("/assets/app-1a2b3c.js", {
      headers: { "accept-encoding": "gzip, br;q=0" },
    });
    expect(gzip.headers.get("content-encoding")).toBe("gzip");
    expect(gzip.headers.get("etag")).not.toBe(br.headers.get("etag"));
    expect(await gzip.text()).toBe(SCRIPT);

    const plain = await get("/assets/app-1a2b3c.js", {
      headers: { "accept-encoding": "identity" },
    });
    expect(plain.headers.get("content-encoding")).toBe(null);
    expect(plain.headers.get("content-length")).toBe(String(SCRIPT.length));
    expect(await plain.text()).toBe(SCRIPT);
  });

  test("動画は Range に 206 で応える", async () => {
    const res = await get("/callscreen-cm.mp4", {
      headers: { range: "bytes=10-19" },
    });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-type")).toBe("video/mp4");
    expect(res.headers.get("content-range")).toBe("bytes 10-19/1000");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(
      VIDEO.slice(10, 20),
    );

    const outside = await get("/callscreen-cm.mp4", {
      headers: { range: "bytes=1000-" },
    });
    expect(outside.status).toBe(416);
    expect(outside.headers.get("content-range")).toBe("bytes */1000");
  });

  test("Range の読み方", () => {
    expect(parseRange("bytes=0-", 10)).toEqual({ start: 0, end: 9 });
    expect(parseRange("bytes=-3", 10)).toEqual({ start: 7, end: 9 });
    expect(parseRange("bytes=5-100", 10)).toEqual({ start: 5, end: 9 });
    expect(parseRange("bytes=9-5", 10)).toBe("unsatisfiable");
    // 複数の範囲や読めないものは無視して全部を返す
    expect(parseRange("bytes=0-1,3-4", 10)).toBe(null);
    expect(parseRange("items=0-1", 10)).toBe(null);
    expect(parseRange(undefined, 10)).toBe(null);
  });

  test("HEAD は本文を返さない。GET と HEAD 以外は 405", async () => {
    const head = await get("/", { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.headers.get("content-length")).not.toBe(null);
    expect(await head.text()).toBe("");

    const post = await get("/cashier", { method: "POST" });
    expect(post.status).toBe(405);
    expect(post.headers.get("allow")).toBe("GET, HEAD");
  });

  test("build/client の外と . で始まるものは返さない", async () => {
    for (const pathname of [
      "/../secret.txt",
      "/assets/../../secret.txt",
      "/assets/..%2F..%2Fsecret.txt",
      "/%2e%2e/secret.txt",
      "/.env",
    ]) {
      const res = await rawGet(pathname);
      expect(res.status, pathname).toBe(404);
      expect(res.body).not.toContain("secret");
      expect(res.body).not.toContain("SECRET");
    }
  });

  test("index.html が無ければ起動させない", async () => {
    const empty = await mkdtemp(path.join(tmpdir(), "pos-web-empty-"));
    await expect(loadStaticFiles(empty)).rejects.toThrow(/index.html/);
    await rm(empty, { recursive: true, force: true });
  });
});

describe("[unit] web のサーバー: そのほかの経路", () => {
  test("/session-check は 204 で、覚えさせない", async () => {
    const res = await get("/session-check");
    expect(res.status).toBe(204);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect((await get("/session-check", { method: "POST" })).status).toBe(405);
  });

  test("API のパスは中継せず、index.html も返さずに 404", async () => {
    for (const pathname of ["/api", "/api/items", "/status", "/health"]) {
      const res = await get(pathname);
      expect(res.status, pathname).toBe(404);
      expect(res.headers.get("content-type")).toContain("application/json");
      expect(await res.text()).not.toContain("<!doctype html>");
    }
  });
});

describe("[unit] web のサーバー: /call-voice", () => {
  const audioOf = (text: string) =>
    new TextEncoder().encode(`<${text}>`).buffer;

  /** ElevenLabs の代わり。送られた文の片をそのまま音声にして返す */
  const elevenLabs = () =>
    vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      const text: string = body.inputs[0].text;
      return new Response(
        audioOf(text.replace("[スムーズなナレーターで]", "")),
        {
          headers: { "content-type": "audio/mpeg" },
        },
      );
    });

  /** 溜めるのに時間が掛かるバケット。溜め終わったものを stored に入れる */
  const slowBucket = () => {
    const stored = new Map<string, ArrayBuffer>();
    const bucket: CallVoiceBucket = {
      get: async (key) => {
        const value = stored.get(key);
        return value ? { arrayBuffer: async () => value } : null;
      },
      put: async (key, value) => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        stored.set(key, value);
      },
    };
    return { bucket, stored };
  };

  test("handleCallVoice をそのまま使い、溜め終わってから返す", async () => {
    vi.stubGlobal("fetch", elevenLabs());
    const { bucket, stored } = slowBucket();
    env.CALL_VOICES = bucket;
    env.ELEVENLABS_API_KEY = "key";

    const res = await get("/call-voice/call?order=12");
    // 応答が来た時点で、作った片はもう溜まっている
    expect(stored.size).toBe(2);
    expect(
      stored.has(
        await callVoiceCacheKey(
          callVoiceRequestBody(callVoiceSegments.callTail),
        ),
      ),
    ).toBe(true);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/mpeg");
    expect(res.headers.get("x-call-voice-cache")).toBe("miss");
    expect(new TextDecoder().decode(await res.arrayBuffer())).toBe(
      "<じゅうに番のお客様、><提供口までお越しください。>",
    );

    // 溜まっていれば ElevenLabs を呼ばない
    const again = await get("/call-voice/call?order=12");
    expect(again.headers.get("x-call-voice-cache")).toBe("hit");
  });

  test("溜めるのに失敗しても音声は返す", async () => {
    vi.stubGlobal("fetch", elevenLabs());
    vi.spyOn(console, "error").mockImplementation(() => {});
    env.CALL_VOICES = {
      get: async () => null,
      put: async () => {
        throw new Error("GCS が落ちている");
      },
    };
    env.ELEVENLABS_API_KEY = "key";

    const res = await get("/call-voice/recall?order=3");
    expect(res.status).toBe(200);
    expect(res.headers.get("x-call-voice-cache")).toBe("miss");
  });

  test("waitUntil に渡されたものを全部待つ", async () => {
    vi.stubGlobal("fetch", elevenLabs());
    const order: string[] = [];
    env.CALL_VOICES = {
      get: async () => null,
      put: async (key) => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        order.push(key);
      },
    };
    env.ELEVENLABS_API_KEY = "key";

    await callVoice(
      new Request(
        "https://pos.example/call-voice/drip?order=1&order=2&dripper=3",
      ),
      env,
    );
    order.push("response");
    // 片は 4 つ（番号 2 つ・ドリッパー・括弧の中）
    expect(order).toHaveLength(5);
    expect(order.at(-1)).toBe("response");
  });

  test("決まりに合わない URL・GET 以外は handleCallVoice のとおり断る", async () => {
    const fetchMock = elevenLabs();
    vi.stubGlobal("fetch", fetchMock);
    env.ELEVENLABS_API_KEY = "key";
    expect((await get("/call-voice/call?order=abc")).status).toBe(404);
    expect(
      (await get("/call-voice/call?order=1", { method: "POST" })).status,
    ).toBe(405);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
