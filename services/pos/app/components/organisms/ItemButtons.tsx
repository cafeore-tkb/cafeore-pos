import {
  type ItemType,
  type MenuEntity,
  type WithId,
  readableTextColor,
  resolveItemColor,
  useColorSettings,
} from "@cafeore/common";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";

type props = {
  items: WithId<MenuEntity>[];
  addItem: (item: WithId<MenuEntity>) => void;
  /** 外側の枠に足すクラス（既定の h-screen や幅を変えるとき） */
  className?: string;
};

type ItemTypeGroup = {
  itemType: ItemType;
  items: WithId<MenuEntity>[];
};

/**
 * メニューを種別ごとにまとめる。種別の並びはメニューに最初に出てきた順
 */
const groupByItemType = (items: WithId<MenuEntity>[]): ItemTypeGroup[] => {
  const groups = new Map<string, ItemTypeGroup>();
  for (const item of items) {
    const itemType = item.item_type;
    const key = itemType.id ?? itemType.name;
    const group = groups.get(key);
    if (group) {
      group.items.push(item);
    } else {
      groups.set(key, { itemType, items: [item] });
    }
  }
  return [...groups.values()];
};

export const ItemButtons = ({ items, addItem, className }: props) => {
  const groups = groupByItemType(items);
  const { colorSettings } = useColorSettings();

  // レジ画面の背景色設定を使う。1 品だけのメニューはアイテムの設定も見る。設定が無ければボタンの既定の色
  const buttonStyle = (menu: WithId<MenuEntity>) => {
    const target =
      menu.items.length === 1
        ? menu.items[0].item
        : { item_type: menu.item_type };
    const backgroundColor = resolveItemColor(colorSettings, target, "cashier");
    if (backgroundColor === undefined) return undefined;
    return { backgroundColor, color: readableTextColor(backgroundColor) };
  };
  return (
    <div className={cn("relative h-screen pr-5 pl-5", className)}>
      {groups.map(({ itemType, items }, index) => (
        <div key={itemType.id ?? itemType.name}>
          <div
            className={cn(
              "pb-3.75 pl-5 font-medium text-2xl",
              index === 0 ? "pt-5" : "pt-7.5",
            )}
          >
            {itemType.display_name}
          </div>
          <div
            className="grid grid-cols-3 items-center justify-items-start gap-7.5"
            style={{ gridTemplateRows: "auto" }}
          >
            {items.map((item) => (
              <Button
                key={item.id}
                className="h-12.5 w-37.5 text-lg hover:ring-4"
                style={buttonStyle(item)}
                onClick={() => {
                  addItem(item);
                }}
              >
                {item.abbr || item.name}
              </Button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};
