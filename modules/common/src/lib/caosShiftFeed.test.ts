import { describe, expect, test } from "vitest";
import {
  type ShiftFeed,
  currentShiftPeriods,
  fetchShiftFeed,
  isSeniorName,
  laneCandidates,
  laneOrdinal,
  parseShiftFeed,
} from "./caosShiftFeed";

const str = (stringValue: string) => ({ stringValue });
const int = (n: number) => ({ integerValue: String(n) });
const arr = (...values: unknown[]) => ({ arrayValue: { values } });
const map = (fields: Record<string, unknown>) => ({ mapValue: { fields } });
const names = (...list: string[]) => arr(...list.map(str));

// sohosai-shift が書く caosFeeds/{合言葉} を、Firestore の REST で読んだときの形
const doc = {
  name: "projects/sohosai-shift/databases/(default)/documents/caosFeeds/x",
  fields: {
    room: str("1C201"),
    updatedAt: { timestampValue: "2026-10-31T01:58:00Z" },
    drippers: map({
      "2026-10-31 11:00": names("山田", "", "鈴木", "", "", ""),
      "2026-10-31 11:30": names("佐藤", "田中", "", "", "", ""),
      "2026-11-01 11:00": names("高橋", "", "", "", "", ""),
    }),
    drills: map({
      d1: map({
        title: str("第2回オペ練"),
        date: str("2026-10-20"),
        start: str("13:00"),
        minutes: int(20),
        gap: int(5),
        rounds: int(2),
        drippers: map({
          "1": names("山田", "", "", "", "", "佐藤"),
          "2": names("佐藤", "山田", "", "", "", ""),
        }),
      }),
    }),
    seniors: names("山田", "佐藤"),
  },
  createTime: "2026-10-01T00:00:00Z",
  updateTime: "2026-10-31T01:58:01Z",
};

const at = (iso: string) => Date.parse(iso);

describe("[unit] parseShiftFeed", () => {
  test("Firestore の REST の形式を普通の値に直す", () => {
    const feed = parseShiftFeed(doc);
    expect(feed.room).toBe("1C201");
    expect(feed.updatedAt).toBe("2026-10-31T01:58:00Z");
    expect(feed.drippers["2026-10-31 11:00"]).toEqual([
      "山田",
      "",
      "鈴木",
      "",
      "",
      "",
    ]);
    expect(feed.drills).toEqual([
      {
        id: "d1",
        title: "第2回オペ練",
        date: "2026-10-20",
        start: "13:00",
        minutes: 20,
        gap: 5,
        rounds: 2,
        drippers: {
          "1": ["山田", "", "", "", "", "佐藤"],
          "2": ["佐藤", "山田", "", "", "", ""],
        },
      },
    ]);
    expect(feed.seniors).toEqual(["山田", "佐藤"]);
  });

  test("足りない・壊れた値は空にする（6 人分にそろえる）", () => {
    const feed = parseShiftFeed({
      fields: {
        drippers: map({ "2026-10-31 11:00": names(" 山田 ") }),
        seniors: str("山田"),
      },
      updateTime: "2026-10-31T00:00:00Z",
    });
    expect(feed.drippers["2026-10-31 11:00"]).toEqual([
      "山田",
      "",
      "",
      "",
      "",
      "",
    ]);
    expect(feed.seniors).toEqual([]);
    expect(feed.drills).toEqual([]);
    expect(feed.updatedAt).toBe("2026-10-31T00:00:00Z");
    expect(parseShiftFeed(null).room).toBe("");
  });
});

describe("[unit] fetchShiftFeed", () => {
  const key = "a".repeat(32);
  const respond = (status: number, body: unknown = {}) =>
    (async () =>
      new Response(JSON.stringify(body), { status })) as typeof fetch;

  test("合言葉の URL を読む", async () => {
    let url = "";
    const feed = await fetchShiftFeed(key, (async (input: RequestInfo) => {
      url = String(input);
      return new Response(JSON.stringify(doc), { status: 200 });
    }) as typeof fetch);
    expect(url).toBe(
      `https://firestore.googleapis.com/v1/projects/sohosai-shift/databases/(default)/documents/caosFeeds/${key}`,
    );
    expect(feed.room).toBe("1C201");
  });

  test("合言葉の形が違えば送らない", async () => {
    await expect(fetchShiftFeed("short", respond(200))).rejects.toThrow(
      "英数字 32〜64 文字",
    );
    await expect(
      fetchShiftFeed(`${"a".repeat(31)}/`, respond(200)),
    ).rejects.toThrow();
  });

  test("読めないときは理由を出す", async () => {
    await expect(fetchShiftFeed(key, respond(404))).rejects.toThrow(
      "まだ配信されていません",
    );
    await expect(fetchShiftFeed(key, respond(403))).rejects.toThrow(
      "権限がありません",
    );
    await expect(fetchShiftFeed(key, respond(500))).rejects.toThrow("500");
    await expect(
      fetchShiftFeed(key, (async () => {
        throw new TypeError("offline");
      }) as typeof fetch),
    ).rejects.toThrow("つながりません");
  });
});

describe("[unit] 候補", () => {
  const feed: ShiftFeed = parseShiftFeed(doc);

  test("列の呼び方", () => {
    expect([1, 2, 3, 4, 5, 6].map(laneOrdinal)).toEqual([
      "1st",
      "2nd",
      "3rd",
      "4th",
      "5th",
      "6th",
    ]);
  });

  test("上級生は seniors に名前がある人", () => {
    expect(isSeniorName(feed, "山田")).toBe(true);
    expect(isSeniorName(feed, " 佐藤 ")).toBe(true);
    expect(isSeniorName(feed, "鈴木")).toBe(false);
    expect(isSeniorName(null, "山田")).toBe(false);
    expect(isSeniorName(feed, "")).toBe(false);
  });

  test("本番：今の枠と次の枠（日本時間）", () => {
    // 2026-10-31 11:10 JST
    const periods = currentShiftPeriods(feed, at("2026-10-31T02:10:00Z"));
    expect(periods.map((p) => p.label)).toEqual([
      "今の枠 11:00〜11:30",
      "次の枠 11:30〜12:00",
    ]);
  });

  test("オペ練：ラウンド k の開始は start + (k-1)×(minutes+gap)", () => {
    // 13:22 JST はラウンドの間（R1 は 13:00〜13:20、R2 は 13:25〜13:45）
    expect(
      currentShiftPeriods(feed, at("2026-10-20T04:22:00Z")).map((p) => p.label),
    ).toEqual(["第2回オペ練 次のR2 13:25〜13:45"]);
    expect(
      currentShiftPeriods(feed, at("2026-10-20T04:30:00Z")).map((p) => p.label),
    ).toEqual(["第2回オペ練 今のR2 13:25〜13:45"]);
    expect(currentShiftPeriods(feed, at("2026-10-20T04:45:00Z"))).toEqual([]);
  });

  test("その番目の人を上に、同じ予定のほかの人、今日の予定のほかの人の順", () => {
    const list = laneCandidates(feed, 1, at("2026-10-31T02:10:00Z"));
    expect(list.map((c) => c.name)).toEqual(["山田", "佐藤", "鈴木", "田中"]);
    expect(list[0]).toEqual({
      name: "山田",
      senior: true,
      reasons: ["今の枠 11:00〜11:30 の 1st"],
      forThisLane: true,
    });
    expect(list[1].reasons).toEqual(["次の枠 11:30〜12:00 の 1st"]);
    expect(list[2]).toMatchObject({ name: "鈴木", forThisLane: false });
    // 今その列にいる人は出さない
    expect(
      laneCandidates(feed, 1, at("2026-10-31T02:10:00Z"), "山田").map(
        (c) => c.name,
      ),
    ).toEqual(["佐藤", "鈴木", "田中"]);
    // 予定の無い日は、今日の予定に出てくる人も無い
    expect(laneCandidates(feed, 1, at("2026-10-30T02:10:00Z"))).toEqual([]);
    expect(laneCandidates(null, 1, Date.now())).toEqual([]);
  });

  test("オペ練のラウンドの、その番目の人", () => {
    const list = laneCandidates(feed, 6, at("2026-10-20T04:05:00Z"));
    expect(list[0]).toMatchObject({
      name: "佐藤",
      forThisLane: true,
      // 同じ人がほかの予定のほかの番目にもいれば、それも理由に添える
      reasons: [
        "第2回オペ練 今のR1 13:00〜13:20 の 6th",
        "第2回オペ練 次のR2 13:25〜13:45 の 1st",
      ],
    });
  });
});
