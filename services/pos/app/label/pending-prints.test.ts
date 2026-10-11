import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { PrintJob } from "./document";

const job: PrintJob = { labels: [{ type: "flow", lines: [] }] };

// 覚えている値（memory）がモジュールにあるので、毎回読み込み直す
const load = () => import("./pending-prints");

const fakeStorage = () => {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  };
};

describe("[unit] pending-prints", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("window", {
      addEventListener: () => {},
      removeEventListener: () => {},
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("localStorage に残し、読み込み直しても残っている。消したものは消える", async () => {
    vi.stubGlobal("localStorage", fakeStorage());
    const first = await load();
    first.addPendingPrint(job);
    first.addPendingPrint(job);
    const [kept, removed] = first.readPendingPrints();
    first.removePendingPrint(removed.id);

    vi.resetModules();
    const reopened = await load();
    expect(reopened.readPendingPrints()).toEqual([kept]);
    expect(kept.job).toEqual(job);
  });

  test("変わったら知らせる", async () => {
    vi.stubGlobal("localStorage", fakeStorage());
    const { addPendingPrint, subscribePendingPrints } = await load();
    const listener = vi.fn();
    const unsubscribe = subscribePendingPrints(listener);
    addPendingPrint(job);
    unsubscribe();
    addPendingPrint(job);

    expect(listener).toHaveBeenCalledTimes(1);
  });

  test("localStorage が使えなければメモリだけで持つ", async () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("SecurityError");
      },
    });
    const { addPendingPrint, readPendingPrints, removePendingPrint } =
      await load();
    addPendingPrint(job);
    addPendingPrint(job);
    removePendingPrint(readPendingPrints()[0].id);

    expect(readPendingPrints()).toHaveLength(1);
  });

  test("書けなくなったら、書いてあったものを消してメモリに移る", async () => {
    const storage = fakeStorage();
    vi.stubGlobal("localStorage", storage);
    const { addPendingPrint, readPendingPrints } = await load();
    addPendingPrint(job);
    storage.setItem = () => {
      throw new Error("QuotaExceededError");
    };
    addPendingPrint(job);

    expect(readPendingPrints()).toHaveLength(2);
    expect(storage.getItem("cafeore:pending-label-prints")).toBeNull();
  });
});
