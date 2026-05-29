import { atom } from "jotai";

/**
 * UI state: cashier screen only.
 * 分離しておくことで、ドメイン状態とは独立に再利用・置換しやすくする。
 */
const cashierDescCommentAtom = atom("");
const cashierMenuOpenAtom = atom(false);
const cashierServiceActiveAtom = atom(false);

export {
  cashierDescCommentAtom,
  cashierMenuOpenAtom,
  cashierServiceActiveAtom,
};
