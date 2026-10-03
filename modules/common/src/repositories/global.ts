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
  // set はキー入力のたびに await されずに呼ばれる。PUT が並行すると後から送った状態が
  // 先に届いて古い状態で上書きされうるので、前の PUT の完了を待ってから送る
  let lastSet: Promise<void> = Promise.resolve();
  const put = async (state: GlobalCashierState) => {
    const { error, response } = await client.PUT("/api/cashier-state", {
      body: cashierStateToUpdateRequest(state),
    });
    if (error || !response.ok) {
      await throwApiError(response, "レジ状態の更新に失敗しました");
    }
  };

  return {
    get: async () => {
      // 送信待ちの PUT があると、それより古い状態を読んでしまう。
      // 読んだ状態をもとに set し直すと新しい編集が巻き戻るので、先に送り切る
      await lastSet;
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
    set: (state) => {
      const result = lastSet.then(() => put(state));
      // 失敗しても次の PUT は送る
      lastSet = result.catch(() => {});
      return result;
    },
  };
};

export const cashierRepository = cashierStateRepoFactory();
