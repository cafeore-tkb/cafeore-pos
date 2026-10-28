import { describe, expect, test } from "vitest";
import {
  type BrewHistoryCup,
  type BrewHistoryOperation,
  brewPersonKey,
  extractBrewHistory,
} from "./brewHistory";

const start = "2026-10-27T02:00:00.000Z";
const finish = "2026-10-27T02:04:00.000Z";
const ops: BrewHistoryOperation[] = [
  { id: "start", kind: "next", occurred_at: start, recorded_at: start },
  { id: "finish", kind: "next", occurred_at: finish, recorded_at: finish },
];
const row = (unit: string, finishRow = false): BrewHistoryCup => ({
  operation_id: finishRow ? "finish" : "start",
  unit_id: unit,
  cup_id: unit,
  iced_brew: false,
  emergency_reason: "",
  changed: true,
  before_dripper: 1,
  before_drip_id: "drip",
  after_drip_id: "drip",
  before_brew_started_at: finishRow ? start : null,
  after_brew_started_at: start,
  before_brew_finished_at: null,
  after_brew_finished_at: finishRow ? finish : null,
  merged_at: null,
});
const person = {
  dripper: 1,
  changed_at: "2026-10-27T01:30:00.000Z",
  name: "山田",
  grade: "B2",
};

describe("[unit] brew history", () => {
  test("別注文の2杯は1抽出にまとめ、開始時の担当者を使う", () => {
    const result = extractBrewHistory(
      ops,
      [row("a"), row("b"), row("a", true), row("b", true)],
      [person],
    );
    expect(result.observations).toEqual([
      {
        dripId: "drip",
        kind: "hot2",
        seconds: 240,
        finishedAtMs: Date.parse(finish),
        personKey: brewPersonKey("山田", "B2"),
      },
    ]);
    expect(result.rejected).toEqual([]);
  });
  test("抽出中の統合、途中交代、種類不明を除外する", () => {
    const merged = { ...row("a", true), merged_at: "2026-10-27T02:01:00.000Z" };
    expect(
      extractBrewHistory(ops, [row("a"), merged], [person]).rejected[0].reason,
    ).toBe("late_merge");
    expect(
      extractBrewHistory(
        ops,
        [row("a"), row("a", true)],
        [person, { ...person, changed_at: "2026-10-27T02:02:00.000Z" }],
      ).rejected[0].reason,
    ).toBe("assignee_changed");
    expect(
      extractBrewHistory(
        ops,
        [row("a"), { ...row("a", true), iced_brew: null }],
        [person],
      ).rejected[0].reason,
    ).toBe("unknown_or_mixed_type");
  });
  test("別の日の担当者を引き継がず、終了が遅れて送られたら個人に帰属させない", () => {
    const rows = [row("a"), row("a", true)];
    const oldPerson = { ...person, changed_at: "2026-10-26T01:30:00.000Z" };
    expect(
      extractBrewHistory(ops, rows, [oldPerson]).observations[0].personKey,
    ).toBeNull();
    const delayed = [
      ops[0],
      { ...ops[1], recorded_at: "2026-10-27T02:10:00.000Z" },
    ];
    expect(
      extractBrewHistory(delayed, rows, [person]).observations[0].personKey,
    ).toBeNull();
  });
});
