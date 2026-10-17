import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import { OrderEntity } from "../models/order";
import { cashierStateRepoFactory } from "./global";

// openapi-fetch はモジュール読み込み時の fetch を掴むので、import より前に差し替える。
// 送られたリクエストを順に記録する
// 先払いの途中の状態の GET には、残っている状態を返す
const requests = vi.hoisted(() => {
  const requests: {
    method: string;
    path: string;
    body: {
      editting_order: { orderId: number };
      submitted_order_id: string | null;
      prepay: Record<string, unknown> | null;
    };
  }[] = [];
  vi.stubGlobal("fetch", async (request: Request) => {
    const path = new URL(request.url).pathname;
    const text = await request.text();
    // 本文が無ければ（GET）null
    requests.push({
      method: request.method,
      path,
      body: text ? JSON.parse(text) : null,
    });
    const saved =
      request.method === "GET" && path === "/api/cashier-state/prepay"
        ? { prepay: { orderId: 3 }, updated_at: "2026-10-17T01:02:03.000Z" }
        : {};
    return new Response(JSON.stringify(saved), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  return requests;
});

const SUBMITTED_ID = "00000000-0000-4000-8000-000000000001";

const submittedOrder = () =>
  OrderEntity.fromOrder({
    ...OrderEntity.createNew({ orderId: 1 }).toOrder(),
    id: SUBMITTED_ID,
  });

beforeEach(() => {
  requests.length = 0;
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe("[unit] cashier state repository", () => {
  test("puts the submitted ID on the last editing order sent", async () => {
    const repo = cashierStateRepoFactory();
    const edittingOrder = OrderEntity.createNew({ orderId: 2 });

    repo.set({ id: "cashier-state", edittingOrder, submittedOrderId: null });
    await repo.setSubmittedOrder(submittedOrder());

    // API から読み直さない
    expect(requests.map((r) => r.method)).toEqual(["PUT", "PUT"]);
    expect(requests[1].body.editting_order.orderId).toBe(2);
    expect(requests[1].body.submitted_order_id).toBe(SUBMITTED_ID);
  });

  test("sends the submitted ID even before any sync", async () => {
    const repo = cashierStateRepoFactory();

    await repo.setSubmittedOrder(submittedOrder());

    expect(requests.map((r) => r.method)).toEqual(["PUT"]);
    expect(requests[0].body.editting_order.orderId).toBe(1);
    expect(requests[0].body.submitted_order_id).toBe(SUBMITTED_ID);
  });

  test("sends the prepay after the editing orders queued before it", async () => {
    const repo = cashierStateRepoFactory();
    const edittingOrder = OrderEntity.createNew({ orderId: 2 });

    repo.set({ id: "cashier-state", edittingOrder, submittedOrderId: null });
    await repo.setPrepay({ orderId: 2 });
    await repo.setPrepay(null);

    expect(requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      "PUT /api/cashier-state",
      "PUT /api/cashier-state/prepay",
      "PUT /api/cashier-state/prepay",
    ]);
    expect(requests[1].body.prepay).toEqual({ orderId: 2 });
    expect(requests[2].body).toEqual({ prepay: null });
  });

  test("reads the prepay after what was sent before", async () => {
    const repo = cashierStateRepoFactory();

    repo.setPrepay(null);
    const saved = await repo.getPrepay();

    expect(requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      "PUT /api/cashier-state/prepay",
      "GET /api/cashier-state/prepay",
    ]);
    expect(saved).toEqual({
      prepay: { orderId: 3 },
      updatedAt: new Date("2026-10-17T01:02:03.000Z"),
    });
  });
});
