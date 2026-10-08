import { type Firestore, doc, getDoc, setDoc } from "firebase/firestore";
import createClient from "openapi-fetch";
import {
  cashierStateToUpdateRequest,
  masterStateConverter,
} from "../firebase-utils/converter";
import { prodDB } from "../firebase-utils/firebase";
import type { GlobalCashierState, MasterStateEntity } from "../models/global";
import type { paths } from "../types/api";
import { API_BASE_URL, throwApiError } from "./item";

const client = createClient<paths>({ baseUrl: API_BASE_URL });

export type CashierStateRepo = {
  set: (state: GlobalCashierState) => Promise<void>;
};

export type MasterStateRepo = {
  get: () => Promise<MasterStateEntity | undefined>;
  set: (state: MasterStateEntity) => Promise<void>;
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

  const set = (state: GlobalCashierState) => {
    const result = lastSet.then(() => put(state));
    // 失敗しても次の PUT は送る
    lastSet = result.catch(() => {});
    return result;
  };

  return { set };
};

export const masterStateRepoFactory = (db: Firestore): MasterStateRepo => {
  return {
    get: async () => {
      const docRef = doc(db, "global", "master-state").withConverter(
        masterStateConverter,
      );
      const docSnap = await getDoc(docRef);
      const data = docSnap.data();
      if (data?.id === "master-state") {
        return data;
      }
    },
    set: async (state) => {
      const docRef = doc(db, "global", "master-state").withConverter(
        masterStateConverter,
      );
      await setDoc(docRef, state);
    },
  };
};

export const cashierRepository = cashierStateRepoFactory();
export const masterRepository = masterStateRepoFactory(prodDB);
