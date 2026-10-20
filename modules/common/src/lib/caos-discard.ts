import type { components } from "../types/api";
import { type CaosCard, buildCaosCards, caosStateJSON } from "./caos-board";
import type { CaosPracticeOrder, CaosPracticeResult } from "./caosPractice";

export type CaosDiscardRequest = components["schemas"]["CaosDiscardRequest"];

/** 元の抽出単位の後に、同じカップの実際の入れ直しが登録された杯だけ。 */
export const caosDiscardCandidates = (
  cards: readonly CaosCard[],
  card: CaosCard,
) => {
  if (card.status !== "brewing" && card.status !== "queued") return [];
  const rebrews = cards
    .flatMap((c) => c.cups)
    .filter((c) => c.emergency && c.emergencyReason.trim() !== "ラベル再発行");
  return card.cups.filter(
    (cup) =>
      (!cup.emergency || cup.emergencyReason.trim() !== "ラベル再発行") &&
      rebrews.some(
        (redo) =>
          redo.cupId === cup.cupId &&
          redo.id !== cup.id &&
          redo.orderedAt.getTime() >= cup.orderedAt.getTime() &&
          redo.orderedAt.getTime() >=
            (card.startedAt ?? cup.orderedAt).getTime(),
      ),
  );
};

/** 破棄した杯だけ別の終了カードにする。相手の抽出・提供・在庫は変更しない。 */
export const discardCaosPracticeCups = (
  orders: readonly CaosPracticeOrder[],
  req: CaosDiscardRequest,
  now: Date,
): CaosPracticeResult => {
  if (
    !req.cup_ids.length ||
    req.cup_ids.length > 2 ||
    new Set(req.cup_ids).size !== req.cup_ids.length ||
    !req.drip_id ||
    req.drip_id === req.before.drip_id
  )
    return { error: "破棄の対象が不正です" };
  const cards = buildCaosCards(orders);
  const target = cards.find((c) => c.dripId === req.before.drip_id);
  if (
    !target ||
    JSON.stringify(caosStateJSON(target.state)) !== JSON.stringify(req.before)
  )
    return { error: "カードの状態が変わりました。もう一度確認してください" };
  const candidates = new Set(
    caosDiscardCandidates(cards, target).map((c) => c.id),
  );
  if (req.cup_ids.some((id) => !candidates.has(id)))
    return { error: "入れ直し元の未完了の抽出だけ破棄できます" };
  if (cards.some((c) => c.dripId === req.drip_id))
    return { error: "破棄後のカードIDが使われています" };
  const ids = new Set(req.cup_ids);
  const finished = new Date(
    Math.max(now.getTime(), target.startedAt?.getTime() ?? 0),
  );
  const update = <
    T extends {
      id: string;
      dripId: string | null;
      brewFinishedAt: Date | null;
    },
  >(
    row: T,
  ): T =>
    ids.has(row.id)
      ? { ...row, dripId: req.drip_id, brewFinishedAt: finished }
      : { ...row };
  return {
    orders: orders.map((order) => ({
      ...order,
      cups: order.cups.map((cup) => ({
        ...update(cup),
        emergencies: cup.emergencies.map(update),
      })),
    })),
  };
};
