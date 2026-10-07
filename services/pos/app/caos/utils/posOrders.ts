import type {
  CaosDrip,
  CaosOp,
  CaosOpResult,
  OrderEntity,
  WithId,
} from "@cafeore/common";
import type { Barista, BeanCode } from "../types";

// 注文と抽出カードは、POS の画面全体で共有している WebSocket（root の OrdersWSProvider）から届く。
// 注文は POS の画面と同じ OrderEntity、カードは API の形（openapi/openapi.yaml から生成した型）。
export type PosOrder = WithId<OrderEntity>;
export type Drip = CaosDrip;
export type { CaosOp, CaosOpResult };

// 商品名と種類から豆を決める。
export const posBeanCode = (name: string, type: string): BeanCode => {
  if (type === "ice") return "ICE";
  if (type === "iceOre") return "MILK";
  if (name.includes("俺")) return "ORE";
  if (name.includes("優勝") || name.includes("縁")) return "CHAMP";
  if (name.includes("タンザニア") || name.includes("キリマンジャロ"))
    return "TNZ";
  if (name.includes("ケニア")) return "KEN";
  if (name.includes("ブラジル")) return "BRA";
  return "SP";
};

// cafeore-pos の指名は自由記述なので、番号（1〜6）か現在のドリッパー名に一致したときだけ枠を固定する。
export const nominatedBayId = (assignee: string, baristas: Barista[]) => {
  const normalized = assignee.trim().normalize("NFKC");
  const bayNumber = Number(normalized);
  if (Number.isInteger(bayNumber) && bayNumber >= 1 && bayNumber <= 6)
    return bayNumber;
  return baristas.find((barista) => barista.name === normalized)?.id;
};
