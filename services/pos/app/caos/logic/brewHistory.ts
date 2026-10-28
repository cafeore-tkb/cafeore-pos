import type { BrewKind, BrewObservation } from "./brewModel";

/** DB の成功した CaOS 操作履歴。時刻は ISO 文字列。 */
export interface BrewHistoryOperation {
  id: string;
  kind: string;
  occurred_at: string;
  recorded_at: string;
}

export interface BrewHistoryCup {
  operation_id: string;
  unit_id: string;
  cup_id: string;
  iced_brew: boolean | null;
  emergency_reason: string;
  changed: boolean;
  before_dripper: number | null;
  before_drip_id: string | null;
  after_drip_id: string | null;
  before_brew_started_at: string | null;
  after_brew_started_at: string | null;
  before_brew_finished_at: string | null;
  after_brew_finished_at: string | null;
  merged_at: string | null;
}

export interface BrewHistoryAssignee {
  dripper: number;
  changed_at: string;
  name: string;
  grade: string;
}

export interface RejectedBrew {
  dripId: string;
  reason: string;
}

/** 名前と学年を曖昧なく識別できる文字列にする。 */
export const brewPersonKey = (name: string, grade: string): string | null =>
  name.trim() && grade.trim()
    ? JSON.stringify([name.trim(), grade.trim()])
    : null;

/**
 * 完了操作の記録から1抽出を1件に復元する。開始・終了の組と杯数を確認できない
 * 記録は推測で補わず除外する。個人の帰属が曖昧なら全体の集計だけに使う。
 */
export function extractBrewHistory(
  operations: readonly BrewHistoryOperation[],
  cups: readonly BrewHistoryCup[],
  assignees: readonly BrewHistoryAssignee[],
): { observations: BrewObservation[]; rejected: RejectedBrew[] } {
  const opById = new Map(operations.map((op) => [op.id, op]));
  const rowsByDrip = new Map<string, BrewHistoryCup[]>();
  const finishes = new Map<string, BrewHistoryCup[]>();
  for (const row of cups) {
    for (const drip of new Set([row.before_drip_id, row.after_drip_id])) {
      if (drip) rowsByDrip.set(drip, [...(rowsByDrip.get(drip) ?? []), row]);
    }
    const op = opById.get(row.operation_id);
    if (
      op?.kind !== "next" ||
      !row.changed ||
      !row.before_drip_id ||
      !row.before_brew_started_at ||
      row.before_brew_finished_at ||
      !row.after_brew_finished_at
    )
      continue;
    const key = `${row.operation_id}:${row.before_drip_id}`;
    finishes.set(key, [...(finishes.get(key) ?? []), row]);
  }
  const observations: BrewObservation[] = [];
  const rejected: RejectedBrew[] = [];
  const seen = new Set<string>();
  for (const rows of finishes.values()) {
    const first = rows[0];
    if (
      !first?.before_drip_id ||
      !first.before_brew_started_at ||
      !first.after_brew_finished_at
    )
      continue;
    const dripId = first.before_drip_id;
    const reject = (reason: string) => rejected.push({ dripId, reason });
    if (seen.has(dripId)) {
      reject("duplicate");
      continue;
    }
    seen.add(dripId);
    const started = Date.parse(first.before_brew_started_at);
    const finished = Date.parse(first.after_brew_finished_at);
    const related = rowsByDrip.get(dripId) ?? [];
    if (
      !Number.isFinite(started) ||
      !Number.isFinite(finished) ||
      finished <= started
    ) {
      reject("invalid_time");
      continue;
    }
    const seconds = (finished - started) / 1000;
    // 初期安全範囲。実績と前日練習で調整する。
    if (seconds < 60 || seconds > 900) {
      reject("duration_outlier");
      continue;
    }
    if (
      rows.length < 1 ||
      rows.length > 2 ||
      new Set(rows.map((row) => row.unit_id)).size !== rows.length ||
      rows.some(
        (row) =>
          row.before_brew_started_at !== first.before_brew_started_at ||
          row.after_brew_finished_at !== first.after_brew_finished_at ||
          row.before_dripper !== first.before_dripper,
      )
    ) {
      reject("inconsistent_cups");
      continue;
    }
    if (
      rows.some((row) => row.unit_id !== row.cup_id || row.emergency_reason)
    ) {
      reject("rebrew");
      continue;
    }
    if (
      rows.some((row) => typeof row.iced_brew !== "boolean") ||
      rows.some((row) => row.iced_brew !== first.iced_brew)
    ) {
      reject("unknown_or_mixed_type");
      continue;
    }
    const starts = related.filter(
      (row) =>
        row.changed &&
        row.after_drip_id === dripId &&
        row.after_brew_started_at === first.before_brew_started_at &&
        row.before_brew_started_at !== row.after_brew_started_at,
    );
    if (
      new Set(starts.map((row) => row.unit_id)).size !== rows.length ||
      rows.some((row) => !starts.some((start) => start.unit_id === row.unit_id))
    ) {
      reject("missing_or_changed_start");
      continue;
    }
    if (
      related.some(
        (row) =>
          row.merged_at &&
          Date.parse(row.merged_at) > started &&
          Date.parse(row.merged_at) <= finished,
      )
    ) {
      reject("late_merge");
      continue;
    }
    const dripper = first.before_dripper;
    const jstDay = (ms: number) =>
      Math.floor((ms + 9 * 60 * 60 * 1000) / 86_400_000);
    const changes = assignees
      .filter(
        (change) =>
          change.dripper === dripper &&
          Number.isFinite(Date.parse(change.changed_at)) &&
          jstDay(Date.parse(change.changed_at)) === jstDay(started),
      )
      .sort((a, b) => Date.parse(a.changed_at) - Date.parse(b.changed_at));
    const during = changes.some(
      (change) =>
        Date.parse(change.changed_at) > started &&
        Date.parse(change.changed_at) <= finished,
    );
    if (during) {
      reject("assignee_changed");
      continue;
    }
    const atStart = changes
      .filter((change) => Date.parse(change.changed_at) <= started)
      .at(-1);
    // 遅延送信では交代操作との順序を確実に復元できない。
    const startOps = starts.map((row) => opById.get(row.operation_id));
    const finishOp = opById.get(first.operation_id);
    const timely = [...startOps, finishOp].every(
      (op) =>
        op &&
        Number.isFinite(Date.parse(op.recorded_at)) &&
        Math.abs(Date.parse(op.recorded_at) - Date.parse(op.occurred_at)) <=
          5000,
    );
    const personKey =
      timely && atStart ? brewPersonKey(atStart.name, atStart.grade) : null;
    const kind = `${first.iced_brew ? "ice" : "hot"}${rows.length}` as BrewKind;
    observations.push({
      dripId,
      kind,
      seconds,
      finishedAtMs: finished,
      personKey,
    });
  }
  return { observations, rejected };
}
