import { atom } from "jotai";

/**
 * UI state: cashier screen only.
 * 分離しておくことで、ドメイン状態とは独立に再利用・置換しやすくする。
 */
// 「常に返金（キャンセルしない）」。オンなら Square の決済は、注文を登録したらすぐ返金する（注文は残す）。
// 本番で消し忘れないよう、ブラウザには覚えず、ページを読み込み直すとオフに戻る。
const cashierAutoSquareRefundAtom = atom(false);

// 「常に返金」のトグルを出すか。本番（VITE_DEPLOY_ENV が production）と staging・sandbox では出さない。
// 本番に出てしまう方が困るので、出すのは PR のプレビュー（preview）とローカルの dev だけにし、
// 値の無いビルド（ローカルの vite build など）でも出さない。
// 出さなければ上の atom は false のままなので、返金もしない
const autoSquareRefundAvailable =
  import.meta.env.DEV || import.meta.env.VITE_DEPLOY_ENV === "preview";

export { autoSquareRefundAvailable, cashierAutoSquareRefundAtom };
