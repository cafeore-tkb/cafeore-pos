import { describe, expect, test } from "vitest";
import {
  caosFeedUrl,
  currentShiftPeriods,
  fetchShiftFeed,
  isSeniorName,
  laneCandidates,
  normalizeFeedKey,
  parseShiftFeed,
} from "./caosShiftFeed";

// Firestore の REST の形（sohosai-shift の caosFeeds/{合言葉}）
const str = (stringValue: string) => ({ stringValue });
const names = (...list: string[]) => ({
  arrayValue: { values: list.map(str) },
});
const DOC = {
  name: "projects/sohosai-shift/databases/(default)/documents/caosFeeds/key",
  updateTime: "2026-11-02T01:00:00Z",
  fields: {
    drippers: {
      mapValue: {
        fields: {
          "2026-11-03 11:00": names("山田", "佐藤", "", "鈴木", "高橋", "田中"),
          "2026-11-03 11:30": names("伊藤", "佐藤", "渡辺", "", "高橋", "田中"),
          "2026-11-03 10:30": names("小林", "", "", "", "", ""),
          // 別の日は使わない
          "2026-11-04 11:00": names("加藤", "", "", "", "", ""),
        },
      },
    },
    drills: {
      mapValue: {
        fields: {
          d1: {
            mapValue: {
              fields: {
                title: str("第2回オペ練"),
                date: str("2026-11-03"),
                start: str("11:10"),
                minutes: { integerValue: "20" },
                gap: { integerValue: "5" },
                rounds: { integerValue: "3" },
                drippers: {
                  mapValue: {
                    fields: {
                      "1": names("山本", "", "", "", "", ""),
                      "2": names("中村", "", "", "", "", ""),
                      "3": names("山田", "", "", "", "", ""),
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    seniors: names("山田", "ｻﾄｳ", "中村"),
  },
};

// 日本時間 2026-11-03 11:15（枠 11:00〜11:30・オペ練 R1 11:10〜11:30）
const NOW = Date.parse("2026-11-03T11:15:00+09:00");

describe("[unit] sohosai-shift の予定（caosFeeds）", () => {
  test("Firestore の REST の形を読む", () => {
    const feed = parseShiftFeed(DOC);
    expect(feed.drippers["2026-11-03 11:00"]).toEqual([
      "山田",
      "佐藤",
      "",
      "鈴木",
      "高橋",
      "田中",
    ]);
    expect(feed.drills).toEqual([
      expect.objectContaining({
        id: "d1",
        title: "第2回オペ練",
        start: "11:10",
        minutes: 20,
        gap: 5,
        rounds: 3,
      }),
    ]);
    expect(feed.seniors).toEqual(["山田", "ｻﾄｳ", "中村"]);
    expect(feed.updatedAt).toBe("2026-11-02T01:00:00Z");
    // 足りない・壊れた中身でも落ちない
    expect(parseShiftFeed({})).toEqual({
      drippers: {},
      drills: [],
      seniors: [],
      updatedAt: null,
    });
  });

  test("上級生かは seniors に名前があるか（NFKC でそろえる）", () => {
    const feed = parseShiftFeed(DOC);
    expect(isSeniorName(feed, "山田")).toBe(true);
    expect(isSeniorName(feed, " サトウ ")).toBe(true);
    expect(isSeniorName(feed, "鈴木")).toBe(false);
    expect(isSeniorName(null, "山田")).toBe(false);
    expect(isSeniorName(feed, "")).toBe(false);
  });

  test("今の枠・次の枠・オペ練の今と次のラウンド", () => {
    const feed = parseShiftFeed(DOC);
    expect(
      currentShiftPeriods(feed, NOW).map(({ label, names }) => [
        label,
        names[0],
      ]),
    ).toEqual([
      ["今の枠 11:00〜11:30", "山田"],
      ["次の枠 11:30〜12:00", "伊藤"],
      // ラウンド k の開始は start + (k-1)×(minutes+gap)
      ["第2回オペ練 今のR1 11:10〜11:30", "山本"],
      ["第2回オペ練 次のR2 11:35〜11:55", "中村"],
    ]);
    // ラウンドの間（gap）は今のラウンドが無い
    const between = Date.parse("2026-11-03T11:32:00+09:00");
    expect(currentShiftPeriods(feed, between).map((p) => p.label)).toEqual([
      "今の枠 11:30〜12:00",
      "第2回オペ練 次のR2 11:35〜11:55",
    ]);
  });

  test("候補はその番目の人だけ。同じ人はまとめ、空きと今の担当者は出さない", () => {
    const feed = parseShiftFeed(DOC);
    expect(laneCandidates(feed, 1, NOW)).toEqual([
      {
        name: "山田",
        senior: true,
        reasons: ["今の枠 11:00〜11:30"],
      },
      { name: "伊藤", senior: false, reasons: ["次の枠 11:30〜12:00"] },
      {
        name: "山本",
        senior: false,
        reasons: ["第2回オペ練 今のR1 11:10〜11:30"],
      },
      {
        name: "中村",
        senior: true,
        reasons: ["第2回オペ練 次のR2 11:35〜11:55"],
      },
    ]);
    expect(laneCandidates(feed, 2, NOW)).toEqual([
      {
        name: "佐藤",
        senior: false,
        reasons: ["今の枠 11:00〜11:30", "次の枠 11:30〜12:00"],
      },
    ]);
    expect(laneCandidates(feed, 1, NOW, "山田").map((c) => c.name)).toEqual([
      "伊藤",
      "山本",
      "中村",
    ]);
    expect(laneCandidates(feed, 3, NOW).map((c) => c.name)).toEqual(["渡辺"]);
    expect(laneCandidates(null, 1, NOW)).toEqual([]);
  });

  test("合言葉で Firestore の REST を読む", async () => {
    const urls: string[] = [];
    const ok = (async (url: string) => {
      urls.push(url);
      return new Response(JSON.stringify(DOC), { status: 200 });
    }) as typeof fetch;
    const feed = await fetchShiftFeed(" abcDEF123 ", ok);
    expect(feed.seniors).toHaveLength(3);
    expect(urls).toEqual([
      "https://firestore.googleapis.com/v1/projects/sohosai-shift/databases/(default)/documents/caosFeeds/abcDEF123",
    ]);
    const status = (code: number) =>
      (async () => new Response("{}", { status: code })) as typeof fetch;
    await expect(fetchShiftFeed("abc", status(404))).rejects.toThrow(
      "合言葉が違うか",
    );
    await expect(fetchShiftFeed("abc", status(403))).rejects.toThrow(
      "読む権限",
    );
    const offline = (async () => {
      throw new TypeError("offline");
    }) as typeof fetch;
    await expect(fetchShiftFeed("abc", offline)).rejects.toThrow(
      "つながりません",
    );
    await expect(fetchShiftFeed("a/b", ok)).rejects.toThrow("形が違います");
    expect(normalizeFeedKey("  ")).toBeNull();
    expect(normalizeFeedKey("a b")).toBeNull();
    expect(caosFeedUrl("a+b")).toMatch(/caosFeeds\/a%2Bb$/);
  });
});
