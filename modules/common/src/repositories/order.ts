import {
  type Firestore,
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
} from "firebase/firestore";
import { orderConverter } from "../firebase-utils/converter";
import { prodDB } from "../firebase-utils/firebase";
import { type WithId, hasId } from "../lib/typeguard";
import type { OrderEntity } from "../models/order";
import type { OrderRepository } from "./type";

// TODO(toririm): エラーハンドリングをやる
// Result型を使う NeverThrow を使ってみたい
export const orderRepoFactory = (db: Firestore): OrderRepository => {
  const update = async (
    order: WithId<OrderEntity>,
  ): Promise<WithId<OrderEntity>> => {
    const docRef = doc(db, "orders", order.id).withConverter(orderConverter);
    await setDoc(docRef, order);
    return order;
  };

  const create = async (order: OrderEntity): Promise<WithId<OrderEntity>> => {
    const colRef = collection(db, "orders").withConverter(orderConverter);
    const docRef = await addDoc(colRef, order);
    const resultDoc = await getDoc(docRef.withConverter(orderConverter));
    if (resultDoc.exists()) {
      return resultDoc.data();
    }
    throw new Error("Failed to save order");
  };

  return {
    save: async (order) => {
      if (hasId(order)) {
        return await update(order);
      }
      return await create(order);
    },

    delete: async (id) => {
      await deleteDoc(doc(db, "orders", id));
    },

    findById: async (id) => {
      const docRef = doc(db, "orders", id).withConverter(orderConverter);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        return docSnap.data();
      }
      return null;
    },

    findAll: async () => {
      const colRef = collection(db, "orders").withConverter(orderConverter);
      const docSnaps = await getDocs(colRef);
      return docSnaps.docs.map((doc) => doc.data());
    },
  };
};

export const orderRepository: OrderRepository = orderRepoFactory(prodDB);
