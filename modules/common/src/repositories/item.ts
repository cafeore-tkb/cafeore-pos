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
import { itemConverter } from "../firebase-utils/converter";
import { prodDB } from "../firebase-utils/firebase";
import { type WithId, hasId } from "../lib/typeguard";
import type { ItemEntity } from "../models/item";
import type { ItemRepository } from "./type";

// TODO(toririm): エラーハンドリングをやる
// Result型を使う NeverThrow を使ってみたい
export const itemRepoFactory = (db: Firestore): ItemRepository => {
  const update = async (
    item: WithId<ItemEntity>,
  ): Promise<WithId<ItemEntity>> => {
    const docRef = doc(db, "items", item.id).withConverter(itemConverter);
    await setDoc(docRef, item);
    return item;
  };

  const create = async (item: ItemEntity): Promise<WithId<ItemEntity>> => {
    const colRef = collection(db, "items").withConverter(itemConverter);
    const docRef = await addDoc(colRef, item);
    const resultDoc = await getDoc(docRef.withConverter(itemConverter));
    if (resultDoc.exists()) {
      return resultDoc.data();
    }
    throw new Error("Failed to save item");
  };

  return {
    save: async (item) => {
      if (hasId(item)) {
        return await update(item);
      }
      return await create(item);
    },

    delete: async (id) => {
      await deleteDoc(doc(db, "items", id));
    },

    findById: async (id) => {
      const docRef = doc(db, "items", id).withConverter(itemConverter);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        return docSnap.data();
      }
      return null;
    },

    findAll: async () => {
      const colRef = collection(db, "items").withConverter(itemConverter);
      const docSnaps = await getDocs(colRef);
      return docSnaps.docs.map((doc) => doc.data());
    },
  };
};

/**
 * @deprecated アイテムはソースコードに直接ハードコードするようになりました
 * @see `data/items.ts`
 */
export const itemRepository: ItemRepository = itemRepoFactory(prodDB);
