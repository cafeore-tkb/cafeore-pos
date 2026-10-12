import type {
  CaosCard,
  OrderComment,
  OrderEntity,
  WithId,
} from "@cafeore/common";

// 注文のコメント（レジ・マスター・提供で付ける。POST /api/orders/{id}/comments）。CaOS は読むだけで、
// 共有の WebSocket で届く注文（OrderEntity の comments）から引く。

/** 注文番号を添えたコメント（統合したカードでは、どの注文のコメントか分かるように） */
export interface BoardComment extends OrderComment {
  orderNo: number;
}

/** 注文（id）ごとのコメント（付けた順）。コメントの無い注文は入れない */
export type CommentsByOrder = ReadonlyMap<string, BoardComment[]>;

export const commentsByOrder = (
  orders: readonly WithId<OrderEntity>[],
): CommentsByOrder =>
  new Map(
    orders
      .filter((order) => order.comments.length > 0)
      .map((order) => [
        order.id,
        order.comments
          .map((comment) => ({ ...comment, orderNo: order.orderId }))
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
      ]),
  );

/** コメントを見分ける印（コメントに ID は無いので、注文番号・時刻・書き手・中身で） */
export const commentKey = (comment: BoardComment) =>
  `${comment.orderNo}\u0000${comment.createdAt.getTime()}\u0000${comment.author}\u0000${comment.text}`;

/** カードの注文のコメント（統合したカードは中の注文すべて）。無ければ undefined */
export const cardComments = (
  card: CaosCard,
  comments: CommentsByOrder | null,
) => {
  const found = [...new Set(card.cups.map((cup) => cup.orderId))].flatMap(
    (orderId) => comments?.get(orderId) ?? [],
  );
  return found.length > 0 ? found : undefined;
};
