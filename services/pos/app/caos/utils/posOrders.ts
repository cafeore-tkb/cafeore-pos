import type { OrderEntity, WithId } from "@cafeore/common";

// cafeore-pos の注文。POS の画面と同じく、共有の WebSocket から届いた OrderEntity を使う。
export type PosOrder = WithId<OrderEntity>;
