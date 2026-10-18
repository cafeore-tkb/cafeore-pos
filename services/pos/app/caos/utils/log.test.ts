import { describe, expect, test, vi } from "vitest";
import {
  caosLog,
  createCaosStateLog,
  logCaosAsync,
  startCaosPageLog,
} from "./log";
import { enqueueCaosLog } from "./log-transport";

vi.mock("./log-transport", () => ({ enqueueCaosLog: vi.fn() }));

describe("unit: CaOS の重複ログ", () => {
  test("緊急やスタンプの受付と結果を同じactionIdで記録する", async () => {
    vi.stubGlobal("window", {});
    vi.mocked(enqueueCaosLog).mockClear();
    try {
      const ids = await logCaosAsync(
        "emergency.add",
        { cupIds: ["cup-1"], reason: "こぼした" },
        async () => ["emergency-1"],
      );
      expect(ids).toEqual(["emergency-1"]);
      const entries = vi
        .mocked(enqueueCaosLog)
        .mock.calls.map(([entry]) => entry);
      expect(entries.map((entry) => entry.event)).toEqual([
        "emergency.add.requested",
        "emergency.add.succeeded",
      ]);
      expect(entries[0].details.actionId).toBe(entries[1].details.actionId);
      expect(entries[1].details.result).toEqual(["emergency-1"]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test("拒否と例外を成功として記録せず、元の結果・例外を維持する", async () => {
    vi.stubGlobal("window", {});
    vi.mocked(enqueueCaosLog).mockClear();
    try {
      expect(
        await logCaosAsync("emergency.add", {}, async () => null),
      ).toBeNull();
      const failure = new Error("offline");
      await expect(
        logCaosAsync("comment.stamp", { orderId: "order-1" }, async () => {
          throw failure;
        }),
      ).rejects.toBe(failure);
      const events = vi
        .mocked(enqueueCaosLog)
        .mock.calls.map(([entry]) => entry.event);
      expect(events).toEqual([
        "emergency.add.requested",
        "emergency.add.rejected",
        "comment.stamp.requested",
        "comment.stamp.failed",
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  test("コンソールには出さず、呼び出した時点の内容をDB送信キューに残す", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    vi.stubGlobal("window", {});
    vi.stubGlobal("crypto", {
      randomUUID: () => "00000000-0000-4000-8000-000000000001",
    });
    try {
      const details = { label: "割当" };
      caosLog("operation.accepted", details);
      details.label = "変更後";
      expect(info).not.toHaveBeenCalled();
      expect(enqueueCaosLog).toHaveBeenCalledWith(
        expect.objectContaining({
          event: "operation.accepted",
          details: { label: "割当" },
        }),
      );
    } finally {
      vi.unstubAllGlobals();
      info.mockRestore();
    }
  });
  test("Effect の再実行と同じ内容の新しい配列は状態変化に数えない", () => {
    const log = vi.fn();
    const state = createCaosStateLog(log);
    state("connection.changed", { enabled: true, status: "connecting" });
    state("outbox.changed", { entries: [] });
    state("connection.changed", { enabled: true, status: "connecting" });
    state("outbox.changed", { entries: [] });
    expect(log.mock.calls).toEqual([
      ["connection.changed", { enabled: true, status: "connecting" }],
      ["outbox.changed", { entries: [] }],
    ]);
  });

  test("接続が変化して元に戻る場合は両方残す", () => {
    const log = vi.fn();
    const state = createCaosStateLog(log);
    for (const status of ["open", "reconnecting", "open"])
      state("connection.changed", { status });
    expect(log).toHaveBeenCalledTimes(3);
  });

  test("キューの追加・送信済みへの変化・削除はすべて残す", () => {
    const log = vi.fn();
    const state = createCaosStateLog(log);
    for (const entries of [
      [],
      [{ id: "op-1" }],
      [{ id: "op-1", sent: true }],
      [],
    ])
      state("outbox.changed", { entries });
    expect(log).toHaveBeenCalledTimes(4);
  });

  test("StrictMode の即時 cleanup では開閉を出さず、実際の開閉を1回ずつ出す", async () => {
    const log = vi.fn();
    const details = { path: "/master-sheet", online: true };
    const cleanupProbe = startCaosPageLog(details, log);
    cleanupProbe();
    const cleanup = startCaosPageLog(details, log);
    await Promise.resolve();
    expect(log.mock.calls).toEqual([["page.open", details]]);
    cleanup();
    expect(log.mock.calls).toEqual([["page.open", details], ["page.close"]]);

    // 本当の再入場は、新しい open として記録される。
    const cleanupReentry = startCaosPageLog(details, log);
    await Promise.resolve();
    cleanupReentry();
    expect(log).toHaveBeenCalledTimes(4);
  });
});
