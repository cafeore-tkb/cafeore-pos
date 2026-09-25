import {
  type DocumentData,
  type FirestoreDataConverter,
  type QueryDocumentSnapshot,
  type SnapshotOptions,
  Timestamp,
} from "firebase/firestore";
import _ from "lodash";
import type { ZodSchema } from "zod";
import type { WithId } from "../lib/typeguard";
import {
  CashierStateEntity,
  MasterStateEntity,
  globalCashierStateSchema,
  globalMasterStateSchema,
} from "../models/global";
import { type Item, ItemEntity } from "../models/item";
import { MenuEntity } from "../models/menu";
import {
  type Order,
  type OrderComment,
  OrderEntity,
  orderSchema,
} from "../models/order";
import type { components } from "../types/api";

export const converter = <T>(
  schema: ZodSchema<T>,
): FirestoreDataConverter<T> => {
  return {
    toFirestore: (data: T) => {
      // Zod のパースを挟まないと、Entityオブジェクトのgetter/setterは無視され
      // privateプロパティがFirestoreに保存されてしまう
      const parsedData = schema.parse(data);
      // id は ドキュメントには含めない
      const dataWithoutId = _.omit(parsedData as object, "id");
      return dataWithoutId;
    },
    fromFirestore: (
      snapshot: QueryDocumentSnapshot,
      options: SnapshotOptions,
    ) => {
      const data = snapshot.data(options);
      // id は Firestore のドキュメント ID を使う
      const dataWithId = { ...data, id: snapshot.id };
      const dateParsedData = parseDateProperty(dataWithId);
      return schema.parse(dateParsedData);
    },
  };
};

// 通常の Firestore のデータは上記 Zod によってパースできるが
// Firestore の Timestamp はパースできないため、個別でパースする

// この関数の型注釈は若干嘘
const parseDateProperty = (data: DocumentData): DocumentData => {
  const parsedData = _.mapValues(data, (value) =>
    // firestore 固有の Timestamp 型を Date に変換
    value instanceof Timestamp ? value.toDate() : value,
  );
  const recursivelyParsedData = _.mapValues(parsedData, (value) => {
    // 再帰的にパースする
    switch (Object.prototype.toString.call(value)) {
      case "[object Object]":
        return parseDateProperty(value);
      case "[object Array]":
        return (value as Array<DocumentData>).map((v) => parseDateProperty(v));
      default:
        return value;
    }
  });
  return recursivelyParsedData;
};

/**
 * openapi のデータを ItemEntity に変換する
 */
type ItemResponse = components["schemas"]["ItemResponse"];
type ItemCreateRequest = components["schemas"]["ItemCreateRequest"];
type ItemUpdateRequest = components["schemas"]["ItemUpdateRequest"];

// ItemResponse を ItemEntity に変換
export const responseToItemEntity = (
  response: ItemResponse,
): WithId<ItemEntity> => {
  const item: WithId<Item> = {
    id: response.id,
    name: response.name,
    abbr: response.abbr,
    item_type: response.item_type,
  };
  return ItemEntity.fromItem(item);
};
// Item を CreateRequest に変換
export const itemToCreateRequest = (item: ItemEntity): ItemCreateRequest => {
  if (!item.item_type.id) {
    throw new Error("item type に id が見つかりません");
  }
  return {
    name: item.name,
    abbr: item.abbr,
    item_type_id: item.item_type.id,
  };
};

// Item を UpdateRequest に変換
export const itemToUpdateRequest = (
  item: WithId<ItemEntity>,
): ItemUpdateRequest => {
  if (!item.item_type.id) {
    throw new Error("item type に id が見つかりません");
  }
  return {
    id: item.id,
    name: item.name,
    abbr: item.abbr,
    item_type_id: item.item_type.id,
  };
};

type MenuResponse = components["schemas"]["MenuResponse"];
type MenuCreateRequest = components["schemas"]["MenuCreateRequest"];
type MenuUpdateRequest = components["schemas"]["MenuUpdateRequest"];

export const responseToMenuEntity = (
  response: MenuResponse,
): WithId<MenuEntity> =>
  MenuEntity.fromMenu({
    id: response.id,
    name: response.name,
    abbr: response.abbr,
    price: response.price,
    key: response.key,
    items: response.items.map(({ item, quantity }) => ({
      item: responseToItemEntity(item),
      quantity,
    })),
    assignee: null,
  });

const menuItemsToRequest = (menu: MenuEntity) =>
  menu.items.map(({ item, quantity }) => ({ item_id: item.id, quantity }));

export const menuToCreateRequest = (menu: MenuEntity): MenuCreateRequest => ({
  name: menu.name,
  abbr: menu.abbr,
  price: menu.price,
  key: menu.key,
  items: menuItemsToRequest(menu),
});

export const menuToUpdateRequest = (
  menu: WithId<MenuEntity>,
): MenuUpdateRequest => ({
  id: menu.id,
  ...menuToCreateRequest(menu),
});

/**
 * Firestore のデータを OrderEntity に変換する
 */
export const orderConverter: FirestoreDataConverter<WithId<OrderEntity>> = {
  toFirestore: converter(orderSchema).toFirestore,
  fromFirestore: (
    snapshot: QueryDocumentSnapshot,
    options: SnapshotOptions,
  ): WithId<OrderEntity> => {
    const convertedData = converter(orderSchema.required()).fromFirestore(
      snapshot,
      options,
    );
    return OrderEntity.fromOrder(convertedData);
  },
};

export const cashierStateConverter: FirestoreDataConverter<CashierStateEntity> =
  {
    toFirestore: converter(globalCashierStateSchema).toFirestore,
    fromFirestore: (
      snapshot: QueryDocumentSnapshot,
      options: SnapshotOptions,
    ) => {
      const convertedData = converter(globalCashierStateSchema).fromFirestore(
        snapshot,
        options,
      );

      return CashierStateEntity.fromCashierState(convertedData);
    },
  };

export const masterStateConverter: FirestoreDataConverter<MasterStateEntity> = {
  toFirestore: converter(globalMasterStateSchema).toFirestore,
  fromFirestore: (
    snapshot: QueryDocumentSnapshot,
    options: SnapshotOptions,
  ) => {
    const convertedData = converter(globalMasterStateSchema).fromFirestore(
      snapshot,
      options,
    );

    return MasterStateEntity.fromMasterState(convertedData);
  },
};

export type OrderResponse = components["schemas"]["OrderResponse"];
type MenuInfo = components["schemas"]["MenuInfo"];
type CommentResponse = components["schemas"]["CommentResponse"];
type OrderCreateRequest = components["schemas"]["OrderCreateRequest"];
type MenuInfoCreate = components["schemas"]["MenuInfoCreate"];
type OrderUpdateRequest = components["schemas"]["OrderUpdateRequest"];

export const responseToOrderEntity = (
  response: OrderResponse,
): WithId<OrderEntity> => {
  const menus = response.menus.reduce(
    (acc: WithId<MenuEntity>[], cur: MenuInfo) => {
      const menu = MenuEntity.fromMenu({
        ...responseToMenuEntity(cur.menu).toMenu(),
        orderMenuId: cur.id,
        name: cur.menu_name,
        price: cur.unit_price,
        assignee: cur.assignee,
      });
      acc.push(menu);
      return acc;
    },
    [],
  );
  const comments = response.comments?.reduce(
    (acc: OrderComment[], cur: CommentResponse) => {
      acc.push(commentConverter(cur));
      return acc;
    },
    [],
  );
  const order: WithId<Order> = {
    id: response.id,
    orderId: response.order_id,
    createdAt: new Date(response.created_at),
    readyAt: response.ready_at ? new Date(response.ready_at) : null,
    servedAt: response.served_at ? new Date(response.served_at) : null,
    total: 0,
    discount: 100,
    estimateTime: 10,
    billingAmount: response.billing_amount,
    received: response.received,
    DISCOUNT_PER_CUP: 100,
    discountOrderId: response.discount_order_id
      ? response.discount_order_id
      : null,
    discountOrderCups: response.discount_order_cups
      ? response.discount_order_cups
      : 0,
    menus,
    comments: comments ? comments : [],
    cups: response.cups.map((cup) => ({
      id: cup.id,
      orderMenuId: cup.order_menu_id,
      item: responseToItemEntity(cup.item).toItem(),
      readyAt: cup.ready_at ? new Date(cup.ready_at) : null,
      servedAt: cup.served_at ? new Date(cup.served_at) : null,
    })),
  };
  return OrderEntity.fromOrder(order);
};

export const commentConverter = (comment: CommentResponse): OrderComment => {
  const author =
    comment.author === "cashier" ||
    comment.author === "master" ||
    comment.author === "serve"
      ? comment.author
      : "others";
  return {
    author: author,
    text: comment.text,
    createdAt: new Date(comment.created_at),
  };
};

// OrderEntity を CreateRequest に変換
export const orderEntityToCreateRequest = (
  order: OrderEntity,
): OrderCreateRequest => {
  const menuIds = order.menus.reduce((acc: MenuInfoCreate[], cur) => {
    acc.push({ assignee: cur.assignee, menu_id: cur.id });
    return acc;
  }, []);
  return {
    order_id: order.orderId,
    billing_amount: order.billingAmount,
    received: order.received,
    discount_order_id: order.discountOrderId,
    discount_order_cups: order.discountOrderCups,
    menu_ids: menuIds,
    comments: order.comments,
  };
};

// OrderEntity を UpdateRequest に変換
export const orderToUpdateRequest = (
  order: WithId<OrderEntity>,
): OrderUpdateRequest => {
  const menuIds = order.menus.reduce((acc: MenuInfoCreate[], cur) => {
    acc.push({
      assignee: cur.assignee,
      menu_id: cur.id,
      order_menu_id: cur.orderMenuId,
    });
    return acc;
  }, []);
  return {
    id: order.id,
    order_id: order.orderId,
    ready_at: order.readyAt?.toISOString() ?? null,
    served_at: order.servedAt?.toISOString() ?? null,
    billing_amount: order.billingAmount,
    received: order.received,
    discount_order_id: order.discountOrderId,
    discount_order_cups: order.discountOrderCups,
    menu_ids: menuIds,
  };
};
