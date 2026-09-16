import createClient from "openapi-fetch";
import {
  cashierStateToUpdateRequest,
  responseToCashierState,
} from "../firebase-utils/converter";
import type { CashierStateEntity, GlobalCashierState } from "../models/global";
import type { paths } from "../types/api";
import { API_BASE_URL, throwApiError } from "./item";

const client = createClient<paths>({ baseUrl: API_BASE_URL });

export type CashierStateRepo = {
  /** まだ一度も同期されていなければ undefined */
  get: () => Promise<CashierStateEntity | undefined>;
  set: (state: GlobalCashierState) => Promise<void>;
};

// レジの編集中注文と直前に確定した注文 ID。
// API の単一行 /api/cashier-state に丸ごと置く。購読は useOrdersWS の cashier_state。
export const cashierStateRepoFactory = (): CashierStateRepo => {
  return {
    get: async () => {
      const { data, error, response } = await client.GET(
        "/api/cashier-state",
        {},
      );
      if (response.status === 404) {
        return undefined;
      }
      if (error || !response.ok || !data) {
        return await throwApiError(response, "レジ状態の取得に失敗しました");
      }
      return responseToCashierState(data);
    },
    set: async (state) => {
      const { error, response } = await client.PUT("/api/cashier-state", {
        body: cashierStateToUpdateRequest(state),
      });
      if (error || !response.ok) {
        await throwApiError(response, "レジ状態の更新に失敗しました");
      }
    },
  };
};

export const cashierRepository = cashierStateRepoFactory();
