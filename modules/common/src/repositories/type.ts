import type { WithId } from "../lib/typeguard";
import type { ColorSetting } from "../models/colorSetting";
import type { ItemEntity, ItemType } from "../models/item";
import type { MenuEntity } from "../models/menu";
import type { OrderComment, OrderEntity, OrderPayment } from "../models/order";

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
  save(
    order: OrderEntity,
    options?: ({ method?: undefined } | OrderPayment) & {
      /**
       * 新しく作るときの、送り直しで同じ注文を二重に作らないためのキー（UUID）。
       * サーバーはこれを注文の ID にし、すでにあれば作らずにその注文を返す。送り直しでは同じキーを渡す
       */
      idempotencyKey?: string;
      /**
       * 新しく作るときの、レジで確定した時刻。オフラインで溜めた注文や再送など、確定より後に送るときに渡す。
       * 省略するとサーバーの今
       */
      createdAt?: Date;
    },
  ): Promise<WithId<OrderEntity>>;
  ready(id: string): Promise<void>;
  serve(id: string): Promise<void>;
  // 呼び出し中の注文をもう一度呼ぶ（呼び出し催促）。注文は変わらず、呼び出し画面が読み上げる
  recall(id: string): Promise<void>;
  // カップ（1杯）単位の準備完了・提供済みの切り替え。切り替え後の注文を返す。
  readyCup(id: string, cupId: string): Promise<WithId<OrderEntity>>;
  serveCup(id: string, cupId: string): Promise<WithId<OrderEntity>>;
  addComment(id: string, author: string, text: string): Promise<OrderComment>;
  // 注文をキャンセルする（返金はしない）。消さずに残し、キャンセルした注文を返す
  cancel(id: string): Promise<WithId<OrderEntity>>;
  // 現金で受け取った分を返したことを記録する（お金は手で返す）。記録した注文を返す
  refundCash(id: string): Promise<WithId<OrderEntity>>;
};
