import {
  type ColorSetting,
  masterDefaultColor,
  resolveItemColor,
} from "@cafeore/common";

// カードの背景色を、POS のマスターの画面のカップと同じにする。
// 1. 色の設定（商品の設定 > 種類の設定、画面は master）
// 2. 設定が無ければ、マスターの画面の既定の色（@cafeore/common の masterDefaultColor。マスターの画面と共通）
// 3. それも無ければ白
export const masterCardColor = (
  settings: ColorSetting[],
  item: { id?: string; name: string; typeId?: string; type: string },
): string =>
  resolveItemColor(
    settings,
    { id: item.id, item_type: { id: item.typeId } },
    "master",
  ) ??
  masterDefaultColor({ name: item.name, item_type: { name: item.type } }) ??
  "#ffffff";
