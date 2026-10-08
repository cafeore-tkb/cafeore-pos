import { z } from "zod";

export const colorTargetTypes = ["Item", "ItemType"] as const;
/**
 * 色の設定を使う画面
 * - cashier: レジのメニューのボタン
 * - cashier_order: レジの過去の注文のカード
 * - master・serve: マスター・提供画面のカップ
 */
export const colorScreens = [
  "cashier",
  "cashier_order",
  "master",
  "serve",
] as const;

export const colorSettingSchema = z.object({
  id: z.string().uuid().optional(),
  target_type: z.enum(colorTargetTypes),
  target_id: z.string().uuid(),
  screen: z.enum(colorScreens),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "色は #RRGGBB で指定します"),
});

export type ColorSetting = z.infer<typeof colorSettingSchema>;
export type ColorTargetType = ColorSetting["target_type"];
export type ColorScreen = ColorSetting["screen"];

type ColorTarget = {
  id?: string;
  item_type: { id?: string };
};

export const findColorSetting = <T extends ColorSetting>(
  settings: T[],
  targetType: ColorTargetType,
  targetId: string | undefined,
  screen: ColorScreen,
): T | undefined =>
  settings.find(
    (setting) =>
      setting.target_type === targetType &&
      setting.target_id === targetId &&
      setting.screen === screen,
  );

/**
 * アイテムの背景色を設定から引く
 * item の設定 > item_type の設定の順で探し、どちらも無ければ undefined を返す。
 * undefined のときは色を付けない（商品の種類や名前で既定の色を決め打ちしない）。
 */
export const resolveItemColor = (
  settings: ColorSetting[],
  item: ColorTarget,
  screen: ColorScreen,
): string | undefined => {
  if (item.id) {
    const itemSetting = findColorSetting(settings, "Item", item.id, screen);
    if (itemSetting) return itemSetting.color;
  }
  if (item.item_type.id) {
    const typeSetting = findColorSetting(
      settings,
      "ItemType",
      item.item_type.id,
      screen,
    );
    if (typeSetting) return typeSetting.color;
  }
  return undefined;
};

// マスターの画面の既定の背景色（Tailwind v4 の色を #RRGGBB にしたもの）。
// 色の設定が無いときに使う。POS のマスターの画面と CaOS のカードで同じ色にする。
const MASTER_DEFAULT_TYPE_COLORS: Record<string, string> = {
  ice: "#bedbff", // blue-200
  iceOre: "#b8e6fe", // sky-200
  milk: "#d1d5dc", // gray-300
};
// 名前を決め打ちして緑（green-300）にしている商品（以前からのマスターの画面の見た目）
const MASTER_DEFAULT_NAMED_COLOR = "#7bf1a8";
const MASTER_DEFAULT_NAMED_ITEMS = ["ブルマン", "ライチ"];

/**
 * マスターの画面の既定の背景色
 * 色の設定（resolveItemColor）が無いときに使う。種類ごとの色 > 名前で決め打ちした色の順で、
 * どちらにも当たらなければ undefined（カードのいつもの色）。
 */
export const masterDefaultColor = (item: {
  name: string;
  item_type: { name: string };
}): string | undefined =>
  MASTER_DEFAULT_TYPE_COLORS[item.item_type.name] ??
  (MASTER_DEFAULT_NAMED_ITEMS.includes(item.name)
    ? MASTER_DEFAULT_NAMED_COLOR
    : undefined);

/**
 * 背景色の上で読みやすい文字色を返す
 * 背景の相対輝度が高ければ黒、低ければ白にする。
 */
export const readableTextColor = (backgroundColor: string): string => {
  const channel = (offset: number) => {
    const value =
      Number.parseInt(backgroundColor.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const luminance =
    0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  // 黒・白それぞれとのコントラスト比が等しくなる輝度が境目
  return luminance > 0.179 ? "#000000" : "#ffffff";
};
