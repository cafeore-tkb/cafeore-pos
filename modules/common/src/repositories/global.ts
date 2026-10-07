import { apiClient, throwApiError } from "../api/client";
import { cashierStateToUpdateRequest } from "../api/converter";
import type { WithId } from "../lib/typeguard";
import type { GlobalCashierState } from "../models/global";
import type { OrderEntity } from "../models/order";

export type CashierStateRepo = {
  set: (state: GlobalCashierState) => Promise<void>;
  /**
   * 直前に set した編集中注文に、確定した注文の ID を載せて送る。
   * まだ一度も set していなければ、確定した注文を編集中注文として送る
   */
  setSubmittedOrder: (order: WithId<OrderEntity>) => Promise<void>;
};

// レジの編集中注文と直前に確定した注文 ID。
// API の単一行 /api/cashier-state に丸ごと置く。購読は useOrdersWS の cashier_state。
export const cashierStateRepoFactory = (): CashierStateRepo => {
  // set はキー入力のたびに await されずに呼ばれる。PUT が並行すると後から送った状態が
  // 先に届いて古い状態で上書きされうるので、前の PUT の完了を待ってから送る
  let lastSet: Promise<void> = Promise.resolve();
  // 最後に送ろうとした状態。確定時に API から読み直すと、読んでから送るまでの間に
  // 積まれた編集を古い状態で巻き戻しうるので、こちらをもとに組み立てる
  let latest: GlobalCashierState | undefined;

  const put = async (state: GlobalCashierState) => {
    const { error, response } = await apiClient.PUT("/api/cashier-state", {
      body: cashierStateToUpdateRequest(state),
    });
    if (error || !response.ok) {
      throwApiError(response, error, "レジ状態の更新に失敗しました");
    }
  };

  const set = (state: GlobalCashierState) => {
    latest = state;
    const result = lastSet.then(() => put(state));
    // 失敗しても次の PUT は送る
    lastSet = result.catch(() => {});
    return result;
  };

  return {
    set,
    setSubmittedOrder: (order) =>
      set({
        id: "cashier-state",
        edittingOrder: latest?.edittingOrder ?? order,
        submittedOrderId: order.id,
      }),
  };
};

export const cashierRepository = cashierStateRepoFactory();
