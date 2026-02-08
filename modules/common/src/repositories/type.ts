import type { WithId } from "../lib/typeguard";
import type { ItemEntity, ItemType } from "../models/item";
import type { OrderEntity } from "../models/order";

export type BaseRepository<T extends { id?: unknown }> = {
  save(data: T): Promise<WithId<T>>;
  delete(id: string): Promise<void>;
  findById(id: string): Promise<WithId<T> | null>;
  findAll(): Promise<WithId<T>[]>;
};

export type ItemRepository = BaseRepository<ItemEntity>;

export type ItemTypeRepository = BaseRepository<ItemType>;

export type OrderRepository = BaseRepository<OrderEntity>;
