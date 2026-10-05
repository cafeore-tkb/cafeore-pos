import { z } from "zod";
import type { WithId } from "../lib/typeguard";
import { ItemEntity, itemSchema } from "./item";

export const menuItemSchema = z.object({
  item: itemSchema.required(),
  quantity: z.number().int().positive(),
});

export const menuSchema = z.object({
  id: z.string().uuid().optional(),
  orderMenuId: z.string().uuid().optional(),
  name: z.string(),
  abbr: z.string(),
  price: z.number().int(),
  key: z.string(),
  items: z.array(menuItemSchema).min(1),
  assignee: z.string().nullable(),
});

export type Menu = z.infer<typeof menuSchema>;

type LegacyMenu = {
  id?: string;
  name: string;
  abbr: string;
  price: number;
  key: string;
  item_type: z.infer<typeof itemSchema>["item_type"];
  assignee: string | null;
};

export class MenuEntity implements Menu {
  private constructor(
    private readonly _id: string | undefined,
    private readonly _name: string,
    private readonly _abbr: string,
    private readonly _price: number,
    private readonly _key: string,
    private readonly _items: { item: WithId<ItemEntity>; quantity: number }[],
    private _assignee: string | null,
    private readonly _orderMenuId?: string,
  ) {}

  static createNew(menu: Omit<Menu, "id" | "assignee">): MenuEntity {
    return MenuEntity.fromMenu({ ...menu, assignee: null });
  }

  static fromMenu(menu: WithId<Menu>): WithId<MenuEntity>;
  static fromMenu(menu: WithId<LegacyMenu>): WithId<MenuEntity>;
  static fromMenu(menu: Menu): MenuEntity;
  static fromMenu(menu: LegacyMenu): MenuEntity;
  static fromMenu(
    menu: WithId<Menu> | Menu | WithId<LegacyMenu> | LegacyMenu,
  ): WithId<MenuEntity> | MenuEntity {
    const items =
      "items" in menu
        ? menu.items
        : [
            {
              item: {
                id: menu.id ?? "",
                name: menu.name,
                abbr: menu.abbr,
                item_type: menu.item_type,
              },
              quantity: 1,
            },
          ];
    return new MenuEntity(
      menu.id,
      menu.name,
      menu.abbr,
      menu.price,
      menu.key,
      items.map(({ item, quantity }) => ({
        item: ItemEntity.fromItem(item),
        quantity,
      })),
      menu.assignee,
      "orderMenuId" in menu ? menu.orderMenuId : undefined,
    );
  }

  get id() {
    return this._id;
  }
  get name() {
    return this._name;
  }
  get orderMenuId() {
    return this._orderMenuId;
  }
  get abbr() {
    return this._abbr;
  }
  get price() {
    return this._price;
  }
  get key() {
    return this._key;
  }
  get items() {
    return this._items;
  }
  get item_type() {
    return this._items[0].item.item_type;
  }
  get assignee() {
    return this._assignee;
  }
  set assignee(value: string | null) {
    this._assignee = value === "" ? null : value;
  }

  toMenu(): WithId<Menu>;
  toMenu(): Menu;
  toMenu(): WithId<Menu> | Menu {
    return {
      id: this.id,
      orderMenuId: this.orderMenuId,
      name: this.name,
      abbr: this.abbr,
      price: this.price,
      key: this.key,
      items: this.items.map(({ item, quantity }) => ({
        item: item.toItem(),
        quantity,
      })),
      assignee: this.assignee,
    };
  }

  clone(): WithId<MenuEntity>;
  clone(): MenuEntity;
  clone(): WithId<MenuEntity> | MenuEntity {
    return MenuEntity.fromMenu(this.toMenu());
  }
}
