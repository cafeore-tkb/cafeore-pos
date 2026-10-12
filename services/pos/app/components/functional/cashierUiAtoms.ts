import { atom } from "jotai";

/**
 * UI state: cashier screen only.
 * 分離しておくことで、ドメイン状態とは独立に再利用・置換しやすくする。
 */
const cashierDescCommentAtom = atom("");
const cashierMenuOpenAtom = atom(false);
const cashierServiceActiveAtom = atom(false);
// 「常に返金（キャンセルしない）」。オンなら Square の決済は、注文を登録したらすぐ返金する（注文は残す）。
// 本番で消し忘れないよう、ブラウザには覚えず、ページを読み込み直すとオフに戻る。
const cashierAutoSquareRefundAtom = atom(false);

export {
  cashierAutoSquareRefundAtom,
  cashierDescCommentAtom,
  cashierMenuOpenAtom,
  cashierServiceActiveAtom,
};
