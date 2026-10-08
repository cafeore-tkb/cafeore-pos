import { readableTextColor } from "@cafeore/common";

// カードの見た目。マスターの画面の色の設定（color）があればその色で塗り、
// 文字色は背景色から決める（POS と共通の readableTextColor）。colored のカードの中の文字は色を継ぐ。
// 色の設定の無いカード（設定の無い商品・実データテストのカード）は白。
// 商品の種類や豆で色を決め打ちしない。
export const cardSurface = (card: { color?: string }) => {
  if (card.color) {
    const color = readableTextColor(card.color);
    return {
      className: "border-slate-300",
      style: { backgroundColor: card.color, color },
      dark: color === "#ffffff",
      colored: true,
    };
  }
  return {
    className: "bg-white border-slate-300 text-slate-900",
    style: undefined,
    dark: false,
    colored: false,
  };
};
