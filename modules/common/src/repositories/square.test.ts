import { afterAll, describe, expect, test, vi } from "vitest";
import {
  SquareCheckoutConflictError,
  SquareCheckoutRejectedError,
  squareRepository,
} from "./square";

// apiClient は作ったときの fetch を使うので、読み込む前に差し替えておく
const fetchMock = vi.hoisted(() => {
  const mock = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", mock);
  return mock;
});

afterAll(() => {
  vi.unstubAllGlobals();
});

const params = {
  idempotencyKey: "key-1",
  deviceId: "device-1",
  amount: 600,
  paymentType: "CARD_PRESENT" as const,
  orderNumber: 12,
};

const checkout = (outcome: string) => ({
  id: "00000000-0000-4000-8000-000000000001",
  device_id: "device-1",
  checkout_id: null,
  status: outcome === "failed" ? "ERROR" : "CREATING",
  outcome,
  amount: 600,
  payment_type: "CARD_PRESENT",
  payment_ids: [],
  error_message: "Square から答えがありません",
  refund_status: "none",
  created_at: "2026-11-07T12:00:00Z",
  updated_at: "2026-11-07T12:00:00Z",
});

describe("[unit] squareRepository.createCheckout", () => {
  test("returns the checkout the server could not confirm with Square", async () => {
    fetchMock.mockResolvedValue(
      Response.json(checkout("pending"), { status: 502 }),
    );
    await expect(
      squareRepository.createCheckout(params),
    ).resolves.toMatchObject({ outcome: "pending", checkout_id: null });
  });

  test("tells a rejection by the server apart (nothing was created)", async () => {
    fetchMock.mockResolvedValue(
      Response.json({ error: "端末が登録されていません" }, { status: 400 }),
    );
    const error = await squareRepository.createCheckout(params).catch((e) => e);
    expect(error).toBeInstanceOf(SquareCheckoutRejectedError);
    expect(error.message).toBe("端末が登録されていません");
  });

  test("throws a conflict with the checkout in progress", async () => {
    fetchMock.mockResolvedValue(
      Response.json(
        { error: "別の決済が進行中です", checkout: checkout("pending") },
        { status: 409 },
      ),
    );
    await expect(
      squareRepository.createCheckout(params),
    ).rejects.toBeInstanceOf(SquareCheckoutConflictError);
  });

  test.each([
    [
      "a gateway error with a text body",
      () => new Response("Bad Gateway", { status: 502 }),
    ],
    ["a server error", () => Response.json({ error: "db" }, { status: 500 })],
    ["a request timeout", () => new Response("timeout", { status: 408 })],
  ])(
    "does not treat %s as a rejection (it may have been created)",
    async (_, response) => {
      fetchMock.mockResolvedValue(response());
      const error = await squareRepository
        .createCheckout(params)
        .catch((e) => e);
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(SquareCheckoutRejectedError);
      expect(error).not.toBeInstanceOf(SquareCheckoutConflictError);
    },
  );

  test("does not treat a network error as a rejection", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    const error = await squareRepository.createCheckout(params).catch((e) => e);
    expect(error).toBeInstanceOf(TypeError);
  });
});
