import {
  type ColorSetting,
  type ItemType,
  type MenuEntity,
  type WithId,
  readableTextColor,
  resolveItemColor,
  useColorSettings,
} from "@cafeore/common";
import { KeyHint } from "~/components/atoms/KeyHint";
import { cn } from "~/lib/utils";
import { formatYen } from "~/lib/yen";

type props = {
  menus: WithId<MenuEntity>[];
  onAdd: (menu: WithId<MenuEntity>) => void;
  /** 会計の段階・先払いがある間。薄くして押せなくする */
  disabled: boolean;
};

type MenuGroup = {
  itemType: ItemType;
  menus: WithId<MenuEntity>[];
};

/** 色の設定が無い種別の見出しの印の色 */
const NO_COLOR = "#a8a29e";
/** 1 つの種別が横に並べる商品の数（メニューの列の数） */
const COLUMNS = 4;

/**
 * メニューを種別ごとにまとめる。メニューは API の並び（優先度の大きい順）のままで、
 * 種別の並びはメニューに最初に出てきた順（その種別で一番大きい優先度の順）
 */
const groupByItemType = (menus: WithId<MenuEntity>[]): MenuGroup[] => {
  const groups = new Map<string, MenuGroup>();
  for (const menu of menus) {
    const itemType = menu.item_type;
    const key = itemType.id ?? itemType.name;
    const group = groups.get(key);
    if (group) {
      group.menus.push(menu);
    } else {
      groups.set(key, { itemType, menus: [menu] });
    }
  }
  return [...groups.values()];
};

/**
 * レジのメニューの色（色の設定の cashier）。1 品だけのメニューはアイテムの設定も見る。
 * 設定が無ければ undefined（白いボタン）
 */
export const menuColor = (
  colorSettings: ColorSetting[],
  menu: MenuEntity,
): string | undefined => {
  const target =
    menu.items.length === 1
      ? menu.items[0].item
      : { item_type: menu.item_type };
  return resolveItemColor(colorSettings, target, "cashier");
};

/**
 * レジの左の列。メニューを種別ごとに並べ、押すと商品を足す
 */
export const MenuPanel = ({ menus, onAdd, disabled }: props) => {
  const { colorSettings } = useColorSettings();
  const groups = groupByItemType(menus);
  const exampleKeys = exampleMenuKeys(menus);

  return (
    <div
      aria-disabled={disabled}
      className={cn(
        "flex min-h-0 flex-col gap-3 overflow-hidden transition-opacity duration-150",
        disabled && "pointer-events-none opacity-42",
      )}
    >
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-4 pb-2">
        <div className="grid grid-flow-row-dense grid-cols-4 gap-x-2.5 gap-y-3.5">
          {groups.map(({ itemType, menus }) => {
            const span = Math.min(menus.length, COLUMNS);
            const typeColor =
              resolveItemColor(
                colorSettings,
                { item_type: itemType },
                "cashier",
              ) ?? NO_COLOR;
            return (
              <div
                key={itemType.id ?? itemType.name}
                className="flex min-w-0 flex-col gap-2"
                style={{ gridColumn: `span ${span}` }}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 flex-none rounded-[3px]"
                    style={{ backgroundColor: typeColor }}
                  />
                  <span className="truncate font-bold text-[13px] text-stone-600 tracking-[.06em]">
                    {itemType.display_name}
                  </span>
                </div>
                <div
                  className="grid gap-2.5"
                  style={{
                    gridTemplateColumns: `repeat(${span}, minmax(0, 1fr))`,
                  }}
                >
                  {menus.map((menu) => (
                    <MenuButton
                      key={menu.id}
                      menu={menu}
                      color={menuColor(colorSettings, menu)}
                      disabled={disabled}
                      onAdd={onAdd}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <RegisterKeyHints exampleKeys={exampleKeys} className="px-5 pb-3.5" />
    </div>
  );
};

/** レジの左の列の下に出すキーの案内 */
export const RegisterKeyHints = ({
  exampleKeys,
  className,
}: {
  /** 商品キーの例（「^ ¥ [」）。無ければ出さない */
  exampleKeys: string;
  className?: string;
}) => (
  <div
    className={cn(
      "flex flex-none flex-wrap gap-x-4.5 gap-y-1.5 text-stone-500 text-xs",
      className,
    )}
  >
    {exampleKeys && <span>{exampleKeys} … 商品キー</span>}
    <span>Enter・→ 一括会計</span>
    <span>
      ↑ ↓ 商品 → 割引 → 備考・数字で指名（1〜6、0 でなし）・Space
      で指名／備考・Backspace で削除
    </span>
    <span>
      会計中は ↑ ↓ で決済手段・Enter で確定／決済（金額が空ならちょうど）
    </span>
    <span>Esc 取消</span>
  </div>
);

/** 商品キーの例（メニューの先頭の 3 つ） */
export const exampleMenuKeys = (menus: WithId<MenuEntity>[]) =>
  menus
    .slice(0, 3)
    .map((menu) => menu.key)
    .join(" ");

const MenuButton = ({
  menu,
  color,
  disabled,
  onAdd,
}: {
  menu: WithId<MenuEntity>;
  color: string | undefined;
  disabled: boolean;
  onAdd: (menu: WithId<MenuEntity>) => void;
}) => {
  const style =
    color === undefined
      ? undefined
      : {
          backgroundColor: color,
          borderColor: color,
          color: readableTextColor(color),
        };
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onAdd(menu)}
      title={menu.name}
      className={cn(
        "flex h-18 min-w-0 flex-col justify-between rounded-[10px] border px-3 py-2.5 text-left transition-transform active:scale-[.97]",
        color === undefined && "border-stone-300 bg-white text-stone-900",
      )}
      style={style}
    >
      <span className="truncate font-bold text-lg leading-tight">
        {menu.abbr}
      </span>
      <span className="flex items-center justify-between gap-1.5">
        <span
          className={cn(
            "text-[13px] tabular-nums",
            color === undefined ? "text-stone-600" : "opacity-85",
          )}
        >
          {formatYen(menu.price)}
        </span>
        <KeyHint className="font-normal">{menu.key}</KeyHint>
      </span>
    </button>
  );
};
