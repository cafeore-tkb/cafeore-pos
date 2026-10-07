import type {
  CaosDrip,
  CaosOp,
  CaosOpResult,
  OrderEntity,
  WithId,
} from "@cafeore/common";
import type { BeanCode } from "../types";

// 注文と抽出カードは、POS の画面全体で共有している WebSocket（root の OrdersWSProvider）から届く。
// 注文は POS の画面と同じ OrderEntity、カードは API の形（openapi/openapi.yaml から生成した型）。
export type PosOrder = WithId<OrderEntity>;
export type Drip = CaosDrip;
export type { CaosOp, CaosOpResult };

// 豆は DB の商品の種類（item_type）を先に見て決める。名前で決めるのは定番の豆だけ。
// - 限定（limited）は SP
// - どれにも当たらない商品（も花も香ブレンドなど）は「その他」。黙って SP にはしない
export const posBeanCode = (name: string, type: string): BeanCode => {
  if (type === "ice") return "ICE";
  if (type === "iceOre") return "MILK";
  if (type === "limited") return "SP";
  if (name.includes("俺")) return "ORE";
  if (name.includes("優勝") || name.includes("縁")) return "CHAMP";
  if (name.includes("タンザニア") || name.includes("キリマンジャロ"))
    return "TNZ";
  if (name.includes("ケニア")) return "KEN";
  if (name.includes("ブラジル")) return "BRA";
  return "OTHER";
};

// cafeore-pos の指名は自由記述なので、番号（1〜6）のときだけ枠を固定する。
export const nominatedBayId = (assignee: string) => {
  const bayNumber = Number(assignee.trim().normalize("NFKC"));
  if (Number.isInteger(bayNumber) && bayNumber >= 1 && bayNumber <= 6)
    return bayNumber;
  return undefined;
};
