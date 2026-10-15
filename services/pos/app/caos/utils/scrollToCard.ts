// 盤面のカードを見える所までスクロールする（番号で探したカード・D で統合したカード）。
// カードを並べた所（A のタイムラインと未割当の帯・C のドリッパーの列と右の注文の列・D の表と右の注文内容）のカードには
// data-search-key（カードの key）を付けておく。同じカードが 2 か所にあれば（C の列と右の注文の列など）、どちらもその枠の中でスクロールする。
// A のタイムラインはこれを使わず、key で引いたカードを useTimelineScroll が左端の列のすぐ右まで動かす

/** カード（key）の要素のセレクター */
export const cardSelector = (key: string) =>
  `[data-search-key="${CSS.escape(key)}"]`;

/**
 * カード（key）を、並べた枠の中で見える所までスクロールする（縦は見えるだけ、横は真ん中へ）。
 * 縦を真ん中にすると、縦をスクロールさせない枠（A の未割当の帯は overflow-y-hidden）の中身もずれて戻せなくなる。
 * 枠の端に固定したもの（D の表の見出し）に隠れないよう、カードの側に scroll-margin を付ける
 */
export const scrollCardIntoView = (key: string) => {
  for (const element of document.querySelectorAll(cardSelector(key)))
    element.scrollIntoView({
      block: "nearest",
      inline: "center",
      behavior: "smooth",
    });
};
