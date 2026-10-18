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
    vi.restoreAllMocks();
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

  test("緊急の取り消しの知らせを受けたタブが消すと、同じ端末のほかのタブが残したそのシールも消える。ほかのシールは残る", async () => {
    vi.stubGlobal("localStorage", fakeStorage());
    const printing = await load();
    printing.addPendingPrint(job, "emergency-1");
    printing.addPendingPrint(job, "emergency-2");
    vi.resetModules();
    const other = await load();
    other.cancelPendingPrint("emergency-1");

    expect(printing.readPendingPrints().map((p) => p.id)).toEqual([
      "emergency-2",
    ]);
  });

  test("取り消しの知らせのあとで刷れなかったシール（刷っている間に取り消された）は残さない", async () => {
    vi.stubGlobal("localStorage", fakeStorage());
    const { addPendingPrint, cancelPendingPrint, readPendingPrints } =
      await load();
    cancelPendingPrint("emergency-1");
    addPendingPrint(job, "emergency-1");
    addPendingPrint(job, "emergency-2");

    expect(readPendingPrints().map((p) => p.id)).toEqual(["emergency-2"]);
  });

  test("代理印刷の完了で同じIDの未印刷を消し、遅れて直接印刷が失敗しても残し直さない", async () => {
    vi.stubGlobal("localStorage", fakeStorage());
    const {
      addPendingPrint,
      completePendingPrint,
      readPendingPrints,
      isPrintSettled,
    } = await load();
    addPendingPrint(job, "emergency-1");
    addPendingPrint(job, "emergency-2");
    completePendingPrint("emergency-1");
    addPendingPrint(job, "emergency-1");
    expect(isPrintSettled("emergency-1")).toBe(true);
    expect(readPendingPrints().map((p) => p.id)).toEqual(["emergency-2"]);
  });

  test("別タブでも完了済みIDを読めて、遅れて失敗したシールを残さない", async () => {
    vi.stubGlobal("localStorage", fakeStorage());
    const first = await load();
    first.completePendingPrint("emergency-1");
    vi.resetModules();
    const other = await load();
    other.addPendingPrint(job, "emergency-1");
    expect(other.isPrintSettled("emergency-1")).toBe(true);
    expect(other.readPendingPrints()).toEqual([]);
  });

  test("完了記録は1時間で無効になり、次の完了処理で保存先から削除される", async () => {
    const storage = fakeStorage();
    vi.stubGlobal("localStorage", storage);
    const clock = vi.spyOn(Date, "now").mockReturnValue(1_000);
    const prints = await load();
    prints.completePendingPrint("emergency-1");
    clock.mockReturnValue(1_000 + prints.COMPLETED_PRINT_TTL_MS - 1);
    expect(prints.isPrintSettled("emergency-1")).toBe(true);
    clock.mockReturnValue(1_000 + prints.COMPLETED_PRINT_TTL_MS);
    expect(prints.isPrintSettled("emergency-1")).toBe(false);
    prints.completePendingPrint("emergency-2");
    expect(storage.length).toBe(1);
  });

  test("ストレージが使えなくても完了記録はメモリに残し、1時間で無効になる", async () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("SecurityError");
      },
      removeItem: () => {},
    });
    const clock = vi.spyOn(Date, "now").mockReturnValue(1_000);
    const prints = await load();
    prints.completePendingPrint("emergency-1");
    expect(prints.isPrintSettled("emergency-1")).toBe(true);
    clock.mockReturnValue(1_000 + prints.COMPLETED_PRINT_TTL_MS);
    expect(prints.isPrintSettled("emergency-1")).toBe(false);
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

  test("書けなくなってから同じ id を置き直したら、メモリのほうを 1 件だけ読む", async () => {
    const storage = fakeStorage();
    vi.stubGlobal("localStorage", storage);
    const { addPendingPrint, readPendingPrints } = await load();
    addPendingPrint(job, "emergency-1");
    storage.setItem = () => {
      throw new Error("QuotaExceededError");
    };
    const other: PrintJob = { labels: [] };
    addPendingPrint(other, "emergency-1");

    expect(readPendingPrints().map((p) => [p.id, p.job])).toEqual([
      ["emergency-1", other],
    ]);
  });
});
