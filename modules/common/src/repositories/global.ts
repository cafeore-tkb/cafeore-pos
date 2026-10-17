import { apiClient, throwApiError } from "../api/client";
import {
  cashierStateToUpdateRequest,
  responseToCashierPrepay,
} from "../api/converter";
import type { WithId } from "../lib/typeguard";
import type { GlobalCashierState, SavedCashierPrepay } from "../models/global";
import type { OrderEntity } from "../models/order";

export type CashierStateRepo = {
  set: (state: GlobalCashierState) => Promise<void>;
  /**
   * 直前に set した編集中注文に、確定した注文の ID を載せて送る。
   * まだ一度も set していなければ、確定した注文を編集中注文として送る
   */
  setSubmittedOrder: (order: WithId<OrderEntity>) => Promise<void>;
  /** 先払いの途中の状態を置き換える。null で消す。set と同じ列に並べて送る */
  setPrepay: (prepay: Record<string, unknown> | null) => Promise<void>;
  /** サーバーに残っている先払いの途中の状態。無ければ null。それまでに送ったものが届いてから読む */
  getPrepay: () => Promise<SavedCashierPrepay | null>;
};

// レジの編集中注文と直前に確定した注文 ID。
// API の単一行 /api/cashier-state に丸ごと置く。購読は useOrdersWS の cashier_state。
// 先払いの途中の状態は、同じ行の別の列（/api/cashier-state/prepay）に置く。こちらは配信しない
export const cashierStateRepoFactory = (): CashierStateRepo => {
  // set はキー入力のたびに await されずに呼ばれる。PUT が並行すると後から送った状態が
  // 先に届いて古い状態で上書きされうるので、前の PUT の完了を待ってから送る
  let lastSet: Promise<void> = Promise.resolve();
  // 最後に送ろうとした状態。確定時に API から読み直すと、読んでから送るまでの間に
  // 積まれた編集を古い状態で巻き戻しうるので、こちらをもとに組み立てる
  let latest: GlobalCashierState | undefined;

  const enqueue = <T>(send: () => Promise<T>): Promise<T> => {
    const result = lastSet.then(send);
    // 失敗しても次の PUT は送る
    lastSet = result.then(
      () => {},
      () => {},
    );
    return result;
  };

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
    return enqueue(() => put(state));
  };

  const putPrepay = async (prepay: Record<string, unknown> | null) => {
    const { error, response } = await apiClient.PUT(
      "/api/cashier-state/prepay",
      { body: { prepay } },
    );
    if (error || !response.ok) {
      throwApiError(response, error, "先払いの途中の状態を送れませんでした");
    }
  };

  const fetchPrepay = async () => {
    const { data, error, response } = await apiClient.GET(
      "/api/cashier-state/prepay",
    );
    if (error || !response.ok || !data) {
      throwApiError(response, error, "先払いの途中の状態を読めませんでした");
    }
    return responseToCashierPrepay(data);
  };

  return {
    set,
    setSubmittedOrder: (order) =>
      set({
        id: "cashier-state",
        edittingOrder: latest?.edittingOrder ?? order,
        submittedOrderId: order.id,
      }),
    setPrepay: (prepay) => enqueue(() => putPrepay(prepay)),
    getPrepay: () => enqueue(fetchPrepay),
  };
};

export const cashierRepository = cashierStateRepoFactory();
