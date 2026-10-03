import { z } from "zod";

export const colorTargetTypes = ["Item", "ItemType"] as const;
export const colorScreens = ["master", "serve"] as const;

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
 * undefined のときは呼び出し側の既定の色を使う。
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
