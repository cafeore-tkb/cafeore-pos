import type { WithId } from "../lib/typeguard";
import type {
  ItemEntity,
  ItemResponse,
  ItemTypeResponse,
} from "../models/item";
import type { OrderEntity } from "../models/order";

export type BaseRepository<T extends { id?: unknown }> = {
  save(data: T): Promise<WithId<T>>;
  delete(id: string): Promise<void>;
  findById(id: string): Promise<WithId<T> | null>;
  findAll(): Promise<WithId<T>[]>;
};

export type ItemRepository = BaseRepository<ItemEntity>;

export type OrderRepository = BaseRepository<OrderEntity>;

// 以下仮
export type ItemResponseRepository = BaseRepository<ItemResponse>;

export type ItemTypeResponseRepository = BaseRepository<ItemTypeResponse>;
