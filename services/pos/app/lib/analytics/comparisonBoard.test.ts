import { describe, expect, test } from "vitest";
import {
  cardGroup,
  comparisonBoard,
  excludeMappingCard,
  moveMappingCard,
  restoreMappingCard,
  settingsFromBoard,
} from "./comparisonBoard";
import {
  comparisonSettingsSchema,
  emptyComparisonSettings,
} from "./yearComparison";
const current = [
  { key: "yoin", name: "余音ブレンド" },
  { key: "coffee", name: "珈琲・俺ブレンド" },
];
const historical = ["縁ブレンド", "も花も香ブレンド", "珈琲・俺ブレンド"];
const empty = () =>
  comparisonBoard(
    emptyComparisonSettings(),
    current.map((p) => p.key),
    historical,
  );
const paired = () =>
  moveMappingCard(
    empty(),
    { side: "historical", key: "縁ブレンド" },
    { type: "card", side: "current", key: "yoin" },
  );
const check = (board: ReturnType<typeof empty>) => {
  const settings = settingsFromBoard(
    emptyComparisonSettings(),
    board,
    current,
    historical,
  );
  expect(comparisonSettingsSchema.safeParse(settings).success).toBe(true);
  for (const side of ["current", "historical"] as const) {
    const keys = [
      ...board.groups.flatMap((g) => g[side]),
      ...(side === "current"
        ? [...board.pendingCurrent, ...board.excludedCurrent]
        : [...board.pendingHistorical, ...board.excludedHistorical]),
    ];
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.sort()).toEqual(
      (side === "current" ? current.map((p) => p.key) : [...historical]).sort(),
    );
  }
};
describe("unit comparison card board", () => {
  test("同名・同じ順番でも勝手には対応しない", () => {
    const board = empty();
    expect(board.groups).toEqual([]);
    expect(board.pendingCurrent).toEqual(["yoin", "coffee"]);
    expect(board.pendingHistorical).toEqual(historical);
    check(board);
  });
  test("縁と余音を対応し、も花も香を同じ行に足す", () => {
    let board = paired();
    const group = board.groups[0];
    expect(group.current).toEqual(["yoin"]);
    expect(group.historical).toEqual(["縁ブレンド"]);
    board = moveMappingCard(
      board,
      { side: "historical", key: "も花も香ブレンド" },
      { type: "group", id: group.id },
    );
    expect(board.groups[0].historical).toEqual([
      "縁ブレンド",
      "も花も香ブレンド",
    ]);
    const settings = settingsFromBoard(
      emptyComparisonSettings(),
      board,
      current,
      historical,
    );
    expect(settings.current.yoin).toBe("余音ブレンド");
    expect(settings.historical.縁ブレンド).toBe("余音ブレンド");
    expect(settings.historical.も花も香ブレンド).toBe("余音ブレンド");
    check(board);
  });
  test("同じ対応行の中でも前年カードを並び替えられる", () => {
    let board = paired();
    board = moveMappingCard(
      board,
      { side: "historical", key: "も花も香ブレンド" },
      { type: "group", id: board.groups[0].id },
    );
    board = moveMappingCard(
      board,
      { side: "historical", key: "も花も香ブレンド" },
      { type: "card", side: "historical", key: "縁ブレンド" },
    );
    expect(board.groups[0].historical).toEqual([
      "も花も香ブレンド",
      "縁ブレンド",
    ]);
    check(board);
  });
  test("既存の多対多設定をラベルごと引き継ぐ", () => {
    const settings = {
      ...emptyComparisonSettings(),
      current: { yoin: "香り", coffee: "香り" },
      historical: { 縁ブレンド: "香り", も花も香ブレンド: "香り" },
    };
    const board = comparisonBoard(
      settings,
      current.map((p) => p.key),
      historical,
    );
    expect(board.groups).toEqual([
      {
        id: "legacy:香り",
        label: "香り",
        current: ["yoin", "coffee"],
        historical: ["縁ブレンド", "も花も香ブレンド"],
      },
    ]);
    expect(
      settingsFromBoard(settings, board, current, historical).current.yoin,
    ).toBe("香り");
    check(board);
  });
  test("×で外したカードを下に保存し、相手だけの行は解除する", () => {
    let board = excludeMappingCard(paired(), { side: "current", key: "yoin" });
    expect(board.groups).toEqual([]);
    expect(board.excludedCurrent).toEqual(["yoin"]);
    expect(board.pendingHistorical).toContain("縁ブレンド");
    board = restoreMappingCard(board, { side: "current", key: "yoin" });
    expect(board.excludedCurrent).toEqual([]);
    expect(board.pendingCurrent.at(-1)).toBe("yoin");
    expect(board.groups).toEqual([]);
    check(board);
  });
  test("1枚外しても同じ行に他のカードがあれば対応を保つ", () => {
    let board = paired();
    board = moveMappingCard(
      board,
      { side: "historical", key: "も花も香ブレンド" },
      { type: "group", id: board.groups[0].id },
    );
    board = excludeMappingCard(board, {
      side: "historical",
      key: "縁ブレンド",
    });
    expect(board.groups[0].historical).toEqual(["も花も香ブレンド"]);
    expect(board.excludedHistorical).toEqual(["縁ブレンド"]);
    check(board);
  });
  test("別の行へ移動したとき元の相手を対応待ちに戻し、重複させない", () => {
    let board = paired();
    board = moveMappingCard(
      board,
      { side: "current", key: "coffee" },
      { type: "card", side: "historical", key: "珈琲・俺ブレンド" },
    );
    const destination = cardGroup(board, { side: "current", key: "coffee" });
    board = moveMappingCard(
      board,
      { side: "current", key: "yoin" },
      { type: "group", id: destination?.id ?? "" },
    );
    expect(board.groups).toHaveLength(1);
    expect(board.groups[0].current).toEqual(["coffee", "yoin"]);
    expect(board.pendingHistorical).toContain("縁ブレンド");
    expect(
      moveMappingCard(
        board,
        { side: "current", key: "yoin" },
        { type: "group", id: board.groups[0].id },
      ),
    ).toBe(board);
    check(board);
  });
  test("対応待ちの並び順と除外・対応を再読込して復元する", () => {
    let board = moveMappingCard(
      empty(),
      { side: "current", key: "coffee" },
      { type: "card", side: "current", key: "yoin" },
    );
    expect(board.pendingCurrent).toEqual(["coffee", "yoin"]);
    board = excludeMappingCard(board, {
      side: "historical",
      key: "も花も香ブレンド",
    });
    const settings = comparisonSettingsSchema.parse(
      JSON.parse(
        JSON.stringify(
          settingsFromBoard(
            emptyComparisonSettings(),
            board,
            current,
            historical,
          ),
        ),
      ),
    );
    expect(
      comparisonBoard(
        settings,
        current.map((p) => p.key),
        historical,
      ),
    ).toEqual(board);
    check(board);
  });
  test("カード操作は版2で保存し、版1を読みつつ未知の版や配置欠損は拒否する", () => {
    const legacy = {
      ...emptyComparisonSettings(),
      current: { yoin: "余音" },
      historical: { 縁ブレンド: "余音" },
    };
    expect(comparisonSettingsSchema.safeParse(legacy).success).toBe(true);
    const next = settingsFromBoard(
      legacy,
      comparisonBoard(
        legacy,
        current.map((p) => p.key),
        historical,
      ),
      current,
      historical,
    );
    expect(next.version).toBe(2);
    expect(
      comparisonSettingsSchema.parse(JSON.parse(JSON.stringify(next))),
    ).toEqual(next);
    expect(
      comparisonSettingsSchema.safeParse({ ...legacy, version: 2 }).success,
    ).toBe(false);
    expect(
      comparisonSettingsSchema.safeParse({ ...next, version: 3 }).success,
    ).toBe(false);
  });
  test("重複カードの保存値は読み込み失敗にし、未知の商品の対応は勝手に消さない", () => {
    const board = empty();
    board.excludedCurrent.push("yoin");
    expect(
      comparisonSettingsSchema.safeParse({
        ...emptyComparisonSettings(),
        board,
      }).success,
    ).toBe(false);
    const settings = {
      ...emptyComparisonSettings(),
      current: { deleted: "以前の対応" },
    };
    expect(
      settingsFromBoard(settings, empty(), current, historical).current.deleted,
    ).toBe("以前の対応");
  });
});
