import { useState } from "react";

/**
 * この端末にだけ覚える画面の設定（localStorage。DB には書かない）。覚えたものが無い・形が違う・読めないときは initial。
 * 書けないときは、開いている間だけ持つ
 */
export const useDeviceSetting = <T>(key: string, initial: T) => {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
      return typeof stored === typeof initial && stored !== null
        ? (stored as T)
        : initial;
    } catch {
      return initial;
    }
  });
  const save = (next: T) => {
    setValue(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      // 覚えられなくても、開いている間は使える
    }
  };
  return [value, save] as const;
};
