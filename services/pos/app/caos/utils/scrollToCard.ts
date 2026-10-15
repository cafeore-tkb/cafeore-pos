// 盤面のカードを見える所までスクロールする（番号で探したカード・D で統合したカード）。
// カードを並べた所（A のタイムラインと未割当の帯・C のドリッパーの列と右の注文の列・D の表と右の注文内容）のカードには
// data-search-key（カードの key）を付けておく。同じカードが 2 か所にあれば（C の列と右の注文の列など）、どちらもその枠の中でスクロールする

/** カード（key）の要素のセレクター */
export const cardSelector = (key: string) =>
  `[data-search-key="${CSS.escape(key)}"]`;

/**
 * カード（key）を、並べた枠の真ん中までスクロールする（スクロールできない向き・枠では動かない）。
 * 真ん中なので、D の表の上下に固定した見出し・「次へ」の下には入らない
 */
export const scrollCardIntoView = (key: string) => {
  for (const element of document.querySelectorAll(cardSelector(key)))
    element.scrollIntoView({
      block: "center",
      inline: "center",
      behavior: "smooth",
    });
};
