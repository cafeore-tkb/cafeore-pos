import type { WithId } from "../lib/typeguard";
import type { ColorSetting } from "../models/colorSetting";
import type { ItemEntity, ItemType } from "../models/item";
import type { MenuEntity } from "../models/menu";
import type { OrderEntity } from "../models/order";

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

export type SaveOrderOptions = {
  /**
   * 新しく作るときの、送り直しで同じ注文を二重に作らないためのキー（UUID）。
   * サーバーはこれを注文の ID にし、すでにあれば作らずにその注文を返す。送り直しでは同じキーを渡す
   */
  idempotencyKey?: string;
};

export type OrderRepository = Omit<BaseRepository<OrderEntity>, "save"> & {
  save(
    order: OrderEntity,
    options?: SaveOrderOptions,
  ): Promise<WithId<OrderEntity>>;
  ready(id: string): Promise<void>;
  serve(id: string): Promise<void>;
  // カップ（1杯）単位の準備完了・提供済みの切り替え。切り替え後の注文を返す。
  readyCup(id: string, cupId: string): Promise<WithId<OrderEntity>>;
  serveCup(id: string, cupId: string): Promise<WithId<OrderEntity>>;
  addComment(id: string, author: string, text: string): Promise<void>;
};
