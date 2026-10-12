import {
  type CaosCard,
  type CaosCardStatus,
  type CaosOrderInput,
  type CupStatus,
  caosDayOrders,
  getCupStatus,
  jstDate,
} from "@cafeore/common";
import { orderByNo } from "~/components/functional/useCupEmergency";
import type { BoardComment, CommentsByOrder } from "./comments";
import { clockLabel } from "./format";
import { type Lane, cardPlaces } from "./lanes";

// 注文番号で注文を探す（ヘッダーの「番号」）。その日（日本時間）の注文から番号の同じものを引き、
// 注文のカップの状態（準備中・準備完了・提供済み）と、その注文のカップの入ったカードの今の場所を出す。

/** 探した注文の中のカードと、その場所（「未割当」「3rd 2番目」「3rd 抽出中 2:10」「3rd 済」） */
export interface FoundCard {
  card: CaosCard;
  place: string;
}

/** 探した注文の今 */
export interface FoundOrder {
  orderNo: number;
  /** 注文のカップの状態。全部提供済みなら served、全部準備完了（提供済みも）なら ready、ほかは preparing */
  status: CupStatus;
  /** 準備完了（提供済みも）のカップの数と、全部の数 */
  readyCups: number;
  cups: number;
  /** 緊急（入れ直し）を足したカップがある */
  emergency: boolean;
  /** その注文のカップの入ったカード（盤面の並び。準備完了にしてから盤面に出なくなったカップは入らない） */
  cards: FoundCard[];
  comments: readonly BoardComment[];
}

// カードの場所。抽出中は始めてからの時間も
const placeOf = (
  card: CaosCard,
  places: ReadonlyMap<string, string>,
  nowMs: number,
) => {
  if (card.status === "unassigned") return "未割当";
  const place = places.get(card.key) ?? "";
  if (card.status !== "brewing" || !card.startedAt) return place;
  return `${place} ${clockLabel((nowMs - card.startedAt.getTime()) / 1000)}`;
};

// 注文の状態（カップの状態をまとめる）。全部提供済みなら served、全部準備完了（提供済みも）なら ready
const orderStatus = (statuses: CupStatus[]): CupStatus => {
  if (statuses.every((status) => status === "served")) return "served";
  if (statuses.every((status) => status !== "preparing")) return "ready";
  return "preparing";
};

/** その日（nowMs の日本時間の日）の注文から、注文番号 orderNo の注文を探す。無ければ null */
export const findOrder = ({
  orders,
  cards,
  lanes,
  comments,
  orderNo,
  nowMs,
}: {
  orders: readonly CaosOrderInput[];
  cards: readonly CaosCard[];
  lanes: readonly Lane[];
  /** 本番の注文のコメント（実データテスト中は null） */
  comments: CommentsByOrder | null;
  orderNo: number;
  nowMs: number;
}): FoundOrder | null => {
  const order = orderByNo(
    caosDayOrders(orders, jstDate(nowMs)),
    String(orderNo),
  );
  if (!order) return null;
  const statuses = order.cups.map(getCupStatus);
  const readyCups = statuses.filter((status) => status !== "preparing").length;
  const places = cardPlaces(lanes);
  return {
    orderNo,
    status: orderStatus(statuses),
    readyCups,
    cups: statuses.length,
    emergency: order.cups.some((cup) => cup.emergencies.length > 0),
    cards: cards
      .filter((card) => card.cups.some((cup) => cup.orderId === order.id))
      .map((card) => ({ card, place: placeOf(card, places, nowMs) })),
    comments: comments?.get(order.id) ?? [],
  };
};

// 探した注文のどのカードを見せるか（抽出中・待機・未割当・終わりの順）
const FOCUS_RANK: Record<CaosCardStatus, number> = {
  brewing: 0,
  queued: 1,
  unassigned: 2,
  done: 3,
};

/** 探した注文の、盤面で見せるカード。カードが無ければ undefined */
export const focusCard = (found: FoundOrder) =>
  found.cards
    .map(({ card }) => card)
    .sort((a, b) => FOCUS_RANK[a.status] - FOCUS_RANK[b.status])[0];
