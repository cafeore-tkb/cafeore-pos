import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import { OrderEntity } from "../models/order";
import { cashierStateRepoFactory } from "./global";

// openapi-fetch はモジュール読み込み時の fetch を掴むので、import より前に差し替える。
// 送られたリクエストを順に記録する
const requests = vi.hoisted(() => {
  const requests: {
    method: string;
    body: {
      editting_order: { orderId: number };
      submitted_order_id: string | null;
    };
  }[] = [];
  vi.stubGlobal("fetch", async (request: Request) => {
    requests.push({ method: request.method, body: await request.json() });
    return new Response("{}", {
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
});
