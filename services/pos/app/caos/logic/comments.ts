import type {
  CaosCard,
  OrderComment,
  OrderEntity,
  WithId,
} from "@cafeore/common";

// 注文のコメント（レジ・マスター・提供で付ける。POST /api/orders/{id}/comments）。CaOS は共有の WebSocket で届く注文
// （OrderEntity の comments）から読み、返すときは決まったスタンプ（STAMPS）をマスターのコメントとして付ける（キーボードは出さない）。

/** 注文番号と注文の id を添えたコメント（統合したカードでは、どの注文のコメントか分かるように。スタンプを返す先） */
export interface BoardComment extends OrderComment {
  orderNo: number;
  orderId: string;
}

/** コメントに返すスタンプ（押すと、その文字をそのままマスターのコメントとして付ける。提供の画面などでもふつうのコメントとして見える） */
export const STAMPS = ["OK", "待って", "済み", "来て！"];

// 以前送ったコメントもリアクションとして扱い、再通知しない。
const LEGACY_STAMPS = [
  "👀 見た",
  "👍 了解",
  "⏳ 待って",
  "✅ 済み",
  "🙏 ごめん",
];

/**
 * CaOS から返したスタンプ（マスターが付けた STAMPS の 1 つ）。新しいコメントとして知らせない（返した側の画面なので）。
 * コメントには付けた画面の印が無いので、マスターの画面（/master）で同じ文字を手で付けたものも同じに扱う（どちらもマスターの側から出したもので、CaOS で知らせなくてよい）
 */
export const isStampReply = (comment: OrderComment) =>
  comment.author === "master" &&
  (STAMPS.includes(comment.text) || LEGACY_STAMPS.includes(comment.text));

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
          .map((comment) => ({
            ...comment,
            orderNo: order.orderId,
            orderId: order.id,
          }))
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
