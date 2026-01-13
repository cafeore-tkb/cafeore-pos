import { z } from "zod";
import type { WithId } from "../lib/typeguard";

export const itemtypes = [
  "hot",
  "ice",
  "hotOre",
  "iceOre",
  "milk",
  "others",
] as const;

export const itemSchema = z.object({
  id: z.string().optional(), // Firestore のドキュメント ID
  name: z.string({ required_error: "名前が未入力です" }),
  price: z.number({ required_error: "価格が未入力です" }),
  type: z.enum(itemtypes, {
    required_error: "種類が未選択です",
    invalid_type_error: "不正な種類です",
  }),
  assignee: z.string().nullable(),
});

export type Item = z.infer<typeof itemSchema>;

export type ItemType = Item["type"];

export const type2label = {
  hot: "ホット",
  ice: "アイス",
  hotOre: "ホットオレ",
  iceOre: "アイスオレ",
  milk: "アイスミルク",
  others: "その他",
} as const satisfies Record<ItemType, string>;

export class ItemEntity implements Item {
  private constructor(
    private readonly _id: string | undefined,
    private readonly _name: string,
    private readonly _price: number,
    private readonly _type: ItemType,
    private _assignee: string | null,
  ) {}

  static createNew({ name, price, type }: Omit<Item, "assignee">): ItemEntity {
    return new ItemEntity(undefined, name, price, type, null);
  }

  static fromItem(item: WithId<Item>): WithId<ItemEntity>;
  static fromItem(item: Item): ItemEntity;
  static fromItem(item: WithId<Item> | Item): ItemEntity {
    return new ItemEntity(
      item.id,
      item.name,
      item.price,
      item.type,
      item.assignee,
    );
  }

  // --------------------------------------------------
  // getter / setter
  // --------------------------------------------------

  get id() {
    return this._id;
  }

  get name() {
    return this._name;
  }

  get price() {
    return this._price;
  }

  get type() {
    return this._type;
  }

  get assignee() {
    return this._assignee;
  }
  set assignee(assignee: string | null) {
    if (assignee === "") {
      this._assignee = null;
    } else {
      this._assignee = assignee;
    }
  }

  // --------------------------------------------------
  // methods
  // --------------------------------------------------

  /**
   * ItemEntity をメソッドを持たない Item に変換する
   * @returns Item
   */
  toItem(): WithId<Item>;
  toItem(): Item;
  toItem(): WithId<Item> | Item {
    return {
      id: this.id,
      name: this.name,
      price: this.price,
      type: this.type,
      assignee: this.assignee,
    };
  }

  /**
   * ItemEntity を複製する
   * メソッドを含む Entity は structualClone などで複製できないため、このメソッドを使う
   */
  clone(): WithId<ItemEntity>;
  clone(): ItemEntity;
  clone(): WithId<ItemEntity> | ItemEntity {
    return ItemEntity.fromItem(this.toItem());
  }
}

// *Response*系はAPI Response用の一時的なもの
export const itemTypeResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  display_name: z.string(),
});

export const menuItemResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  price: z.number(),
});

export const itemResponseSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string({ required_error: "名前が未入力です" }),
  abbr: z.string({ required_error: "略称がありません" }),
  key: z.string({ required_error: "キー割り当てがありません" }),
  item_type_id: z.string({ required_error: "不正なタイプです" }).uuid(),
  menu_items: z.array(menuItemResponseSchema).optional(),
});

export const itemsResponseSchema = z.array(itemResponseSchema);

export type ItemResponse = z.infer<typeof itemResponseSchema>;

export type ItemTypeResponse = z.infer<typeof itemTypeResponseSchema>;
