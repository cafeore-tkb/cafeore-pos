import { type Firestore, doc, getDoc, setDoc } from "firebase/firestore";
import { masterStateConverter } from "../firebase-utils/converter";
import { prodDB } from "../firebase-utils/firebase";
import type { MasterStateEntity } from "../models/global";

export type MasterStateRepo = {
  get: () => Promise<MasterStateEntity | undefined>;
  set: (state: MasterStateEntity) => Promise<void>;
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

export const masterRepository = masterStateRepoFactory(prodDB);
