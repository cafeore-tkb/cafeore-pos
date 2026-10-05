import type { WithId } from "../lib/typeguard";
import type { ColorSetting } from "../models/colorSetting";
import type { ItemEntity, ItemType } from "../models/item";
import type { MenuEntity } from "../models/menu";
import type { OrderEntity, OrderPayment } from "../models/order";

export type BaseRepository<T extends { id?: unknown }> = {
  save(data: T): Promise<WithId<T>>;
  delete(id: string): Promise<void>;
  findById(id: string): Promise<WithId<T> | null>;
  findAll(): Promise<WithId<T>[]>;
};

export type ItemRepository = BaseRepository<ItemEntity>;
export type MenuRepository = BaseRepository<MenuEntity>;

export type ItemTypeRepository = BaseRepository<ItemType>;

// 背景色設定は対象と画面の組で一意なので、save は作成・更新を兼ねる
export type ColorSettingRepository = {
  save(data: ColorSetting): Promise<WithId<ColorSetting>>;
  delete(id: string): Promise<void>;
  findAll(): Promise<WithId<ColorSetting>[]>;
};

export type OrderRepository = Omit<BaseRepository<OrderEntity>, "save"> & {
  /**
   * 注文を保存する。payment は新規作成のときだけ使う（省略時は現金）。
   */
  save(
    order: OrderEntity,
    payment?: OrderPayment,
  ): Promise<WithId<OrderEntity>>;
  ready(id: string): Promise<void>;
  serve(id: string): Promise<void>;
  addComment(id: string, author: string, text: string): Promise<void>;
};
