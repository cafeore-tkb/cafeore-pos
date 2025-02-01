/**
 * オブジェクトに id プロパティを持っていることを保証するユーティリティ型
 */
export type WithId<T extends { id?: unknown }> = T &
  Record<"id", NonNullable<T["id"]>>;

/**
 * オブジェクトが id プロパティを持っているかどうかを判定する
 * TypeGuard として使用する
 *
 * @param obj 判定するオブジェクト
 * @returns obj が id プロパティを持っている場合は true
 * @example
 * const obj = { id: 1, name: "name" };
 * if (hasId(obj)) {
 *  console.log(obj.id);
 * }
 */
export const hasId = <T extends { id?: unknown }>(obj: T): obj is WithId<T> => {
  return obj.id !== undefined && obj.id !== null;
};

/**
 * オブジェクトに指定したキーが含まれているかどうかを判定する
 *
 * @param obj key が含まれているか判定するオブジェクト
 * @param key obj が持っているか判定するキー
 * @returns key が obj に含まれていることを保証し true を返す
 */
export const IncludedIn = <T extends object, K extends keyof T>(
  obj: T,
  key: string | number | symbol,
): key is K => {
  return key in obj;
};
