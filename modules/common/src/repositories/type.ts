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

export type OrderRepository = BaseRepository<OrderEntity> & {
  ready(id: string): Promise<void>;
  serve(id: string): Promise<void>;
  // カップ（注文明細）単位の準備完了・提供済みの切り替え
  readyMenu(id: string, orderMenuId: string): Promise<void>;
  serveMenu(id: string, orderMenuId: string): Promise<void>;
  addComment(id: string, author: string, text: string): Promise<void>;
};
