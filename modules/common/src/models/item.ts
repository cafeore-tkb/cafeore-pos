import { z } from "zod";
import type { WithId } from "../lib/typeguard";

// 判定に使う項目（カップを作る・抽出が要る・限定・アイス）は商品管理で種類ごとに設定し、API の値をそのまま使う。
// 種類の名前（hot / ice / milk / others など）で決め打ちしないこと。
// 項目を持つ前に保存したデータ（Firestore の注文や保存済みのレジ状態）には無いので、無ければ API の列の既定値と同じにする。
export const itemTypeSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  display_name: z.string(),
  /** 1杯ずつカップを作る（マスター・提供画面に出る）。グッズは false */
  makes_cup: z.boolean().default(true),
  /** 抽出が要る（割引の対象の杯数・ドリッパーの割り振りに数える）。ミルクやグッズは false */
  needs_brew: z.boolean().default(true),
  /** 上級生だけが淹れる（限定） */
  senior_only: z.boolean().default(false),
  /** アイスで淹れる（CaOS でアイスに対応していないドリッパーに割り振らない） */
  iced_brew: z.boolean().default(false),
});

export const itemSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string({ required_error: "名前が未入力です" }),
  abbr: z.string({ required_error: "略称が未入力です" }),
  item_type: itemTypeSchema,
});

export type Item = z.infer<typeof itemSchema>;
export type ItemType = z.infer<typeof itemTypeSchema>;

export class ItemEntity implements Item {
  private constructor(
    private readonly _id: string | undefined,
    private readonly _name: string,
    private readonly _abbr: string,
    private readonly _item_type: ItemType,
  ) {}

  static createNew(item: Omit<Item, "id">): ItemEntity {
    return new ItemEntity(undefined, item.name, item.abbr, item.item_type);
  }

  static fromItem(item: WithId<Item>): WithId<ItemEntity>;
  static fromItem(item: Item): ItemEntity;
  static fromItem(item: WithId<Item> | Item): ItemEntity {
    return new ItemEntity(item.id, item.name, item.abbr, item.item_type);
  }

  get id() {
    return this._id;
  }
  get name() {
    return this._name;
  }
  get abbr() {
    return this._abbr;
  }
  get item_type() {
    return this._item_type;
  }

  toItem(): WithId<Item>;
  toItem(): Item;
  toItem(): WithId<Item> | Item {
    return {
      id: this.id,
      name: this.name,
      abbr: this.abbr,
      item_type: this.item_type,
    };
  }

  clone(): WithId<ItemEntity>;
  clone(): ItemEntity;
  clone(): WithId<ItemEntity> | ItemEntity {
    return ItemEntity.fromItem(this.toItem());
  }
}
