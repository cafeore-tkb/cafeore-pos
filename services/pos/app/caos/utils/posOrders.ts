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

// 盤面のカードの区分は、DB の商品の種類（item_type）だけで決める。
// - 限定（limited）は SP。SP を淹れられるドリッパーにだけ回す
// - 氷（ice）・牛（iceOre）は仕上げが違うので分ける
// どの豆かは名前では決めず、在庫の「商品 → 豆」（item_stock_usages）から引く（utils/beans.ts）
export const posBeanCode = (type: string): BeanCode => {
  if (type === "ice") return "ICE";
  if (type === "iceOre") return "MILK";
  if (type === "limited") return "SP";
  return "OTHER";
};

// cafeore-pos の指名は自由記述なので、番号（1〜6）か現在のドリッパー名に一致したときだけ枠を固定する。
export const nominatedBayId = (assignee: string, baristas: Barista[]) => {
  const normalized = assignee.trim().normalize("NFKC");
  const bayNumber = Number(normalized);
  if (Number.isInteger(bayNumber) && bayNumber >= 1 && bayNumber <= 6)
    return bayNumber;
  return baristas.find((barista) => barista.name === normalized)?.id;
};
