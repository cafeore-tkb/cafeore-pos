import { describe, expect, test, vi } from "vitest";
import { orderRepository } from "../repositories/order";
import { apiWebSocketUrl, throwApiError } from "./client";

// apiClient は作ったときの fetch を使うので、読み込む前に差し替えておく
const fetchMock = vi.hoisted(() => {
  const mock = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", mock);
  return mock;
});

describe("[unit] throwApiError", () => {
  const response = new Response(null, {
    status: 400,
    statusText: "Bad Request",
  });

  test("uses the error field of the body", () => {
    expect(() =>
      throwApiError(response, { error: "Invalid ID format" }, "Failed"),
    ).toThrow("Failed: Invalid ID format");
  });

  test("uses a text body as is", () => {
    expect(() => throwApiError(response, "boom", "Failed")).toThrow(
      "Failed: boom",
    );
  });

  test("falls back to the status without a body", () => {
    expect(() => throwApiError(response, undefined, "Failed")).toThrow(
      "Failed: 400 Bad Request",
    );
  });
});

describe("[unit] apiClient", () => {
  test("reads the error the API wrote", async () => {
    fetchMock.mockResolvedValue(
      Response.json({ error: "Order not found" }, { status: 404 }),
    );
    await expect(
      orderRepository.delete("00000000-0000-4000-8000-000000000001"),
    ).rejects.toThrow("Failed to delete order: Order not found");
  });
});

describe("[unit] apiWebSocketUrl", () => {
  test("turns the API URL into a WebSocket URL", () => {
    expect(apiWebSocketUrl("/api/ws/orders")).toMatch(
      /^wss?:\/\/[^/]+.*\/api\/ws\/orders$/,
    );
  });
});
