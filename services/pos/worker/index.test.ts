import { describe, expect, test, vi } from "vitest";
import worker from "./index";

const env = () => ({
  ASSETS: { fetch: vi.fn(async () => new Response("<!doctype html>")) },
});
const ctx = { waitUntil: () => {} };

describe("[unit] Worker: ログインしている相手", () => {
  test("Workers にはログインが無いので、index.html ではなく null を返す", async () => {
    const assets = env();
    const res = await worker.fetch(
      new Request("https://pos-cf.cafeore.cafe/auth/me"),
      assets,
      ctx,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ email: null });
    expect(assets.ASSETS.fetch).not.toHaveBeenCalled();
  });
});
