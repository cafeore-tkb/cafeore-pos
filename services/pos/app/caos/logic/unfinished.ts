import {
  type CaosCard,
  type CaosOrderInput,
  caosDayOrders,
  jstDate,
  orderElapsedTime,
} from "@cafeore/common";
import { isPendingCaosReply, isSentCaosReply } from "./caosReplies";
import { type CommentsByOrder, commentKey, isStampReply } from "./comments";
import { type Lane, cardPlaces } from "./lanes";
import { type FoundOrder, orderNow } from "./search";

// 未提供の注文（未割当の欄の「未提供」のタブ）。去年までのマスターシートのように、まだ提供していない注文を注文番号の順に並べ、
// 受けてからの時間・今の状態（カードの場所・準備完了）・コメントを出す。15 分を超えた注文と、まだ見ていないコメントはタブに件数の印を付ける。

/** 未提供の注文の 1 行（注文の今と、受けてからの秒。late は LATE_ORDER_SEC を超えた） */
export interface UnfinishedOrder extends FoundOrder {
  waitSec: number;
  late: boolean;
}

/**
 * その日（nowMs の日本時間の日）のまだ提供していない注文（カップが 1 つでも提供済みでないか、まだ抽出を終えていない入れ直しがある）を、注文番号の順に。
 * 実データテスト（practice）には提供の画面が無いので、抽出の要るカップが全部抽出を終えた注文を済みとみる（実績の提供時間と同じ）
 */
export const unfinishedOrders = ({
  orders,
  cards,
  lanes,
  comments,
  nowMs,
  practice,
}: {
  orders: readonly CaosOrderInput[];
  cards: readonly CaosCard[];
  lanes: readonly Lane[];
  comments: CommentsByOrder | null;
  nowMs: number;
  practice: boolean;
}): UnfinishedOrder[] => {
  const places = cardPlaces(lanes);
  return caosDayOrders(orders, jstDate(nowMs))
    .map((order) => {
      const elapsed = orderElapsedTime(
        { createdAt: order.createdAt, servedAt: null },
        new Date(nowMs),
      );
      const waitSec = elapsed.m * 60 + Number(elapsed.ss);
      return {
        ...orderNow(order, { cards, places, comments, nowMs }),
        waitSec,
        late: elapsed.overdue,
      };
    })
    .filter((row) =>
      practice
        ? row.cards.some(({ card }) => card.status !== "done")
        : row.status !== "served" ||
          row.cards.some(
            ({ card }) =>
              card.status !== "done" && card.cups.some((cup) => cup.emergency),
          ),
    )
    .sort((a, b) => a.orderNo - b.orderNo);
};

/** 注文の今の札（カードの場所と準備完了。同じ札は 1 つ。カードも準備完了も無ければ準備中） */
export const unfinishedStates = (row: FoundOrder) => {
  const ready =
    row.readyCups === 0
      ? []
      : [
          row.readyCups === row.cups
            ? "準備完了"
            : `準備完了 ${row.readyCups}/${row.cups}`,
        ];
  const labels = [...new Set(row.cards.map(({ place }) => place)), ...ready];
  return labels.length > 0 ? labels : ["準備中"];
};

/** この端末で見た未提供の印（15 分を超えた注文の id・コメントの commentKey） */
export interface UnfinishedSeen {
  late: string[];
  comments: string[];
}

/** 未提供の注文のうち、まだ見ていない 15 分超の注文（id）と新しいコメント（commentKey）。CaOS から返したスタンプは数えない */
export const unseenAlerts = (
  rows: readonly UnfinishedOrder[],
  seen: UnfinishedSeen,
) => ({
  late: rows
    .filter((row) => row.late && !seen.late.includes(row.orderId))
    .map((row) => row.orderId),
  comments: rows
    .flatMap((row) => row.comments)
    .filter(
      (comment) =>
        !isStampReply(comment) &&
        !isSentCaosReply(comment) &&
        !isPendingCaosReply(comment),
    )
    .map(commentKey)
    .filter((key) => !seen.comments.includes(key)),
});

/** 見た印に足す（今の未提供の注文に無いものは忘れる。端末に残すものを増やし続けない） */
export const markSeen = (
  rows: readonly UnfinishedOrder[],
  seen: UnfinishedSeen,
  add: UnfinishedSeen,
): UnfinishedSeen => {
  const ids = new Set(rows.map((row) => row.orderId));
  const keys = new Set(rows.flatMap((row) => row.comments.map(commentKey)));
  return {
    late: [...new Set([...seen.late, ...add.late])].filter((id) => ids.has(id)),
    comments: [...new Set([...seen.comments, ...add.comments])].filter((key) =>
      keys.has(key),
    ),
  };
};
