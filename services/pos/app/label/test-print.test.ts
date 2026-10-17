import { afterEach, describe, expect, test, vi } from "vitest";
import type { PrintJob } from "./document";
import type { CreateLabelPrinter } from "./infra/printer";
import { PRINT_ONCE_CONNECT_TIMEOUT_MS, printOnce } from "./test-print";

const job: PrintJob = { labels: [{ type: "flow", lines: [] }] };

/**
 * 呼ばれたことを覚えるプリンター
 *
 * connect すると result のとおりに知らせる（never なら何も知らせない）。
 * print は printed を返し、刷れなかったときは ePOS と同じく先に disconnected を知らせる。
 */
const fakePrinter = (
  result: "connected" | "disconnected" | "never",
  printed = true,
) => {
  const calls: unknown[] = [];
  const create: CreateLabelPrinter = (onStatusChange) => ({
    connect: () => {
      calls.push("connect");
      onStatusChange("connecting");
      if (result !== "never") onStatusChange(result);
    },
    disconnect: () => {
      calls.push("disconnect");
    },
    print: async (printing) => {
      calls.push(["print", printing]);
      if (!printed) onStatusChange("disconnected");
      return printed;
    },
  });
  return { create, calls };
};

describe("[unit] printOnce", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("つながったら 1 回刷って切る", async () => {
    const { create, calls } = fakePrinter("connected");

    await expect(printOnce(create, Promise.resolve(job))).resolves.toBe(
      "printed",
    );
    expect(calls).toEqual(["connect", ["print", job], "disconnect"]);
  });

  test("つながらなければ刷らずに切る", async () => {
    const { create, calls } = fakePrinter("disconnected");

    await expect(printOnce(create, Promise.resolve(job))).resolves.toBe(
      "unreachable",
    );
    expect(calls).toEqual(["connect", "disconnect"]);
  });

  test("刷れなかったら（刷っている間に切れても）failed", async () => {
    const { create, calls } = fakePrinter("connected", false);

    await expect(printOnce(create, Promise.resolve(job))).resolves.toBe(
      "failed",
    );
    expect(calls).toEqual(["connect", ["print", job], "disconnect"]);
  });

  test("印刷データを作れなければ送らずに failed。つながらないときは作れなくても unreachable", async () => {
    const connected = fakePrinter("connected");
    await expect(
      printOnce(connected.create, Promise.reject(new Error("canvas"))),
    ).resolves.toBe("failed");
    expect(connected.calls).toEqual(["connect", "disconnect"]);

    const unreachable = fakePrinter("disconnected");
    await expect(
      printOnce(unreachable.create, Promise.reject(new Error("canvas"))),
    ).resolves.toBe("unreachable");
  });

  test("つながるのを待ちきれなければ、切って unreachable", async () => {
    vi.useFakeTimers();
    const { create, calls } = fakePrinter("never");

    const result = printOnce(create, Promise.resolve(job));
    await vi.advanceTimersByTimeAsync(PRINT_ONCE_CONNECT_TIMEOUT_MS);

    await expect(result).resolves.toBe("unreachable");
    expect(calls).toEqual(["connect", "disconnect"]);
  });
});
