import {
  type PracticeDataOrder,
  assertNoPersonalFields,
  jstDate,
  mergePracticeFiles,
} from "@cafeore/common";

// 実データテストのデータを、利用者が選んだ手元の JSON から読む。
// 読むのも正規化（担当者名・指名・コメントを落とす）もこの端末のブラウザの中だけで、サーバーにも配信にも出さない。
// 正規化した後のデータだけを、この端末の IndexedDB に覚えておく（開き直しても選び直さなくてよいように）。
// IndexedDB が使えない端末（プライベートブラウズなど）では覚えないだけで、読み込みと練習はできる。

export interface LoadedPracticeData {
  /** どのデータか（例「2025年の実績」）。練習の表示に使う */
  label: string;
  /** 読み込んだファイルの名前（表示用） */
  files: string[];
  orders: PracticeDataOrder[];
  /** 読めなかった注文の数 */
  skipped: number;
  loadedAt: string;
}

export interface ReadResult {
  data: LoadedPracticeData | null;
  /** 読めなかったファイル（中身が JSON でない・空・注文が無い） */
  problems: string[];
}

const labelOf = (orders: PracticeDataOrder[]) => {
  const years = Array.from(
    new Set(
      orders.map((order) => jstDate(Date.parse(order.createdAt)).slice(0, 4)),
    ),
  ).sort();
  return `${years.join("・")}年の実績`;
};

/** 選んだファイル（day1・day2・day12 など）を読み、同じ注文は 1 件にまとめる */
export const readPracticeFiles = async (files: File[]): Promise<ReadResult> => {
  const jsons: unknown[] = [];
  const names: string[] = [];
  const problems: string[] = [];
  for (const file of files) {
    let json: unknown;
    try {
      const body = await file.text();
      if (body.trim() === "") {
        problems.push(`${file.name}（空のファイル）`);
        continue;
      }
      json = JSON.parse(body);
    } catch {
      problems.push(`${file.name}（JSON として読めません）`);
      continue;
    }
    if (mergePracticeFiles([json]).orders.length === 0) {
      problems.push(`${file.name}（注文がありません）`);
      continue;
    }
    jsons.push(json);
    names.push(file.name);
  }
  const { orders, skipped } = mergePracticeFiles(jsons);
  if (orders.length === 0) return { data: null, problems };
  // 念のため：写してはいけない項目が入っていたら覚えない・使わない
  assertNoPersonalFields(orders);
  return {
    data: {
      label: labelOf(orders),
      files: names,
      orders,
      skipped,
      loadedAt: new Date().toISOString(),
    },
    problems,
  };
};

const DB_NAME = "caos-practice-data";
const STORE = "data";
const KEY = "current";

const openDb = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE))
        request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("blocked"));
  });

const withStore = async <T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest,
): Promise<T> => {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const request = run(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve(request.result as T);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
};

const isLoaded = (value: unknown): value is LoadedPracticeData =>
  typeof value === "object" &&
  value !== null &&
  Array.isArray((value as LoadedPracticeData).orders) &&
  typeof (value as LoadedPracticeData).label === "string";

/** この端末に覚えている実データ。無い・読めないときは null */
export const loadStoredPracticeData =
  async (): Promise<LoadedPracticeData | null> => {
    try {
      const value = await withStore<unknown>("readonly", (store) =>
        store.get(KEY),
      );
      if (!isLoaded(value)) return null;
      assertNoPersonalFields(value.orders);
      return { ...value, files: Array.isArray(value.files) ? value.files : [] };
    } catch {
      return null;
    }
  };

/** この端末に覚えさせる。覚えられなかったら false（練習はそのままできる） */
export const storePracticeData = async (data: LoadedPracticeData) => {
  try {
    await withStore("readwrite", (store) => store.put(data, KEY));
    return true;
  } catch {
    return false;
  }
};

/** この端末に覚えている実データを消す */
export const clearStoredPracticeData = async () => {
  try {
    await withStore("readwrite", (store) => store.delete(KEY));
    return true;
  } catch {
    return false;
  }
};
