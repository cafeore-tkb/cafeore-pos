import { type ColorSetting, resolveItemColor } from "@cafeore/common";

// カードの背景色は、POS のマスターの画面のカップと同じく色の設定だけで決める
// （商品の設定 > 種類の設定、画面は master）。設定が無ければ undefined（カードは白）。
// 商品の種類や商品の名前で色を決め打ちしない。
export const masterCardColor = (
  settings: ColorSetting[],
  item: { id?: string; typeId?: string },
): string | undefined =>
  resolveItemColor(
    settings,
    { id: item.id, item_type: { id: item.typeId } },
    "master",
  );
