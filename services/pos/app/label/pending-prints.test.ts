import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { PrintJob } from "./document";

const job: PrintJob = { labels: [{ type: "flow", lines: [] }] };

// localStorage に書けなかったもの（memory）がモジュールにあるので、毎回読み込み直す
const load = () => import("./pending-prints");

const fakeStorage = () => {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    key: (i: number) => [...items.keys()][i] ?? null,
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

  test("localStorage に 1 件ずつ残し、読み込み直しても古い順に残っている。消したものは消える", async () => {
    const storage = fakeStorage();
    vi.stubGlobal("localStorage", storage);
    const first = await load();
    first.addPendingPrint(job);
    first.addPendingPrint(job);
    first.addPendingPrint(job);
    const [a, b, c] = first.readPendingPrints();
    first.removePendingPrint(b.id);

    vi.resetModules();
    const reopened = await load();
    expect(reopened.readPendingPrints().map((p) => p.id)).toEqual([a.id, c.id]);
    expect(storage.length).toBe(2);
    expect(a.job).toEqual(job);
  });

  test("id を渡すと、その id で残し、その id で消せる（取り消した緊急のシール）", async () => {
    vi.stubGlobal("localStorage", fakeStorage());
    const { addPendingPrint, readPendingPrints, removePendingPrint } =
      await load();
    addPendingPrint(job, "emergency-1");
    addPendingPrint(job);
    removePendingPrint("emergency-1");

    expect(readPendingPrints().map((p) => p.id)).not.toContain("emergency-1");
    expect(readPendingPrints()).toHaveLength(1);
  });

  test("壊れたもの・ほかのキーは読まない", async () => {
    const storage = fakeStorage();
    storage.setItem("cafeore:pending-label-print:x", "{");
    storage.setItem("cafeore:pending-label-print:y", '{"at":1,"job":{}}');
    storage.setItem("other", '{"at":1,"job":{"labels":[]}}');
    vi.stubGlobal("localStorage", storage);
    const { readPendingPrints } = await load();

    expect(readPendingPrints()).toEqual([]);
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
    const fail = () => {
      throw new Error("SecurityError");
    };
    vi.stubGlobal("localStorage", {
      get length() {
        return fail();
      },
      setItem: fail,
      removeItem: fail,
    });
    const { addPendingPrint, readPendingPrints, removePendingPrint } =
      await load();
    addPendingPrint(job);
    addPendingPrint(job);
    removePendingPrint(readPendingPrints()[0].id);

    expect(readPendingPrints()).toHaveLength(1);
  });

  test("書けなくなったら、そのあとの分はメモリに持ち、書いてあった分と合わせて読む", async () => {
    const storage = fakeStorage();
    vi.stubGlobal("localStorage", storage);
    const { addPendingPrint, readPendingPrints } = await load();
    addPendingPrint(job);
    storage.setItem = () => {
      throw new Error("QuotaExceededError");
    };
    addPendingPrint(job);

    expect(readPendingPrints()).toHaveLength(2);
    expect(storage.length).toBe(1);
  });
});
