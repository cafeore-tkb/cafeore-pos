import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  type ReconnectingWebSocketStatus,
  createReconnectingWebSocket,
  getReconnectDelay,
} from "./reconnectingWebSocket";

describe("[unit] getReconnectDelay", () => {
  test("doubles from base and caps at max", () => {
    const max = () => 1 - Number.EPSILON;
    const delays = [0, 1, 2, 3, 4, 5, 6, 10].map((attempt) =>
      getReconnectDelay(attempt, { baseMs: 500, maxMs: 15_000, random: max }),
    );
    expect(delays).toEqual([
      500, 1000, 2000, 4000, 8000, 15_000, 15_000, 15_000,
    ]);
  });

  test("jitter stays between half and full of the ceiling", () => {
    const opts = { baseMs: 500, maxMs: 15_000 };
    expect(getReconnectDelay(3, { ...opts, random: () => 0 })).toBe(2000);
    expect(getReconnectDelay(3, { ...opts, random: () => 0.5 })).toBe(3000);
    for (let i = 0; i < 100; i++) {
      const delay = getReconnectDelay(20, opts);
      expect(delay).toBeGreaterThanOrEqual(7500);
      expect(delay).toBeLessThanOrEqual(15_000);
    }
  });

  test("does not overflow for huge attempts", () => {
    expect(getReconnectDelay(10_000, { random: () => 0 })).toBe(7500);
  });
});

class FakeSocket {
  onopen: (() => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  closed = false;

  close() {
    this.closed = true;
  }
  // サーバー側の都合で切れたときのブラウザの挙動（error → close）
  drop() {
    this.onerror?.();
    this.onclose?.();
  }
}

describe("[unit] createReconnectingWebSocket", () => {
  let sockets: FakeSocket[];
  let statuses: ReconnectingWebSocketStatus[];
  let messages: unknown[];
  let win: EventTarget;
  let doc: EventTarget & { visibilityState: DocumentVisibilityState };

  const create = () =>
    createReconnectingWebSocket({
      url: "ws://example.test/api/ws/orders",
      onMessage: (e) => messages.push(e.data),
      onStatusChange: (s) => statuses.push(s),
      createSocket: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket as unknown as WebSocket;
      },
      baseMs: 500,
      maxMs: 15_000,
    });

  beforeEach(() => {
    vi.useFakeTimers();
    // ジッターを最大側に固定して待ち時間を決め打ちにする
    vi.spyOn(Math, "random").mockReturnValue(1 - Number.EPSILON);
    sockets = [];
    statuses = [];
    messages = [];
    win = new EventTarget();
    doc = Object.assign(new EventTarget(), {
      visibilityState: "visible" as DocumentVisibilityState,
    });
    vi.stubGlobal("window", win);
    vi.stubGlobal("document", doc);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  test("reconnects with backoff after the connection drops", () => {
    const conn = create();
    expect(sockets).toHaveLength(1);
    sockets[0].onopen?.();
    sockets[0].onmessage?.({ data: "hello" } as MessageEvent);
    expect(statuses).toEqual(["open"]);
    expect(messages).toEqual(["hello"]);

    sockets[0].drop();
    expect(statuses).toEqual(["open", "closed"]);
    vi.advanceTimersByTime(499);
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(2);

    // つながらない間は待ち時間が伸び、status は closed のまま
    sockets[1].drop();
    vi.advanceTimersByTime(999);
    expect(sockets).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(3);
    expect(statuses).toEqual(["open", "closed"]);

    // つながったら待ち時間は最初に戻る
    sockets[2].onopen?.();
    sockets[2].drop();
    vi.advanceTimersByTime(500);
    expect(sockets).toHaveLength(4);
    expect(statuses).toEqual(["open", "closed", "open", "closed"]);

    conn.close();
  });

  test("keeps retrying when the first connection fails", () => {
    const conn = create();
    sockets[0].drop();
    expect(statuses).toEqual(["closed"]);
    vi.advanceTimersByTime(500);
    expect(sockets).toHaveLength(2);
    conn.close();
  });

  test("gives up a connection attempt that hangs", () => {
    const conn = create();
    vi.advanceTimersByTime(10_000);
    expect(sockets[0].closed).toBe(true);
    expect(statuses).toEqual(["closed"]);
    // 遅れて届いた onclose で二重に予約しない
    sockets[0].onclose?.();
    vi.advanceTimersByTime(500);
    expect(sockets).toHaveLength(2);
    conn.close();
  });

  test("online and visibilitychange skip the backoff wait", () => {
    const conn = create();
    sockets[0].onopen?.();
    sockets[0].drop();
    // 何度か失敗して待ち時間が伸びた状態にする
    for (let i = 1; i <= 4; i++) {
      vi.runOnlyPendingTimers();
      sockets[i].drop();
    }
    expect(sockets).toHaveLength(5);

    win.dispatchEvent(new Event("online"));
    expect(sockets).toHaveLength(6);
    // つながっている（試行中の）ときは何もしない
    win.dispatchEvent(new Event("online"));
    expect(sockets).toHaveLength(6);

    sockets[5].drop();
    doc.visibilityState = "hidden";
    doc.dispatchEvent(new Event("visibilitychange"));
    expect(sockets).toHaveLength(6);
    doc.visibilityState = "visible";
    doc.dispatchEvent(new Event("visibilitychange"));
    expect(sockets).toHaveLength(7);

    // すぐつないだぶん、予約していた再接続は取り消されている
    sockets[6].onopen?.();
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(7);
    conn.close();
  });

  test("does not reconnect after close", () => {
    const conn = create();
    sockets[0].onopen?.();
    conn.close();
    expect(sockets[0].closed).toBe(true);
    sockets[0].onclose?.();
    win.dispatchEvent(new Event("online"));
    doc.dispatchEvent(new Event("visibilitychange"));
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(1);
    expect(statuses).toEqual(["open"]);
  });
});
