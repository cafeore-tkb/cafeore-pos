import type { CaosCard, ShiftFeed } from "@cafeore/common";
import { describe, expect, test } from "vitest";
import {
  dripWarnings,
  gradeMembers,
  memberDrips,
  unsupportedDrip,
} from "./dripSupport";

const all = ["1杯ホット", "2杯ホット", "1杯アイス", "2杯アイス"];
const feed = (drips?: ShiftFeed["drips"]): ShiftFeed => ({
  updatedAt: null,
  drippers: { slot: ["ｻﾄｳ", "予定のみ"] },
  drills: [],
  seniors: [],
  members: [
    { name: "サトウ", grade: "B2" },
    { name: "別の人", grade: "M1" },
  ],
  drips,
});
const cup = (iced = false, needs = true, makes = true) =>
  ({
    item: {
      item_type: { iced_brew: iced, needs_brew: needs, makes_cup: makes },
    },
  }) as CaosCard["cups"][number];
const card = (...cups: CaosCard["cups"]) => ({ cups }) as CaosCard;

describe("drip support", () => {
  test("未登録と明示的な対応なしを区別し、氏名は全半角と前後空白を揃える", () => {
    expect(memberDrips(feed(), "サトウ")).toBeUndefined();
    expect(dripWarnings(feed(), "サトウ")).toEqual([]);
    expect(unsupportedDrip(feed(), "サトウ", card(cup()))).toBe(false);
    const f = feed({ " ｻﾄｳ ": [] });
    expect(memberDrips(f, " サトウ ")).toEqual([]);
    expect(dripWarnings(f, "サトウ")).toEqual(["ホット×", "アイス×"]);
    expect(unsupportedDrip(f, "サトウ", card(cup()))).toBe(true);
  });
  test.each([false, true])(
    "ホット／アイスの1杯・2杯をそれぞれ判定する: %s",
    (iced) => {
      const kind = iced ? "アイス" : "ホット";
      for (const count of [1, 2]) {
        const c = card(...Array.from({ length: count }, () => cup(iced)));
        expect(
          unsupportedDrip(feed({ サトウ: [`${count}杯${kind}`] }), "サトウ", c),
        ).toBe(false);
        expect(
          unsupportedDrip(
            feed({ サトウ: all.filter((v) => v !== `${count}杯${kind}`) }),
            "サトウ",
            c,
          ),
        ).toBe(true);
      }
    },
  );
  test("混在は種類別、ミルク・その他は対象外、不正な3杯から能力を推測しない", () => {
    const f = feed({ サトウ: ["1杯ホット", "1杯アイス"] });
    expect(unsupportedDrip(f, "サトウ", card(cup(), cup(true)))).toBe(false);
    expect(
      unsupportedDrip(
        feed({ サトウ: ["1杯ホット"] }),
        "サトウ",
        card(cup(), cup(true)),
      ),
    ).toBe(true);
    expect(
      unsupportedDrip(
        f,
        "サトウ",
        card(cup(), cup(false, false), cup(false, true, false)),
      ),
    ).toBe(false);
    expect(
      unsupportedDrip(feed({ サトウ: [] }), "サトウ", card(cup(false, false))),
    ).toBe(false);
    expect(
      unsupportedDrip(
        feed({ サトウ: [] }),
        "サトウ",
        card(cup(), cup(), cup()),
      ),
    ).toBe(false);
  });
  test("学年名簿は同じ氏名を統合し、現担当を除き、予定だけの人を残す", () => {
    expect(gradeMembers(feed(), " 別の人 ")).toEqual([
      { name: "サトウ", grade: "B2" },
      { name: "予定のみ", grade: "学年未登録" },
    ]);
    expect(gradeMembers(feed(), "ｻﾄｳ").some((m) => m.name === "サトウ")).toBe(
      false,
    );
    expect(gradeMembers(null, "")).toEqual([]);
  });
});

test("検索用の別名と表示名を保持し、現在の担当者だけを除く", () => {
  const f = feed();
  f.members = [
    {
      name: "佐藤 花子",
      grade: "B2",
      display: "はなちゃん",
      aliases: ["さとう", "はなこ"],
    },
  ];
  expect(gradeMembers(f, "")).toContainEqual(f.members[0]);
  expect(
    gradeMembers(f, "佐藤 花子").some((member) => member.name === "佐藤 花子"),
  ).toBe(false);
});
