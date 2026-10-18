import { beforeEach, describe, expect, test, vi } from "vitest";

// 共有の WebSocket に届いたものを流す（つなぎ直しは createReconnectingWebSocket の中なので、ここでは届くものだけ）
let receive: (data: unknown) => void = () => {};
vi.mock("../lib/reconnectingWebSocket", () => ({
  createReconnectingWebSocket: ({
    onMessage,
  }: {
    onMessage: (e: MessageEvent) => void;
  }) => {
    receive = (data) =>
      onMessage(new MessageEvent("message", { data: JSON.stringify(data) }));
    return { close: () => {} };
  },
}));
// フックを 1 回だけ呼ぶ（effect はその場で走らせ、状態は持たない）
vi.mock("react", () => ({
  useState: (initial: unknown) => [initial, () => {}],
  useRef: (current: unknown) => ({ current }),
  useEffect: (effect: () => void) => effect(),
  useMemo: (factory: () => unknown) => factory(),
}));

const { useOrdersWS } = await import("./useOrdersWS");

describe("[unit] useOrdersWS の緊急の取り消し", () => {
  const cancelled = vi.fn();
  beforeEach(() => {
    cancelled.mockClear();
    useOrdersWS({ onCupEmergencyCancelled: cancelled });
  });

  test("取り消しの知らせを受けたときだけ、その id で呼ぶ", () => {
    receive({ type: "cup_emergency_cancelled", cup_emergency_id: "e1" });

    expect(cancelled).toHaveBeenCalledTimes(1);
    expect(cancelled).toHaveBeenCalledWith("e1");
  });

  test("つなぎ直して注文の一覧が空で届いても、注文が消えても呼ばない", () => {
    receive({ type: "orders", orders: [] });
    receive({ type: "order_deleted", order_id: "o1" });
    receive({ type: "orders" });

    expect(cancelled).not.toHaveBeenCalled();
  });
});

describe("[unit] useOrdersWS の呼び出し催促", () => {
  const recalled = vi.fn();
  const cancelled = vi.fn();
  beforeEach(() => {
    recalled.mockClear();
    cancelled.mockClear();
    useOrdersWS({
      onCupEmergencyCancelled: cancelled,
      onOrderRecalled: recalled,
    });
  });

  test("催促の知らせを受けたら、その注文の id で呼ぶ", () => {
    receive({ type: "order_recalled", order_id: "o1" });

    expect(recalled).toHaveBeenCalledTimes(1);
    expect(recalled).toHaveBeenCalledWith("o1");
    expect(cancelled).not.toHaveBeenCalled();
  });

  test("注文が消えても、緊急が取り消されても呼ばない", () => {
    receive({ type: "order_deleted", order_id: "o1" });
    receive({ type: "cup_emergency_cancelled", cup_emergency_id: "e1" });

    expect(recalled).not.toHaveBeenCalled();
  });
});

describe("[unit] useOrdersWS の代理印刷", () => {
  const requested = vi.fn();
  const done = vi.fn();
  const cancelled = vi.fn();
  beforeEach(() => {
    requested.mockClear();
    done.mockClear();
    cancelled.mockClear();
    useOrdersWS({
      onCupEmergencyCancelled: cancelled,
      onLabelPrintRequested: requested,
      onLabelPrintDone: done,
    });
  });

  test("頼みを受けたら、その頼みで呼ぶ", () => {
    const request = {
      id: "r1",
      job: { labels: [{ type: "flow", lines: [] }] },
      created_at: "2026-10-18T01:00:00Z",
    };
    receive({ type: "label_print_requested", label_print_request: request });

    expect(requested).toHaveBeenCalledTimes(1);
    expect(requested).toHaveBeenCalledWith(request);
    expect(done).not.toHaveBeenCalled();
  });

  test("刷れたという知らせを受けたら、その id で呼ぶ（取り消しとは別）", () => {
    receive({ type: "label_print_done", label_print_request_id: "r1" });

    expect(done).toHaveBeenCalledTimes(1);
    expect(done).toHaveBeenCalledWith("r1");
    expect(requested).not.toHaveBeenCalled();
    expect(cancelled).not.toHaveBeenCalled();
  });
});
