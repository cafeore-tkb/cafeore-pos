// mobile は今も Firestore の注文を見ている（停止中）。POS は API に移ったので、
// Firestore を使う処理は mobile だけに置く（以前は @cafeore/common の firebase-utils にあった）。
import { OrderEntity, type WithId, orderSchema } from "@cafeore/common";
import { type FirebaseOptions, initializeApp } from "firebase/app";
import {
  type DocumentData,
  type FirestoreDataConverter,
  type QueryConstraint,
  type QueryDocumentSnapshot,
  type SnapshotOptions,
  Timestamp,
  collection,
  doc,
  getFirestore,
  initializeFirestore,
  onSnapshot,
  query,
} from "firebase/firestore";
import type { SWRSubscription } from "swr/subscription";

const firebaseConfig: FirebaseOptions = {
  apiKey: "AIzaSyC3llKAZQOVQEFV0-0xHiseDB55YXJilHM",
  authDomain: "cafeore-2024.firebaseapp.com",
  projectId: "cafeore-2024",
  storageBucket: "cafeore-2024.appspot.com",
  messagingSenderId: "715397785293",
  appId: "1:715397785293:web:b84ff1ca0163a1f8b46b84",
};

const app = initializeApp(firebaseConfig);

initializeFirestore(app, {
  ignoreUndefinedProperties: true,
});

const prodDB = getFirestore(app);

// Zod では Firestore の Timestamp をパースできないので、先に Date にしておく
const parseDateProperty = (value: unknown): unknown => {
  if (value instanceof Timestamp) return value.toDate();
  if (Array.isArray(value)) return value.map(parseDateProperty);
  if (Object.prototype.toString.call(value) === "[object Object]") {
    return Object.fromEntries(
      Object.entries(value as DocumentData).map(([k, v]) => [
        k,
        parseDateProperty(v),
      ]),
    );
  }
  return value;
};

/**
 * Firestore のデータを OrderEntity に変換する
 */
export const orderConverter: FirestoreDataConverter<WithId<OrderEntity>> = {
  toFirestore: (order) => {
    // Zod のパースを挟まないと、Entity の getter が無視され private プロパティが
    // 保存されてしまう。id はドキュメント ID なので本文には含めない
    const { id: _id, ...data } = orderSchema.parse(order);
    return data;
  },
  fromFirestore: (
    snapshot: QueryDocumentSnapshot,
    options: SnapshotOptions,
  ): WithId<OrderEntity> => {
    // id は Firestore のドキュメント ID を使う
    const data = parseDateProperty({
      ...snapshot.data(options),
      id: snapshot.id,
    });
    return OrderEntity.fromOrder(orderSchema.required().parse(data));
  },
};

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
