import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createDeviceStore } from "./device-store";

type Entry = { id: string; at: number; sent?: boolean };
const parse = (id: string, value: unknown) => ({
  id,
  ...(value as Omit<Entry, "id">),
});
const openStore = () => createDeviceStore<Entry>("test:outbox:", parse);
const values = new Map<string, string>();
let writable = true;
beforeEach(() => {
  values.clear();
  writable = true;
  vi.stubGlobal("window", { addEventListener: vi.fn() });
  vi.stubGlobal("localStorage", {
    get length() {
      return values.size;
    },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (!writable) throw new Error("QuotaExceededError");
      values.set(key, value);
    },
    removeItem: (key: string) => values.delete(key),
  });
});
afterEach(() => vi.unstubAllGlobals());

test("[unit] 永続保存した操作は、ストアを開き直しても残る", () => {
  const entry = { id: "one", at: 1 };
  openStore().putPersisted(entry);
  expect(openStore().read()).toEqual([entry]);
});
test("[unit] 永続保存できない操作は、メモリにも成功扱いで残さない", () => {
  const store = openStore();
  writable = false;
  expect(() => store.putPersisted({ id: "one", at: 1 })).toThrow();
  expect(store.read()).toEqual([]);
  expect(openStore().read()).toEqual([]);
});
test("[unit] 送信済みフラグの保存に失敗しても、前の未送信操作を消さない", () => {
  const store = openStore();
  const entry = { id: "one", at: 1 };
  store.putPersisted(entry);
  writable = false;
  store.put({ ...entry, sent: true });
  expect(store.read()).toEqual([{ ...entry, sent: true }]);
  expect(openStore().read()).toEqual([entry]);
});
test("[unit] ロック取得後に別タブの最新値を読み直せる", () => {
  const first = openStore();
  expect(first.read()).toEqual([]);
  openStore().putPersisted({ id: "two", at: 2 });
  first.reload();
  expect(first.read()).toEqual([{ id: "two", at: 2 }]);
});

test("[unit] Web Locksの取得を拒否されても送信を止めない", async () => {
  vi.stubGlobal("navigator", {
    locks: {
      request: vi.fn(async () => {
        throw new Error("SecurityError");
      }),
    },
  });
  const send = vi.fn(async () => "saved");
  expect(await openStore().withLock(send)).toBe("saved");
  expect(send).toHaveBeenCalledTimes(1);
});
test("[unit] ロック内の送信処理が失敗した場合は、ロック外で二重実行しない", async () => {
  vi.stubGlobal("navigator", {
    locks: {
      request: async (_key: string, run: () => Promise<unknown>) => run(),
    },
  });
  const send = vi.fn(async () => {
    throw new Error("send failed");
  });
  await expect(openStore().withLock(send)).rejects.toThrow("send failed");
  expect(send).toHaveBeenCalledTimes(1);
});

test("[unit] 保存値が変わっていない再読込で購読者を描き直し続けない", () => {
  const store = openStore();
  store.putPersisted({ id: "one", at: 1 });
  const original = store.read();
  const subscriber = vi.fn();
  store.subscribe(subscriber);
  store.reload();
  expect(store.read()).toBe(original);
  expect(subscriber).not.toHaveBeenCalled();
});
