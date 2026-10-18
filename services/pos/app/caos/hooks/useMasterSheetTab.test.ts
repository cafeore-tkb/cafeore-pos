import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  type MasterSheetTabState,
  createMasterSheetTabSession,
} from "../utils/master-sheet-tab";

const EDITOR = "cafeore:caos-editor:v1";
const LEGACY = "cafeore:caos-outbox:";
const lockInfo = (name: string): LockInfo => ({
  name,
  mode: "exclusive",
  clientId: "test-tab",
});
const mockLocks = () => {
  const held = new Map<string, symbol>();
  const request = vi.fn(
    async (
      name: string,
      options: LockOptions,
      run: (lock: Lock | null) => unknown,
    ) => {
      // Neither a queued request nor stealing can be used for takeover/probing.
      expect(options).toEqual({ ifAvailable: true });
      if (held.has(name)) return run(null);
      const owner = Symbol(name);
      held.set(name, owner);
      try {
        return await run({ name, mode: "exclusive" } as Lock);
      } finally {
        if (held.get(name) === owner) held.delete(name);
      }
    },
  );
  const query = vi.fn(
    async (): Promise<LockManagerSnapshot> => ({
      held: [...held.keys()].map(lockInfo),
      pending: [],
    }),
  );
  return { held, request, query };
};
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const sessions = new Set<ReturnType<typeof createMasterSheetTabSession>>();
let locks: ReturnType<typeof mockLocks>;
const settle = () => vi.advanceTimersByTimeAsync(0);
const openTab = (beforeRelease?: () => void) => {
  const page = new EventTarget();
  vi.stubGlobal("window", page);
  const states: MasterSheetTabState[] = [];
  const log = vi.fn();
  const session = createMasterSheetTabSession({
    onState: (state) => states.push(state),
    onPageHide: () => {
      beforeRelease?.();
      states.push("checking");
    },
    log,
  });
  sessions.add(session);
  return {
    ...session,
    page,
    states,
    log,
    get state() {
      return states.at(-1);
    },
  };
};

beforeEach(() => {
  vi.useFakeTimers();
  locks = mockLocks();
  vi.stubGlobal("navigator", { locks });
});
afterEach(async () => {
  for (const session of sessions) session.stop();
  sessions.clear();
  await settle();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("unit: 操作タブの所有権", () => {
  test("取得できたタブだけactiveになり、終了まで所有権を保持する", async () => {
    const tab = openTab();
    expect(tab.state).toBe("checking");
    await settle();
    expect(tab.state).toBe("active");
    expect(locks.held.has(EDITOR)).toBe(true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(tab.state).toBe("active");
    tab.stop();
    await settle();
    expect(locks.held.has(EDITOR)).toBe(false);
  });

  test("重複タブは拒否され、元のタブの終了後も明示的な再開だけで取得する", async () => {
    const original = openTab();
    await settle();
    const duplicate = openTab();
    await settle();
    expect(original.state).toBe("active");
    expect(duplicate.state).toBe("duplicate");
    original.stop();
    await settle();
    expect(duplicate.state).toBe("duplicate");
    expect(locks.held.has(EDITOR)).toBe(false);
    duplicate.retry();
    await settle();
    expect(duplicate.state).toBe("active");
  });

  test.each(["held", "pending"] as const)(
    "旧送信ロックが%sにある場合はlegacyにし、操作ロックを返す",
    async (area) => {
      locks.query.mockResolvedValueOnce({
        held: area === "held" ? [lockInfo(LEGACY)] : [],
        pending: area === "pending" ? [lockInfo(LEGACY)] : [],
      });
      const tab = openTab();
      await settle();
      expect(tab.state).toBe("legacy");
      expect(locks.held.has(EDITOR)).toBe(false);
      expect(locks.request).toHaveBeenCalledTimes(1);
    },
  );

  test("旧タブが閉じられた後に再確認して取得できる", async () => {
    locks.held.set(LEGACY, Symbol("old-tab"));
    const tab = openTab();
    await settle();
    expect(tab.state).toBe("legacy");
    locks.held.delete(LEGACY);
    tab.retry();
    await settle();
    expect(tab.state).toBe("active");
  });

  test("queryがなくてもrequestで確認し、重複タブを拒否できる", async () => {
    vi.stubGlobal("navigator", { locks: { request: locks.request } });
    const first = openTab();
    await settle();
    expect(first.state).toBe("active");
    expect(locks.held.has(LEGACY)).toBe(false);
    const second = openTab();
    await settle();
    expect(second.state).toBe("duplicate");
    expect(locks.query).not.toHaveBeenCalled();
  });

  test("queryがなくても旧ロックが使用中なら操作せずlegacyにする", async () => {
    vi.stubGlobal("navigator", { locks: { request: locks.request } });
    locks.held.set(LEGACY, Symbol("old-tab"));
    const tab = openTab();
    await settle();
    expect(tab.state).toBe("legacy");
    expect(locks.held.has(EDITOR)).toBe(false);
    expect(locks.held.has(LEGACY)).toBe(true);
  });

  test("requestがなければunsupportedにして操作を始めない", async () => {
    vi.stubGlobal("navigator", { locks: { query: locks.query } });
    const tab = openTab();
    await settle();
    expect(tab.state).toBe("unsupported");
    expect(locks.query).not.toHaveBeenCalled();
  });

  test.each(["request", "query"] as const)(
    "%sが例外で拒否されたら操作を始めずerrorにする",
    async (method) => {
      locks[method].mockRejectedValueOnce(new Error("SecurityError"));
      const tab = openTab();
      await settle();
      expect(tab.state).toBe("error");
      expect(locks.held.has(EDITOR)).toBe(false);
    },
  );

  test("8秒でタイムアウトし、遅い応答が戻ってもactiveへ移行しない", async () => {
    const pending = deferred<LockManagerSnapshot>();
    locks.query.mockImplementationOnce(() => pending.promise);
    const tab = openTab();
    await vi.advanceTimersByTimeAsync(7_999);
    expect(tab.state).toBe("checking");
    await vi.advanceTimersByTimeAsync(1);
    expect(tab.state).toBe("error");
    // query が戻らなくても、ほかのタブの操作を塞ぎ続けない。
    expect(locks.held.has(EDITOR)).toBe(false);
    expect(tab.log).toHaveBeenCalledWith("page.editor-blocked", {
      reason: "timeout",
      attempt: 0,
    });
    const next = openTab();
    await settle();
    expect(next.state).toBe("active");
    pending.resolve({ held: [], pending: [] });
    await settle();
    expect(tab.state).toBe("error");
    expect(next.state).toBe("active");
    next.stop();
    await settle();
    expect(locks.held.has(EDITOR)).toBe(false);
    tab.retry();
    await settle();
    expect(tab.state).toBe("active");
  });

  test("pagehideではUIを止めてから解放し、pageshowで再取得する", async () => {
    const beforeRelease = vi.fn(() =>
      expect(locks.held.has(EDITOR)).toBe(true),
    );
    const tab = openTab(beforeRelease);
    await settle();
    tab.page.dispatchEvent(new Event("pagehide"));
    expect(beforeRelease).toHaveBeenCalledTimes(1);
    expect(tab.state).toBe("checking");
    await settle();
    expect(locks.held.has(EDITOR)).toBe(false);
    tab.retry();
    await settle();
    expect(locks.request).toHaveBeenCalledTimes(1);
    tab.page.dispatchEvent(new Event("pageshow"));
    await settle();
    expect(tab.state).toBe("active");
    expect(locks.request).toHaveBeenCalledTimes(2);
  });

  test("復帰時に別タブが取得済みなら重複として拒否する", async () => {
    const original = openTab();
    await settle();
    original.page.dispatchEvent(new Event("pagehide"));
    await settle();
    const next = openTab();
    await settle();
    expect(next.state).toBe("active");
    original.page.dispatchEvent(new Event("pageshow"));
    await settle();
    expect(original.state).toBe("duplicate");
    expect(next.state).toBe("active");
  });

  test("単なる非表示や重複するpageshowでは所有権を渡さない", async () => {
    const tab = openTab();
    await settle();
    tab.page.dispatchEvent(new Event("visibilitychange"));
    tab.page.dispatchEvent(new Event("pageshow"));
    await settle();
    expect(tab.state).toBe("active");
    expect(locks.request).toHaveBeenCalledTimes(1);
  });

  test("停止後の画面復帰・再開で再取得せず、遅い応答でも状態を更新しない", async () => {
    const pending = deferred<LockManagerSnapshot>();
    locks.query.mockImplementationOnce(() => pending.promise);
    const tab = openTab();
    await settle();
    tab.stop();
    await settle();
    expect(locks.held.has(EDITOR)).toBe(false);
    const states = [...tab.states];
    tab.page.dispatchEvent(new Event("pagehide"));
    tab.page.dispatchEvent(new Event("pageshow"));
    tab.retry();
    pending.resolve({ held: [], pending: [] });
    await settle();
    expect(tab.states).toEqual(states);
    expect(locks.held.has(EDITOR)).toBe(false);
    expect(locks.request).toHaveBeenCalledTimes(1);
  });

  test("StrictMode相当で即座に終了したsetupはロックを要求しない", async () => {
    const first = openTab();
    first.stop();
    const second = openTab();
    await settle();
    expect(second.state).toBe("active");
    expect(locks.request).toHaveBeenCalledTimes(1);
  });
});
