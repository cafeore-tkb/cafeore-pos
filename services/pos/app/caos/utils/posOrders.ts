import {
  type CaosDrip,
  type CaosOp,
  type CaosOpResult,
  type OrderEntity,
  type WithId,
  dripperLabel,
} from "@cafeore/common";
import type { BeanCode } from "../types";

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

// 指名はレジで選んだドリッパーの番号（明細の dripper。1st〜6th は 1〜6）。カードの lines[].dripper に入って届き、
// 番号の付いたカードはその番号の列にだけ割り当てられる（preferredBaristaId）。番号の無い自由記述だけの古い明細は指名なし。
// カードに出す指名の文字は、マスターの画面と同じく assignmentDisplay（@cafeore/common の models/dripper.ts）で作る
// （番号は「2nd」、番号の無い古い明細は自由記述）。live/drips.ts の describe を参照。

/** カードの指名の表示。盤面のカードは nominee（マスターと同じ表示）、実データテストのカードは番号から作る */
export const nominationText = (card: {
  nominee?: string;
  preferredBaristaId?: number;
}) =>
  card.nominee ??
  (card.preferredBaristaId ? dripperLabel(card.preferredBaristaId) : undefined);
