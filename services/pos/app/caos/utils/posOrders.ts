import type { OrderEntity, WithId } from "@cafeore/common";

// cafeore-pos の注文。POS の画面と同じく、共有の WebSocket から届いた OrderEntity を使う。
// カードの名前・区分・色・豆・限定は、商品の種類の名前で決めず、POS の DB の値をそのまま使う（live/board.ts）
export type PosOrder = WithId<OrderEntity>;
