import {
  type DocumentData,
  type FirestoreDataConverter,
  type QueryDocumentSnapshot,
  type SnapshotOptions,
  Timestamp,
} from "firebase/firestore";
import _ from "lodash";
import type { ZodType, ZodTypeDef } from "zod";
import type { WithId } from "../lib/typeguard";
import {
  CashierStateEntity,
  type GlobalCashierState,
  MasterStateEntity,
  cashierStateWireSchema,
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
import type { PrintJob } from "../models/printJob";
import type { components } from "../types/api";

// 入力の型は出力と違ってよい（既定値で埋める項目など）
export const converter = <T>(
  schema: ZodType<T, ZodTypeDef, unknown>,
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
    dripper: null,
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
        dripper: cur.dripper ?? null,
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
    cups: (response.cups ?? []).map((cup) => ({
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
// printLabels：注文と同じトランザクションで、この注文のラベルの印刷を印刷キューに積む（レジの会計）
export const orderEntityToCreateRequest = (
  order: OrderEntity,
  { printLabels = false }: { printLabels?: boolean } = {},
): OrderCreateRequest => {
  const menuIds = order.menus.reduce((acc: MenuInfoCreate[], cur) => {
    acc.push({
      assignee: cur.assignee,
      dripper: cur.dripper,
      menu_id: cur.id,
    });
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
    ...(printLabels ? { print_labels: true } : {}),
  };
};

// OrderEntity を UpdateRequest に変換
export const orderToUpdateRequest = (
  order: WithId<OrderEntity>,
): OrderUpdateRequest => {
  const menuIds = order.menus.reduce((acc: MenuInfoCreate[], cur) => {
    acc.push({
      assignee: cur.assignee,
      dripper: cur.dripper,
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

/**
 * レジ状態（cashier-state）と API の間の変換
 */
type CashierStateResponse = components["schemas"]["CashierStateResponse"];
type CashierStateUpdateRequest =
  components["schemas"]["CashierStateUpdateRequest"];

// API の JSON では Date が ISO 文字列になっているので、wire スキーマで Date に戻す
export const responseToCashierState = (
  response: CashierStateResponse,
): CashierStateEntity => {
  const parsed = cashierStateWireSchema.parse({
    id: "cashier-state",
    edittingOrder: response.editting_order,
    submittedOrderId: response.submitted_order_id ?? null,
  });
  return CashierStateEntity.fromCashierState(parsed);
};

export const cashierStateToUpdateRequest = (
  state: GlobalCashierState,
): CashierStateUpdateRequest => {
  // Zod のパースを挟まないと OrderEntity の getter が無視され、
  // private プロパティがそのまま送られてしまう
  const parsed = globalCashierStateSchema.parse(state);
  return {
    // Date は JSON.stringify で ISO 文字列になる
    editting_order: parsed.edittingOrder as unknown as Record<string, unknown>,
    submitted_order_id: parsed.submittedOrderId,
  };
};

/**
 * 印刷キューの仕事（API の PrintJob → PrintJob）
 */
export type PrintJobResponse = components["schemas"]["PrintJob"];

const dateOrNull = (value: string | null | undefined) =>
  value ? new Date(value) : null;

export const responseToPrintJob = (response: PrintJobResponse): PrintJob => ({
  id: response.id,
  kind: response.kind,
  source: response.source,
  orderId: response.order_id,
  orderNo: response.order_no,
  cupId: response.cup_id ?? null,
  status: response.status,
  printerId: response.printer_id ?? null,
  claimedAt: dateOrNull(response.claimed_at),
  finishedAt: dateOrNull(response.finished_at),
  error: response.error ?? null,
  attempts: response.attempts,
  createdAt: new Date(response.created_at),
  updatedAt: new Date(response.updated_at),
});
