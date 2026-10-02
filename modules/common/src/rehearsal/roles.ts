// 過去の商品 id → 役割カテゴリ。
//
// sohosai-analysis の `ITEM_ROLES`（2025/nisui/cafeore_analysis/R/import_orders.R）の写し。
// 生成器が引く「注文の組」はこの役割で表すので、定義が向こうとずれると
// docs/python-track.md §12 の数値と合わなくなる。向こうが変わったらここも直すこと。
//
// 物販（goods）は杯に数えない。

export const GOODS_ROLE = "goods";

export const ITEM_ROLES: Readonly<Record<string, string>> = {
  "02_cafeore_brend": "house_blend",
  "01_beppin_brend": "signature_blend",
  "01_yushou_brend": "signature_blend",
  "01_yukari_brend": "signature_blend",
  "08_special_mocha_blend": "signature_blend",
  "51_item_yushou": "signature_blend",
  "04_mandheling": "single_origin",
  "04_kilimanjaro": "single_origin",
  "05_pink_bourbon": "single_origin",
  "06_costa_rica_red_honey": "single_origin",
  "06_toraja": "single_origin",
  "03_special": "premium",
  "03_Lychee": "premium",
  "07_blumoun": "premium",
  "10_ice_coffee": "ice_coffee",
  "20_hot_ore": "hot_ore",
  "30_ice_ore": "ice_ore",
  "40_ice_milk": "ice_milk",
  "50_coaster": GOODS_ROLE,
  "51_tote_yukari": GOODS_ROLE,
  "52_tote": GOODS_ROLE,
};

// 表に無い id は止める。黙って「その他」に落とすと構成比がずれる（R 側と同じ方針）。
export const roleOf = (itemId: string): string => {
  const role = ITEM_ROLES[itemId];
  if (role === undefined) {
    throw new Error(
      `役割が決まっていない商品 id です: ${itemId}（ITEM_ROLES に追記してください）`,
    );
  }
  return role;
};

/** 役割カテゴリの表示名。2026 年のメニューへの割り当てが決まるまでは、これを画面に出す */
export const ROLE_LABELS: Readonly<Record<string, string>> = {
  house_blend: "珈琲・俺ブレンド",
  signature_blend: "看板ブレンド",
  single_origin: "シングルオリジン",
  premium: "限定・高級",
  ice_coffee: "アイスコーヒー",
  hot_ore: "ホットオレ",
  ice_ore: "アイスオレ",
  ice_milk: "アイスミルク",
  [GOODS_ROLE]: "物販",
};
