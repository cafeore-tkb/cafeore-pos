import { readableTextColor } from "@cafeore/common";

// カードの色。管制盤 A・C・D と閲覧の画面のカードで共通。
// 指名のカードは CaOS の紫。それ以外は色の設定の色（color。画面 master）で塗り、色の無いカード（実データテスト）は白。
// 文字色は背景色から決める（POS と共通の readableTextColor）。カードの中の文字は色を継ぐ。
// 商品の種類や豆で色を決め打ちしない。
export const cardSurface = (card: {
  color?: string;
  preferredBaristaId?: number;
}) => {
  if (card.preferredBaristaId) {
    return {
      className: "border-violet-300 bg-violet-50 text-slate-900",
      style: undefined,
    };
  }
  const backgroundColor = card.color ?? "#ffffff";
  return {
    className: "border-slate-300",
    style: { backgroundColor, color: readableTextColor(backgroundColor) },
  };
};
