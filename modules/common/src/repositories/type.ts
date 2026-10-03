import type { WithId } from "../lib/typeguard";
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
  addComment(id: string, author: string, text: string): Promise<void>;
};
