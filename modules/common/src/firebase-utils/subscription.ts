import {
  type FirestoreDataConverter,
  type QueryConstraint,
  collection,
  doc,
  onSnapshot,
  query,
} from "firebase/firestore";
import type { SWRSubscription } from "swr/subscription";
import { prodDB } from "./firebase";

/**
 * Firestore のコレクションを監視する SWRSubscription を生成する
 */
export const collectionSub = <T>(
  { converter }: { converter: FirestoreDataConverter<T> },
  ...queryConstraints: QueryConstraint[]
) => {
  const sub: SWRSubscription<string, T[], Error> = (key, { next }) => {
    const unsub = onSnapshot(
      query(collection(prodDB, key), ...queryConstraints).withConverter(
        converter,
      ),
      (snapshot) => {
        next(
          null,
          snapshot.docs.map((doc) => doc.data()),
        );
      },
      (err) => {
        next(err);
      },
    );
    return unsub;
  };
  return sub;
};

export const documentSub = <T>({
  converter,
}: { converter: FirestoreDataConverter<T> }) => {
  const sub: SWRSubscription<string[], T, Error> = (
    [collectionName, ...keys],
    { next },
  ) => {
    const coll = collection(prodDB, collectionName);
    const unsub = onSnapshot(
      doc(coll, ...keys).withConverter(converter),
      (snapshot) => {
        next(null, snapshot.data());
      },
      (err) => {
        next(err);
      },
    );
    return unsub;
  };
  return sub;
};
