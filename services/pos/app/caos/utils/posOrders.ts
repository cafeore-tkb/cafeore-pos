import type { OrderEntity, WithId } from "@cafeore/common";
import type { BeanCode } from "../types";

// cafeore-pos の注文。POS の画面と同じく、共有の WebSocket から届いた OrderEntity を使う。
export type PosOrder = WithId<OrderEntity>;

// 盤面のカードの区分は、DB の商品の種類（item_type）だけで決める。
// - 限定（limited）は SP
// - 氷（ice）・牛（iceOre）は仕上げが違うので分ける
// どの豆かは名前では決めず、在庫の「商品 → 豆」（item_stock_usages）から引く（utils/beans.ts）
export const posBeanCode = (type: string): BeanCode => {
  if (type === "ice") return "ICE";
  if (type === "iceOre") return "MILK";
  if (type === "limited") return "SP";
  return "OTHER";
};
