import type { LabelPrintClaim } from "@cafeore/common";
import { describe, expect, test, vi } from "vitest";
import type { PrintJob } from "./document";
import {
  PROXY_RETRY_MS,
  type ProxyDeps,
  RELAY_STALL_MS,
  addLabelPrintRequest,
  createProxyState,
  isLabelPrintQueueStalled,
  replaceLabelPrintRequests,
  runLabelPrintProxy,
} from "./print-relay";

const job: PrintJob = { labels: [{ type: "flow", lines: [] }] };

/** claims の id ごとの結果で引き受け、print の結果で刷るレジ。呼ばれた順を calls に残す */
const fakeDeps = ({
  claims = {},
  print = true,
  markPrinted = true,
  canPrint = () => true,
}: {
  claims?: Record<string, LabelPrintClaim>;
  print?: boolean | (() => boolean);
  markPrinted?: boolean;
  canPrint?: () => boolean;
}) => {
  let now = 1_000;
  const calls: string[] = [];
  const deps: ProxyDeps = {
    deviceId: "register-a",
    claim: vi.fn(async (id: string) => {
      calls.push(`claim:${id}`);
      return claims[id] ?? { status: "claimed", job };
    }),
    print: vi.fn(async () => {
      calls.push("print");
      return typeof print === "function" ? print() : print;
    }),
    markPrinted: vi.fn(async (id: string) => {
      calls.push(`printed:${id}`);
      return markPrinted;
    }),
    release: vi.fn(async (id: string) => {
      calls.push(`release:${id}`);
      return true;
    }),
    canPrint,
    now: () => now,
  };
  return {
    deps,
    calls,
    advance: (ms: number) => {
      now += ms;
    },
  };
};

const requests = (...ids: string[]) => ids.map((id) => ({ id }));

describe("[unit] runLabelPrintProxy", () => {
  test("古い順に引き受けて刷り、刷れたら知らせて片付ける", async () => {
    const { deps, calls } = fakeDeps({});
    const state = createProxyState();

    const result = await runLabelPrintProxy(requests("a", "b"), deps, state);

    expect(calls).toEqual([
      "claim:a",
      "print",
      "printed:a",
      "claim:b",
      "print",
      "printed:b",
    ]);
    expect(result).toEqual({ settled: ["a", "b"], printed: ["a", "b"] });
    expect(deps.print).toHaveBeenCalledWith(job);
  });

  test("ほかのレジが刷っている（busy）ものは刷らず、間をあけてから引き受け直す", async () => {
    const { deps, calls, advance } = fakeDeps({
      claims: { a: { status: "busy" } },
    });
    const state = createProxyState();

    expect(await runLabelPrintProxy(requests("a"), deps, state)).toEqual({
      settled: [],
      printed: [],
    });
    // 間をあけるまでは引き受けにいかない
    await runLabelPrintProxy(requests("a"), deps, state);
    expect(calls).toEqual(["claim:a"]);

    advance(PROXY_RETRY_MS);
    await runLabelPrintProxy(requests("a"), deps, state);
    expect(calls).toEqual(["claim:a", "claim:a"]);
  });

  test("もう刷れた・頼みが無い（緊急を取り消した）ものは刷らずに片付ける", async () => {
    const { deps, calls } = fakeDeps({
      claims: { a: { status: "printed" }, b: { status: "missing" } },
    });

    const result = await runLabelPrintProxy(
      requests("a", "b"),
      deps,
      createProxyState(),
    );

    expect(calls).toEqual(["claim:a", "claim:b"]);
    expect(result).toEqual({ settled: ["a", "b"], printed: [] });
  });

  test("刷れなかったら引き受けをやめ、後ろは引き受けない（プリンターの具合が悪い）", async () => {
    const { deps, calls, advance } = fakeDeps({ print: false });
    const state = createProxyState();

    const result = await runLabelPrintProxy(requests("a", "b"), deps, state);

    expect(calls).toEqual(["claim:a", "print", "release:a"]);
    expect(result).toEqual({ settled: [], printed: [] });
    // 次に回したときは、間をあけていない a を飛ばして b を試す
    await runLabelPrintProxy(requests("a", "b"), deps, state);
    expect(calls.slice(3)).toEqual(["claim:b", "print", "release:b"]);
    advance(PROXY_RETRY_MS);
    await runLabelPrintProxy(requests("a", "b"), deps, state);
    expect(calls.slice(6)).toEqual(["claim:a", "print", "release:a"]);
  });

  test("読めない印刷データは刷らずに、刷れなかったときと同じく引き受けをやめる", async () => {
    const { deps, calls } = fakeDeps({
      claims: { a: { status: "claimed", job: "broken" as never } },
    });

    await runLabelPrintProxy(requests("a"), deps, createProxyState());

    expect(calls).toEqual(["claim:a", "release:a"]);
  });

  test("刷れたのに知らせられなかったら、もう一度は刷らず、知らせるだけにする", async () => {
    const { deps, calls, advance } = fakeDeps({ markPrinted: false });
    const state = createProxyState();

    const first = await runLabelPrintProxy(requests("a"), deps, state);
    expect(first).toEqual({ settled: [], printed: ["a"] });

    vi.mocked(deps.markPrinted).mockImplementation(async (id) => {
      calls.push(`printed:${id}`);
      return true;
    });
    advance(PROXY_RETRY_MS);
    const second = await runLabelPrintProxy(requests("a"), deps, state);

    expect(calls).toEqual(["claim:a", "print", "printed:a", "printed:a"]);
    expect(second).toEqual({ settled: ["a"], printed: [] });
  });

  test("プリンターにつながっていなければ引き受けない（途中で切れたら、そこでやめる）", async () => {
    let connected = false;
    const { deps, calls } = fakeDeps({ canPrint: () => connected });
    const state = createProxyState();

    await runLabelPrintProxy(requests("a", "b"), deps, state);
    expect(calls).toEqual([]);

    connected = true;
    vi.mocked(deps.print).mockImplementation(async () => {
      calls.push("print");
      connected = false;
      return true;
    });
    const result = await runLabelPrintProxy(requests("a", "b"), deps, state);
    expect(calls).toEqual(["claim:a", "print", "printed:a"]);
    expect(result).toEqual({ settled: ["a"], printed: ["a"] });
  });

  test("一覧から消えたもの（ほかの端末で片付いた）は覚えておかない", async () => {
    const { deps } = fakeDeps({
      claims: { a: { status: "busy" } },
      markPrinted: false,
    });
    const state = createProxyState();
    await runLabelPrintProxy(requests("a", "b"), deps, state);
    expect([...state.retryAt.keys()]).toEqual(["a", "b"]);
    expect([...state.printed]).toEqual(["b"]);

    await runLabelPrintProxy([], deps, state);

    expect(state.retryAt.size).toBe(0);
    expect(state.printed.size).toBe(0);
  });
});

const request = (id: string, createdAt: string) => ({
  id,
  job: { labels: [{ type: "flow", lines: [] }] },
  created_at: createdAt,
});

describe("[unit] 代理印刷の頼みの一覧", () => {
  test("頼まれた順に並べる（created_at の小数の桁がそろっていなくても）。同じ id は足さない", () => {
    const late = request("late", "2026-10-18T03:21:24.936292Z");
    const early = request("early", "2026-10-18T03:21:24.9Z");
    const list = addLabelPrintRequest(addLabelPrintRequest([], late), early);

    expect(list.map((r) => r.id)).toEqual(["early", "late"]);
    expect(addLabelPrintRequest(list, early)).toBe(list);
  });

  test("読み直したら置き換える。読み直している間に届いたものは残し、刷れた・取り消したと知ったものは外す", () => {
    const a = request("a", "2026-10-18T03:00:00Z");
    const b = request("b", "2026-10-18T03:01:00Z");
    const c = request("c", "2026-10-18T03:02:00Z");
    const d = request("d", "2026-10-18T03:03:00Z");
    // 前の一覧: a（もう刷れた）・b（読み直した一覧にもある）・d（読み直している間に届いた）
    const prev = [a, b, d];

    const next = replaceLabelPrintRequests(
      [c, b, a],
      prev,
      new Set(["d"]),
      new Set(["a"]),
    );

    expect(next.map((r) => r.id)).toEqual(["b", "c", "d"]);
  });
});

describe("[unit] 代理印刷の滞留判定", () => {
  const start = Date.parse("2026-10-18T03:00:00Z");
  const pending = request("a", "2026-10-18T03:00:00Z");

  test("未印刷の依頼が1分残ったら、APIに届いていても利用可能としない", () => {
    expect(
      isLabelPrintQueueStalled([pending], start + RELAY_STALL_MS - 1),
    ).toBe(false);
    expect(isLabelPrintQueueStalled([pending], start + RELAY_STALL_MS)).toBe(
      true,
    );
    expect(isLabelPrintQueueStalled([], start + RELAY_STALL_MS)).toBe(false);
  });

  test("新しい依頼が届いても、古い未印刷が残っていれば滞留とする", () => {
    const recent = request("b", "2026-10-18T03:01:00Z");
    expect(
      isLabelPrintQueueStalled([recent, pending], start + RELAY_STALL_MS),
    ).toBe(true);
    expect(isLabelPrintQueueStalled([recent], start + RELAY_STALL_MS)).toBe(
      false,
    );
  });

  test("作成時刻が不正な依頼も利用可能とは判定しない", () => {
    expect(isLabelPrintQueueStalled([request("a", "invalid")], start)).toBe(
      true,
    );
  });
});
