import type { components } from "@cafeore/common/api-types";
import type { Barista, BeanCode } from "../types";

// cafeore-pos の API の形（openapi/openapi.yaml から生成した型）。
// 注文は WebSocket /api/ws/orders の {"type":"orders"}（全部）・{"type":"order"}（変わった 1 件）、抽出カードは {"type":"drips"} で届く。
export type PosOrder = components["schemas"]["OrderResponse"];
export type Drip = components["schemas"]["CaosDrip"];
export type CaosOp = components["schemas"]["CaosOp"];
export type CaosOpResult = components["schemas"]["CaosOpResult"];

// POS と同じ API につなぐ（modules/common と同じく VITE_API_BASE_URL、未設定ならローカルの API）。
export const POS_API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:8080";

export const posOrdersSocketUrl = (baseUrl: string) =>
  `${baseUrl.replace(/\/$/, "").replace(/^http/, "ws")}/api/ws/orders`;

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
