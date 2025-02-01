import { type Firestore, doc, getDoc, setDoc } from "firebase/firestore";
import {
  cashierStateConverter,
  masterStateConverter,
} from "../firebase-utils/converter";
import { prodDB } from "../firebase-utils/firebase";
import type { GlobalCashierState, MasterStateEntity } from "../models/global";

export type CashierStateRepo = {
  get: () => Promise<GlobalCashierState | undefined>;
  set: (state: GlobalCashierState) => Promise<void>;
};

export type MasterStateRepo = {
  get: () => Promise<MasterStateEntity | undefined>;
  set: (state: MasterStateEntity) => Promise<void>;
};

export const cashierStateRepoFactory = (db: Firestore): CashierStateRepo => {
  return {
    get: async () => {
      const docRef = doc(db, "global", "cashier-state").withConverter(
        cashierStateConverter,
      );
      const docSnap = await getDoc(docRef);
      const data = docSnap.data();
      if (data?.id === "cashier-state") {
        return data;
      }
    },
    set: async (state) => {
      const docRef = doc(db, "global", "cashier-state").withConverter(
        cashierStateConverter,
      );
      await setDoc(docRef, state);
    },
  };
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

export const cashierRepository = cashierStateRepoFactory(prodDB);
export const masterRepository = masterStateRepoFactory(prodDB);
