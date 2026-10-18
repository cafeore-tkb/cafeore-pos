import { OrderEntity } from "@cafeore/common";
import { afterEach, describe, expect, test, vi } from "vitest";
import { latestUnsentOrderId } from "./saveOrderInBackground";

const fakeStorage = (items: Record<string, string>) => ({
  getItem: (key: string) => items[key] ?? null,
  setItem: (key: string, value: string) => {
    items[key] = value;
  },
});

const unsent = (...orderIds: number[]) =>
  JSON.stringify(
    Object.fromEntries(
      orderIds.map((orderId) => [
        `key-${orderId}`,
        OrderEntity.createNew({ orderId }).toOrder(),
      ]),
    ),
  );

describe("[unit] latestUnsentOrderId", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test("端末に残っている、まだ保存できていない注文のうち、いちばん大きい番号を返す", () => {
    vi.stubGlobal(
      "localStorage",
      fakeStorage({ "cashier-failed-orders": unsent(12, 15, 13) }),
    );
    expect(latestUnsentOrderId()).toBe(15);
  });

  test("残っている注文が無い・読めないときは 0", () => {
    vi.stubGlobal("localStorage", fakeStorage({}));
    expect(latestUnsentOrderId()).toBe(0);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "localStorage",
      fakeStorage({ "cashier-failed-orders": "{壊れた" }),
    );
    expect(latestUnsentOrderId()).toBe(0);
  });
});
