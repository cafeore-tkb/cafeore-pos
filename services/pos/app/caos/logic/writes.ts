import {
  type CaosCard,
  type CaosPlace,
  type CaosWritesResult,
  assignWrites,
  mergeWrites,
  unassignWrites,
} from "@cafeore/common";

// 管制盤の操作（割当・移動・先頭へ・途中への差し込み・未割当に戻す・統合・次へ）を、カップへの書き込みにする。
// 本番（hooks/useLiveBoard。PUT /api/caos/cups に送る）と実データテスト（hooks/useTestPlay。練習の盤面に当てる）で同じものを使う。
// カードは画面のカードのキー（組み立てたカード CaosCard の key）で引く。

const NOT_FOUND = { error: "カードが見つかりません" } as const;

const cardOf = (cards: readonly CaosCard[], key: string) =>
  cards.find((card) => card.key === key);

/** 割当・ドリッパーの移動・順番の入れ替え。順番の数はサーバー（練習なら練習の盤面）が決める */
export const placeCardWrites = (
  cards: readonly CaosCard[],
  key: string,
  dripper: number,
  place: CaosPlace | undefined, // "front" は待機の先頭、{ beforeKey } はそのカードの前、無ければ最後
  newId: () => string,
): CaosWritesResult => {
  const card = cardOf(cards, key);
  if (!card) return NOT_FOUND;
  return assignWrites(cards, card, dripper, { place, newId });
};

/** 待機のカードを未割当に戻す */
export const unassignCardWrites = (
  cards: readonly CaosCard[],
  key: string,
): CaosWritesResult => {
  const card = cardOf(cards, key);
  return card ? unassignWrites(card) : NOT_FOUND;
};

/** 1 杯のカードどうしを 2 杯の同時抽出にまとめる */
export const mergeCardWrites = (
  cards: readonly CaosCard[],
  key: string,
  withKey: string,
  newId: () => string,
): CaosWritesResult => {
  const card = cardOf(cards, key);
  const withCard = cardOf(cards, withKey);
  return card && withCard ? mergeWrites(card, withCard, newId) : NOT_FOUND;
};

/**
 * 「次へ」に付ける、画面が抽出中と見ているカードの dripId（二度押しやほかの端末と同時に押したときに断ってもらう）。
 * 抽出中が無ければ（マスターで準備完了にして終わった、など）null で、待機の先頭を始める
 */
export const brewingDripId = (cards: readonly CaosCard[], dripper: number) =>
  cards.find((card) => card.dripper === dripper && card.status === "brewing")
    ?.dripId ?? null;
