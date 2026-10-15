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

/**
 * カードが、選んだ注文（orderLabel。統合したカードなら「#012+#013」）の注文を 1 つでも含むか。
 * 統合したカードは、中の注文のどれを選んでも当たり、統合したカードを選べば中の注文のカードがみな当たる
 */
export const sharesOrder = (card: CaosCard, label: string | null) => {
  const labels = label?.split("+") ?? [];
  return cardOrderNos(card).some((no) =>
    labels.includes(`#${orderNoLabel(no)}`),
  );
};

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
  const labels = label.split("+");
  const found = new Map<string, BoardComment>();
  for (const card of cards) {
    if (!sharesOrder(card, label)) continue;
    for (const comment of looks.get(card.key)?.comments ?? [])
      if (labels.includes(`#${orderNoLabel(comment.orderNo)}`))
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

/** 注文の行の 1 枚。mergedInto は、統合したカードをいちばん小さい注文番号の行に置いたとき、ほかの注文の行に残す跡（統合したカードの orderLabel） */
export interface OrderRowEntry {
  card: CaosCard;
  mergedInto?: string;
}

/**
 * カードを注文番号の行にまとめる（注文番号の順、行の中は注文の中の並び）。
 * 統合したカードはいちばん小さい注文番号の行に置き、ほかの注文の行には跡（mergedInto）を残す。
 * 未割当の入れ直し（緊急）のカードは、注文ごとの別の行（emergency）にして先頭に置く（buildCaosCards の未割当の並びと同じ）
 */
export const orderRows = (cards: readonly CaosCard[]) => {
  const rows = new Map<
    string,
    { orderNo: number; emergency: boolean; entries: OrderRowEntry[] }
  >();
  const add = (orderNo: number, emergency: boolean, entry: OrderRowEntry) => {
    const key = `${emergency}:${orderNo}`;
    const row = rows.get(key) ?? { orderNo, emergency, entries: [] };
    row.entries.push(entry);
    rows.set(key, row);
  };
  for (const card of cards) {
    const emergency = card.emergency && card.status === "unassigned";
    const [first, ...others] = cardOrderNos(card);
    add(first, emergency, { card });
    for (const no of others)
      add(no, emergency, { card, mergedInto: orderLabel(card) });
  }
  const positionIn = (orderNo: number, { card }: OrderRowEntry) =>
    card.cups.find((cup) => cup.orderNo === orderNo)?.position ?? 0;
  return [...rows.values()]
    .sort(
      (a, b) =>
        Number(b.emergency) - Number(a.emergency) || a.orderNo - b.orderNo,
    )
    .map((row) => ({
      ...row,
      entries: row.entries.sort(
        (a, b) => positionIn(row.orderNo, a) - positionIn(row.orderNo, b),
      ),
    }));
};
export type OrderRow = ReturnType<typeof orderRows>[number];

/** 管制盤 C の注文の列で、いちばん古い未割当の注文の上に残す、ドリッパーに置いた（待機・抽出中の）注文の数 */
const RECENT_PLACED_ROWS = 3;

/**
 * 管制盤 C の注文の列（ドリッパーに置いたカードも含めた注文番号の行）。いちばん古い未割当の注文から後ろを並べ、
 * その上に、それより前の注文のうちドリッパーに置いた（待機・抽出中の）カードのある行を直近の RECENT_PLACED_ROWS 件だけ残す
 * （どこに何番目で入れたかが見えるように。その行は待機・抽出中のカードだけ）。未割当の入れ直し（緊急）の行は、残した行のすぐ下に置く
 */
export const queueRows = (cards: readonly CaosCard[]) => {
  const all = orderRows(cards);
  const rows = all.filter((row) => !row.emergency);
  const start = rows.findIndex((row) =>
    row.entries.some(({ card }) => card.status === "unassigned"),
  );
  const end = start < 0 ? rows.length : start;
  const recent = rows
    .slice(0, end)
    .map((row) => ({
      ...row,
      entries: row.entries.filter(
        ({ card }) => card.status === "queued" || card.status === "brewing",
      ),
    }))
    .filter((row) => row.entries.length > 0)
    .slice(-RECENT_PLACED_ROWS);
  return [...recent, ...all.filter((row) => row.emergency), ...rows.slice(end)];
};
