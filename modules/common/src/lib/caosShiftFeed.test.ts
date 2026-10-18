import { describe, expect, test } from "vitest";
import {
  type ShiftFeed,
  caosFeedUrl,
  currentShiftPeriods,
  fetchShiftFeed,
  isSeniorName,
  laneCandidates,
  nextLaneCandidate,
  normalizeFeedKey,
  parseShiftFeed,
  upcomingLaneCandidate,
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

  test("すぐ入る次の人は候補の最初の人。いなければ、予定の人がもう入っているか", () => {
    const feed = parseShiftFeed(DOC);
    // 今の枠の人が入っていれば、次の枠の人
    expect(nextLaneCandidate(feed, 1, NOW, "山田")).toEqual({
      name: "伊藤",
      senior: false,
      reasons: ["次の枠 11:30〜12:00"],
    });
    // 予定に無い人が入っていれば、今の枠の人
    expect(nextLaneCandidate(feed, 1, NOW, "代打")).toMatchObject({
      name: "山田",
    });
    // 空きなら今の枠の人
    expect(nextLaneCandidate(feed, 4, NOW, "")).toMatchObject({
      name: "鈴木",
    });
    // 前の予定の人には戻らない：次の枠の伊藤が入っていれば、今の枠の山田ではなく、その後ろのオペ練の山本
    expect(nextLaneCandidate(feed, 1, NOW, "伊藤")).toMatchObject({
      name: "山本",
    });
    // 一番うしろの予定（オペ練の次のラウンド）の中村が入っていれば、後ろに人がいない
    expect(nextLaneCandidate(feed, 1, NOW, "中村")).toBe("already-in");
    // 次の枠の渡辺が入っていれば、今の枠（空き）より後ろに人がいない
    expect(nextLaneCandidate(feed, 3, NOW, "渡辺")).toBe("already-in");
    // 予定の人（今の枠も次の枠も同じ人）がもう入っている
    expect(nextLaneCandidate(feed, 2, NOW, "佐藤")).toBe("already-in");
    // 予定に人がいない・予定が無い
    expect(nextLaneCandidate(feed, 3, NOW + 3_600_000, "")).toBeNull();
    expect(nextLaneCandidate(null, 1, NOW, "山田")).toBeNull();
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

describe("[unit] upcomingLaneCandidate", () => {
  const at = (time: string, day = "2026-11-03") =>
    Date.parse(`${day}T${time}+09:00`);
  const scheduled = (): ShiftFeed => ({
    drippers: {
      "2026-11-03 11:00": ["山田"],
      "2026-11-03 11:30": ["伊藤"],
    },
    drills: [],
    seniors: ["伊藤"],
    updatedAt: null,
  });
  test("10分前ちょうどから開始直前まで予告する", () => {
    const feed = scheduled();
    expect(
      upcomingLaneCandidate(feed, 1, at("11:19:59.999"), "山田"),
    ).toBeNull();
    expect(upcomingLaneCandidate(feed, 1, at("11:20:00"), "山田")).toEqual({
      name: "伊藤",
      senior: true,
      reasons: ["次のシフト 11:30開始"],
    });
    expect(
      upcomingLaneCandidate(feed, 1, at("11:29:59.999"), "山田")?.name,
    ).toBe("伊藤");
    expect(upcomingLaneCandidate(feed, 1, at("11:30:00"), "山田")).toBeNull();
  });
  test("手動の代打が入っても開始済みの人へ戻す予告をしない", () => {
    expect(
      upcomingLaneCandidate(scheduled(), 1, at("11:15:00"), "代打"),
    ).toBeNull();
    expect(
      upcomingLaneCandidate(scheduled(), 1, at("11:20:00"), "代打")?.name,
    ).toBe("伊藤");
  });
  test("枠終了後は候補にしない", () => {
    expect(
      upcomingLaneCandidate(scheduled(), 1, at("12:00:00"), "代打"),
    ).toBeNull();
  });
  test("同じ担当者・空き・存在しない番号は予告しない", () => {
    expect(
      upcomingLaneCandidate(scheduled(), 1, at("11:20:00"), " 伊藤 "),
    ).toBeNull();
    const feed = scheduled();
    feed.drippers["2026-11-03 11:30"] = ["  "];
    expect(upcomingLaneCandidate(feed, 1, at("11:20:00"), "山田")).toBeNull();
    expect(
      upcomingLaneCandidate(scheduled(), 6, at("11:20:00"), "山田"),
    ).toBeNull();
  });
  test("別日の予定・未読込は予告しない", () => {
    expect(
      upcomingLaneCandidate(
        scheduled(),
        1,
        at("11:20:00", "2026-11-04"),
        "山田",
      ),
    ).toBeNull();
    expect(upcomingLaneCandidate(null, 1, at("11:20:00"), "山田")).toBeNull();
  });
  test("オペ練の時間・間隔から次ラウンドの10分前を計算する", () => {
    const feed = scheduled();
    feed.drippers = {};
    feed.drills = [
      {
        id: "d1",
        title: "練習",
        date: "2026-11-03",
        start: "11:10",
        minutes: 20,
        gap: 5,
        rounds: 2,
        drippers: { "1": ["山田"], "2": ["伊藤"] },
      },
    ];
    expect(
      upcomingLaneCandidate(feed, 1, at("11:24:59.999"), "代打"),
    ).toBeNull();
    expect(upcomingLaneCandidate(feed, 1, at("11:25:00"), "代打")?.name).toBe(
      "伊藤",
    );
    expect(upcomingLaneCandidate(feed, 1, at("11:35:00"), "山田")).toBeNull();
    expect(upcomingLaneCandidate(feed, 1, at("11:55:00"), "山田")).toBeNull();
    expect(
      upcomingLaneCandidate(feed, 1, at("11:25:00", "2026-11-04"), "山田"),
    ).toBeNull();
  });
});
