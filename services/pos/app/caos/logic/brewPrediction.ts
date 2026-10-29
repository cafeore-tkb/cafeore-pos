import type { CaosBrewModel, CaosCard, CaosLane } from "@cafeore/common";
import { INITIAL_BREW_SECONDS, brewKind } from "./brewModel";

const safeSeconds = (value: number | undefined, fallback: number) =>
  value !== undefined && Number.isFinite(value) && value >= 60 && value <= 900
    ? value
    : fallback;

/** 各画面で共通。抽出中は開始時の記録を使い、待機は現在の担当者を使う。 */
export function predictedBrewSeconds(
  model: CaosBrewModel | undefined,
  card: CaosCard,
  dripper: number,
  person?: Pick<CaosLane, "name" | "grade">,
): number {
  const kind = brewKind(card);
  const fallback = card.cups.length > 1 ? 360 : 300;
  if (!kind || !model || model.version !== "brew-v1") return fallback;
  if (card.startedAt && card.dripId) {
    const active = model.active.find(
      (record) =>
        record.drip_id === card.dripId &&
        Date.parse(record.started_at) === card.startedAt?.getTime() &&
        record.dripper === dripper &&
        record.kind === kind &&
        record.excluded_reason !== "restarted_or_moved",
    );
    if (active)
      return safeSeconds(active.predicted_seconds, INITIAL_BREW_SECONDS[kind]);
  }
  const lane = model.lanes.find(
    (candidate) =>
      candidate.dripper === dripper &&
      person?.name === candidate.name &&
      (person?.grade ?? "") === candidate.grade,
  );
  const estimate = lane?.estimates[kind] ?? model.standards[kind];
  return safeSeconds(estimate?.seconds, INITIAL_BREW_SECONDS[kind]);
}
