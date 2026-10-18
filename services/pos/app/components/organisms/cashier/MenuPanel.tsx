import {
  type ColorSetting,
  type ItemType,
  type MenuEntity,
  type WithId,
  readableTextColor,
  resolveItemColor,
  useColorSettings,
} from "@cafeore/common";
import { CircleHelp } from "lucide-react";
import { cn } from "~/lib/utils";
import { formatYen } from "~/lib/yen";
import { PAYMENT_KEYS } from "../../functional/cashierDraft";
import { squarePaymentTypeLabel } from "../SquarePaymentDialog";

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
export const groupByItemType = (menus: WithId<MenuEntity>[]): MenuGroup[] => {
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
  // ホットなどの既存の並びを保ち、アイス・ミルクとその他はそれぞれ独立した段へ。
  const lowerRow = ({ itemType }: MenuGroup) =>
    itemType.iced_brew || itemType.name === "ice" || itemType.name === "milk";
  const otherRow = ({ itemType }: MenuGroup) => itemType.name === "others";
  const rows = [
    {
      key: "main",
      groups: groups.filter((group) => !lowerRow(group) && !otherRow(group)),
    },
    { key: "ice-milk", groups: groups.filter(lowerRow) },
    { key: "others", groups: groups.filter(otherRow) },
  ];
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
        <div className="flex flex-col gap-3.5">
          {rows.map((row) => (
            <div
              key={row.key}
              className="grid grid-cols-4 items-start gap-x-2.5 gap-y-3.5 empty:hidden"
            >
              {row.groups.map(({ itemType, menus }) => {
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
          ))}
        </div>
      </div>
      <RegisterKeyHints exampleKeys={exampleKeys} className="px-5 pb-3.5" />
    </div>
  );
};

/** 決済手段のキーの案内（「Alt+C 現金・Alt+T カード・…」） */
const paymentKeyHint = PAYMENT_KEYS.map(
  ({ code, payment }) =>
    `Alt+${code.replace(/^Key/, "")} ${
      payment === "cash" ? "現金" : squarePaymentTypeLabel[payment]
    }`,
).join("・");

/** キーの案内は「？」にまとめ、必要なときだけ開く */
export const RegisterKeyHints = ({
  exampleKeys,
  className,
}: {
  /** 商品キーの例（「^ ¥ [」）。無ければ出さない */
  exampleKeys: string;
  className?: string;
}) => (
  <div className={cn("flex flex-none justify-end", className)}>
    <details
      className="group relative"
      onKeyDown={(event) => event.stopPropagation()}
    >
      <summary
        aria-label="キーボード操作の説明"
        title="キーボード操作"
        className="flex h-10 w-10 cursor-pointer touch-manipulation list-none items-center justify-center rounded-full text-stone-500 hover:bg-stone-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-stone-500 group-open:bg-stone-100 [&::-webkit-details-marker]:hidden"
      >
        <CircleHelp className="h-5 w-5" aria-hidden="true" />
      </summary>
      <div className="absolute right-0 bottom-full z-50 mb-2 flex max-h-[60vh] w-80 max-w-[calc(100vw-2rem)] flex-col gap-2 overflow-y-auto rounded-xl border border-stone-200 bg-white p-4 text-left text-sm text-stone-600 shadow-lg">
        <p className="font-bold text-stone-800">キーボード操作</p>
        {exampleKeys && <p>{exampleKeys} … 商品キー</p>}
        <p>Enter・→ 一括会計</p>
        <p>
          ↑ ↓ 商品 → 割引 → 備考・数字で指名（1〜6、0 でなし）・Space
          で指名／備考・Backspace で削除
        </p>
        <p>
          会計中は ↑ ↓ で決済手段・Enter で確定／決済（金額が空ならちょうど）
        </p>
        <p>{paymentKeyHint} ですぐ会計</p>
        <p>Esc 取消</p>
      </div>
    </details>
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
      </span>
    </button>
  );
};
