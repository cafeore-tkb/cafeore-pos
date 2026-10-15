import {
  type CaosCard,
  type ColorSetting,
  type StockResource,
  canMergeCards,
  resolveItemColor,
} from "@cafeore/common";
import { type BeanIndex, cardBean } from "./beans";
import {
  type BoardComment,
  type CommentsByOrder,
  cardComments,
  commentKey,
} from "./comments";

// カード（1 回のドリップ。最大 2 杯）の見せ方。カードは注文のカップから組み立てたもの（@cafeore/common の buildCaosCards の CaosCard）を
// そのまま使い、名前・注文番号・色・分割の表示はここで引く。

const unique = <T>(values: T[]) => Array.from(new Set(values));

// 入れ直し（緊急）の理由（重ねずに「・」でつなぐ。無ければ空）
const cupsEmergencyReasons = (cups: CaosCard["cups"]) =>
  unique(cups.flatMap((cup) => cup.emergencyReason || [])).join("・");

/** 注文番号を 3 桁に（「007」） */
export const orderNoLabel = (no: number) => no.toString().padStart(3, "0");

/** カードの注文番号。統合したカードは元の注文すべて（小さい順） */
export const cardOrderNos = (card: CaosCard) =>
  unique(card.cups.map((cup) => cup.orderNo)).sort((a, b) => a - b);

/**
 * カードに入っている注文ごとのカップの数（注文番号の小さい順）。統合したカードを注文ごとの段に分けて出す（管制盤 D の OrderCard の byOrder）。
 * reason はその注文の入れ直し（緊急）の理由（無ければ空）、comments はその注文のコメントの数（look から引く）
 */
export const cardOrderParts = (card: CaosCard, look?: CardLook) =>
  cardOrderNos(card).map((orderNo) => {
    const cups = card.cups.filter((cup) => cup.orderNo === orderNo);
    return {
      orderNo,
      cups: cups.length,
      reason: cupsEmergencyReasons(cups),
      comments:
        look?.comments?.filter((comment) => comment.orderNo === orderNo)
          .length ?? 0,
    };
  });

/** 注文番号の表示（「#152」、統合したカードは「#152+#160」）。選んだ注文を指すキーにも使う */
export const orderLabel = (card: CaosCard) =>
  cardOrderNos(card)
    .map((no) => `#${orderNoLabel(no)}`)
    .join("+");

/** 選んだ注文（orderLabel。統合したカードなら「#012+#013」）に、注文番号 no の注文が入っているか */
export const labelHasOrder = (label: string | null, no: number) =>
  label?.split("+").includes(`#${orderNoLabel(no)}`) ?? false;

/**
 * カードが、選んだ注文（orderLabel。統合したカードなら「#012+#013」）の注文を 1 つでも含むか。
 * 統合したカードは、中の注文のどれを選んでも当たり、統合したカードを選べば中の注文のカードがみな当たる
 */
export const sharesOrder = (card: CaosCard, label: string | null) =>
  cardOrderNos(card).some((no) => labelHasOrder(label, no));

/**
 * 開いたカード（card）をもう一度押したときに統合する相手。cards のうち統合できる（canMergeCards。未割当・待機・抽出中）カードが 1 枚ならそれ、
 * 何枚かあれば注文番号がいちばん近いもの。いちばん近いものが 2 枚以上あって決まらなければ無し（今まで通り相手を押して選ぶ）
 */
export const quickMergePartner = (
  card: CaosCard,
  cards: readonly CaosCard[],
) => {
  const distance = (other: CaosCard) =>
    Math.abs(other.cups[0].orderNo - card.cups[0].orderNo);
  const [nearest, next] = cards
    .filter((other) => canMergeCards(card, other))
    .sort((a, b) => distance(a) - distance(b));
  return nearest && (!next || distance(next) > distance(nearest))
    ? nearest
    : undefined;
};

/** 選んだ注文（orderLabel。統合したカードなら「#012+#013」）のコメント（付けた順）。cards はその注文のカードを探す盤面のカード、コメントは looks から引く */
export const selectedComments = (
  cards: readonly CaosCard[],
  looks: CardLooks,
  label: string,
) => {
  const found = new Map<string, BoardComment>();
  for (const card of cards) {
    if (!sharesOrder(card, label)) continue;
    for (const comment of looks.get(card.key)?.comments ?? [])
      if (labelHasOrder(label, comment.orderNo))
        found.set(commentKey(comment), comment);
  }
  return [...found.values()].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  );
};

/** カードの商品の名前（略称 abbr をそのまま。統合したカードも同じ商品なので 1 つ） */
export const cardItemName = (card: CaosCard) =>
  unique(card.cups.map((cup) => cup.item.abbr)).join("・");

/** カードの指名（「2nd」。番号の無い古い明細は自由記述）。指名なしは空 */
export const cardNominee = (card: CaosCard) =>
  unique(card.cups.flatMap((cup) => cup.nominee ?? [])).join("・");

/**
 * ドリッパーに置いた（待機・抽出中の）カードの、提供の画面で提供済みにしたカップの札（全部なら「提供済」、一部なら「提供済 1/2」）。
 * 提供済みでもカードは「次へ」まで盤面に残るので、見分けられるように付ける。入れ直しは提供を持たない。無ければ空
 */
export const cardServedLabel = (card: CaosCard) => {
  // 未割当には準備完了・提供済みのカップは入らない
  if (card.status === "done") return "";
  const served = card.cups.filter((cup) => cup.servedAt !== null).length;
  if (served === 0) return "";
  return served === card.cups.length
    ? "提供済"
    : `提供済 ${served}/${card.cups.length}`;
};

/** 入れ直し（緊急）のカードの理由（重ねずに「・」でつなぐ。無ければ空） */
export const emergencyReasons = (card: CaosCard) =>
  cupsEmergencyReasons(card.cups);

/**
 * カードの名前（文で出すところ）。商品の略称に、指名は「（指名:2nd）」、
 * 上級生のみ（@cafeore/common の cupSeniorOnly）は「（上級生のみ）」を添える
 */
export const cardName = (card: CaosCard) => {
  const nominee = cardNominee(card);
  return [
    cardItemName(card),
    nominee ? `（指名:${nominee}）` : "",
    card.seniorOnly ? "（上級生のみ）" : "",
  ].join("");
};

/** カードの杯数の合計 */
export const totalCups = (cards: readonly CaosCard[]) =>
  cards.reduce((sum, card) => sum + card.cups.length, 0);

/** カードに入っている注文の数（統合したカードは中の注文をみな数え、分けた注文は 1 つと数える） */
export const orderCount = (cards: readonly CaosCard[]) =>
  new Set(cards.flatMap((card) => card.cups.map((cup) => cup.orderId))).size;

/** カードの注文の数と杯数（ヘッダー・未割当の見出しに「8 件 10 杯」と出す） */
export const orderAndCupCounts = (cards: readonly CaosCard[]) => ({
  orders: orderCount(cards),
  cups: totalCups(cards),
});

/** 分けた注文（total 枚のカードに分かれている）。cups は注文の杯数（統合したカードに入った分も数える） */
export interface CardSplit {
  total: number;
  cups: number;
}

/** カードの見せ方（色の設定の色・アイテムの在庫の豆と、分けた注文） */
export interface CardLook {
  /** 背景色（#RRGGBB）。商品の色の設定（画面 master。指名の番号のあるカードは画面 nominated、無ければ master。商品 → 種類の順）。無ければ白 */
  color?: string;
  /** 1 注文だけのカードで、注文が 2 枚以上に分かれているときだけ（ほかの注文と統合したカードに入った分も 1 枚と数える） */
  split?: CardSplit;
  /** 豆（POS の在庫のうち、カードの商品のアイテムの在庫）。logic/beans.ts で引く。在庫が無い商品には付かない */
  bean?: StockResource;
  /** 注文のコメント（統合したカードは中の注文すべて）。コメントのある注文のカードにだけ付く */
  comments?: BoardComment[];
  /** 上級生のみのカードが、担当者が上級生でないドリッパーにある（@cafeore/common の seniorOnlyOffSenior。警告の印を出す） */
  offSenior?: boolean;
}
export type CardLooks = ReadonlyMap<string, CardLook>;

/** カードの地の色（CardLook の color） */
export const cardColor = (card: CaosCard, settings: ColorSetting[]) =>
  (card.nominatedDripper !== null
    ? resolveItemColor(settings, card.cups[0].item, "nominated")
    : undefined) ?? resolveItemColor(settings, card.cups[0].item, "master");

/**
 * カードごとの見せ方（キーはカードの key）。色の設定と在庫・コメントはあとから読み込まれたり変わったりするので、出すたびに引く。
 * offSenior は上級生のみのカードが上級生でない担当者のドリッパーにあるか（担当者を知る画面だけ渡す）
 */
export const cardLooks = (
  cards: readonly CaosCard[],
  settings: ColorSetting[],
  beanIndex: BeanIndex,
  comments: CommentsByOrder | null = null,
  offSenior: (card: CaosCard) => boolean = () => false,
): CardLooks => {
  // 注文ごとに、その注文のカップが入ったカード（統合したカードも）。入れ直しのカードは注文の分け方に入れない
  const byOrder = new Map<string, CaosCard[]>();
  for (const card of cards) {
    if (card.emergency) continue;
    for (const orderId of new Set(card.cups.map((cup) => cup.orderId)))
      byOrder.set(orderId, [...(byOrder.get(orderId) ?? []), card]);
  }
  const splitOf = (card: CaosCard): CardSplit | undefined => {
    if (card.emergency || cardOrderNos(card).length > 1) return undefined;
    const { orderId } = card.cups[0];
    const parts = byOrder.get(orderId) ?? [];
    if (parts.length <= 1) return undefined;
    return {
      total: parts.length,
      cups: parts
        .flatMap((part) => part.cups)
        .filter((cup) => cup.orderId === orderId).length,
    };
  };
  return new Map(
    cards.map((card) => [
      card.key,
      {
        color: cardColor(card, settings),
        split: splitOf(card),
        bean: cardBean(card, beanIndex),
        comments: cardComments(card, comments),
        offSenior: offSenior(card),
      },
    ]),
  );
};

/** カードを注文ごとにまとめる（並びはそのまま）。キーは orderLabel */
export const groupByOrder = (cards: readonly CaosCard[]) => {
  const groups = new Map<string, CaosCard[]>();
  for (const card of cards) {
    const key = orderLabel(card);
    groups.set(key, [...(groups.get(key) ?? []), card]);
  }
  return groups;
};

/**
 * 未割当のカードを注文番号の行にまとめる（管制盤 A の横帯・C の注文の列）。入れ直し（緊急）の行を先に、ほかは注文番号の順
 * （buildCaosCards の未割当の並びと同じ）。統合したカードはいちばん小さい注文番号の行に置く。行の中は注文の中の並び
 */
export const unassignedRows = (cards: readonly CaosCard[]) => {
  const rows = new Map<
    string,
    { orderNo: number; emergency: boolean; cards: CaosCard[] }
  >();
  for (const card of cards) {
    const key = `${card.emergency}:${card.orderNo}`;
    const row = rows.get(key) ?? {
      orderNo: card.orderNo,
      emergency: card.emergency,
      cards: [],
    };
    row.cards.push(card);
    rows.set(key, row);
  }
  const position = (card: CaosCard) => card.cups[0].position;
  return [...rows.values()]
    .sort(
      (a, b) =>
        Number(b.emergency) - Number(a.emergency) || a.orderNo - b.orderNo,
    )
    .map((row) => ({
      ...row,
      cards: row.cards.sort((a, b) => position(a) - position(b)),
    }));
};
