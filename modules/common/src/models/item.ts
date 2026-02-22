import { z } from "zod";
import type { WithId } from "../lib/typeguard";

export const itemTypeSchema = z.object({
  id: z.string(),
  name: z.string(),
  display_name: z.string(),
});

export const itemSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string({ required_error: "名前が未入力です" }),
  abbr: z.string({ required_error: "略称がありません" }),
  price: z.number(),
  key: z.string({ required_error: "キー割り当てがありません" }),
  item_type: itemTypeSchema,
  assignee: z.string().nullable(),
});

export type Item = z.infer<typeof itemSchema>;

export type ItemType = z.infer<typeof itemTypeSchema>;

export class ItemEntity implements Item {
  private constructor(
    private readonly _id: string | undefined,
    private readonly _name: string,
    private readonly _abbr: string,
    private readonly _price: number,
    private readonly _key: string,
    private readonly _item_type: ItemType,
    private _assignee: string | null,
  ) {}

  static createNew({
    name,
    abbr,
    price,
    key,
    item_type,
  }: Omit<Item, "assignee">): ItemEntity {
    return new ItemEntity(undefined, name, abbr, price, key, item_type, null);
  }

  static fromItem(item: WithId<Item>): WithId<ItemEntity>;
  static fromItem(item: Item): ItemEntity;
  static fromItem(item: WithId<Item> | Item): ItemEntity {
    return new ItemEntity(
      item.id,
      item.name,
      item.abbr,
      item.price,
      item.key,
      item.item_type,
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

  get abbr() {
    return this._abbr;
  }

  get price() {
    return this._price;
  }

  get key() {
    return this._key;
  }

  get item_type() {
    return this._item_type;
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
      abbr: this.abbr,
      price: this.price,
      key: this.key,
      item_type: this.item_type,
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
