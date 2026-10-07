import { type ColorSetting, resolveItemColor } from "@cafeore/common";

// カードの背景色を、POS のマスターの画面のカップと同じにする。
// 1. 色の設定（商品の設定 > 種類の設定、画面は master）
// 2. 設定が無ければ、マスターの画面の既定の色（components/molecules/OrderInfoCard.tsx と揃える）
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
  MASTER_DEFAULT_COLORS[item.type] ??
  (MASTER_SPECIAL_NAMES.includes(item.name) ? GREEN_300 : WHITE);

// Tailwind（v4）の色を #RRGGBB にしたもの
const WHITE = "#ffffff";
const GREEN_300 = "#7bf1a8";

// OrderInfoCard のマスターの既定の色（種類ごと）
const MASTER_DEFAULT_COLORS: Record<string, string> = {
  ice: "#bedbff", // bg-blue-200
  iceOre: "#b8e6fe", // bg-sky-200
  milk: "#d1d5dc", // bg-gray-300
};

// OrderInfoCard で名前を決め打ちして緑（bg-green-300）にしている商品
const MASTER_SPECIAL_NAMES = ["ブルマン", "ライチ"];
