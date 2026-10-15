import { describe, expect, test } from "vitest";
import type { CaosCard } from "./caos-board";
import {
  type CaosLanes,
  activeSeniorOnlyCards,
  emptyCaosLanes,
  laneChangeWarnings,
  nonSeniorMerge,
  nonSeniorPlacement,
  seniorOnlyOffSenior,
  seniorUpdates,
  todaysCaosLanes,
} from "./caosLanes";
import type { ShiftFeed } from "./caosShiftFeed";

const DAY = "2026-11-03";

const lanes = (
  ...people: [dripper: number, name: string, senior: boolean][]
): CaosLanes => ({
  day: DAY,
  lanes: emptyCaosLanes(DAY).lanes.map((lane) => {
    const p = people.find(([d]) => d === lane.dripper);
    return p
      ? { ...lane, name: p[1], senior: p[2], updated_at: "2026-11-03T02:00Z" }
      : lane;
  }),
});

let seq = 0;
const card = (init: Partial<CaosCard>): CaosCard =>
  ({
    key: `card-${++seq}`,
    dripId: `drip-${seq}`,
    status: "queued",
    dripper: null,
    dripperPosition: seq,
    startedAt: null,
    finishedAt: null,
    cups: [],
    orderNo: seq,
    nominatedDripper: null,
    seniorOnly: false,
    ...init,
  }) as CaosCard;

describe("[unit] CaOS のドリッパーの担当者", () => {
  test("今日の担当者だけを使う。届いていなければ・別の日なら担当者なし", () => {
    const today = todaysCaosLanes(lanes([1, "山田", true]), DAY);
    expect(today.map((l) => [l.dripper, l.name, l.senior])).toEqual([
      [1, "山田", true],
      [2, "", false],
      [3, "", false],
      [4, "", false],
      [5, "", false],
      [6, "", false],
    ]);
    expect(todaysCaosLanes(lanes([1, "山田", true]), "2026-11-04")[0]).toEqual({
      dripper: 1,
      name: "",
      senior: false,
      updated_at: null,
    });
    expect(todaysCaosLanes(null, DAY)).toHaveLength(6);
    // 名前の無い担当者は上級生にしない
    expect(todaysCaosLanes(lanes([2, "", true]), DAY)[1].senior).toBe(false);
  });

  test("上級生のみのカードを上級生でない担当者のドリッパーに置くなら、その担当者（止めない。担当者のいないドリッパー・同じドリッパーの中は知らせない）", () => {
    const today = todaysCaosLanes(
      lanes([1, "山田", true], [2, "佐藤", false]),
      DAY,
    );
    const limited = card({ status: "unassigned", seniorOnly: true });
    expect(nonSeniorPlacement(limited, 1, today)).toBeNull();
    expect(nonSeniorPlacement(limited, 2, today)?.name).toBe("佐藤");
    // 担当者がいない（警告の印だけ）
    expect(nonSeniorPlacement(limited, 3, today)).toBeNull();
    expect(
      nonSeniorPlacement(
        { seniorOnly: false, dripper: null, nominatedDripper: null },
        3,
        today,
      ),
    ).toBeNull();
    // 同じドリッパーの中の入れ替え・指名のあるカードは知らせない
    expect(
      nonSeniorPlacement(
        { seniorOnly: true, dripper: 2, nominatedDripper: null },
        2,
        today,
      ),
    ).toBeNull();
    expect(
      nonSeniorPlacement(
        { seniorOnly: true, dripper: null, nominatedDripper: 2 },
        2,
        today,
      ),
    ).toBeNull();
  });

  test("警告の印：上級生のみのカードが、上級生でない担当者のドリッパーで待っている・抽出中", () => {
    const today = todaysCaosLanes(
      lanes([1, "山田", true], [2, "佐藤", false]),
      DAY,
    );
    const limited = (init: Partial<CaosCard>) =>
      card({ seniorOnly: true, ...init });
    expect(seniorOnlyOffSenior(limited({ dripper: 2 }), today)).toBe(true);
    expect(
      seniorOnlyOffSenior(limited({ dripper: 3, status: "brewing" }), today),
    ).toBe(true);
    expect(seniorOnlyOffSenior(limited({ dripper: 1 }), today)).toBe(false);
    expect(
      seniorOnlyOffSenior(limited({ dripper: 2, status: "done" }), today),
    ).toBe(false);
    expect(
      seniorOnlyOffSenior(
        limited({ dripper: null, status: "unassigned" }),
        today,
      ),
    ).toBe(false);
    expect(
      seniorOnlyOffSenior(limited({ dripper: 2, nominatedDripper: 2 }), today),
    ).toBe(false);
  });

  test("統合：統合したあとのカードを into のドリッパーに置くとみる（指名はどちらかの指名）", () => {
    const today = todaysCaosLanes(lanes([2, "佐藤", false]), DAY);
    const limited = card({ status: "unassigned", seniorOnly: true });
    // 指名のカード（上級生でない 2nd）に入れれば、指名のあるカードなので知らせない
    expect(
      nonSeniorMerge(
        limited,
        card({ dripper: 2, seniorOnly: true, nominatedDripper: 2 }),
        today,
      ),
    ).toBeNull();
    // 指名の無いカードどうしを上級生でない 2nd に置くなら知らせる
    expect(
      nonSeniorMerge(limited, card({ dripper: 2, seniorOnly: true }), today)
        ?.name,
    ).toBe("佐藤");
    // 未割当のカードに入れるのは置かないので知らせない
    expect(
      nonSeniorMerge(limited, card({ status: "unassigned" }), today),
    ).toBeNull();
  });

  test("交代の知らせ：上級生でない人にするドリッパーに指名の無い上級生のみのカード（抽出中・待機）があれば出す", () => {
    const cards = [
      card({ dripper: 1, seniorOnly: true }),
      card({ dripper: 1, seniorOnly: true }),
      card({ dripper: 1, seniorOnly: false }),
      // 抽出中は数え、終わりは数えない（警告の印と同じ）
      card({ dripper: 1, seniorOnly: true, status: "brewing" }),
      card({ dripper: 1, seniorOnly: true, status: "done" }),
      card({ dripper: 2, seniorOnly: true }),
      // 指名のあるカードは担当者が上級生でなくても置けるので数えない
      card({ dripper: 1, seniorOnly: true, nominatedDripper: 1 }),
    ];
    expect(activeSeniorOnlyCards(cards, 1)).toBe(3);
    expect(
      laneChangeWarnings(
        cards,
        [{ dripper: 1, name: "佐藤", senior: false }],
        true,
      ),
    ).toEqual([
      "このドリッパーに指名の無い上級生のみのカードが3枚あります（佐藤さんは上級生ではありません）",
    ]);
    expect(
      laneChangeWarnings(
        cards,
        [{ dripper: 1, name: "山田", senior: true }],
        true,
      ),
    ).toEqual([]);
    expect(
      laneChangeWarnings(
        cards,
        [{ dripper: 3, name: "", senior: false }],
        true,
      ),
    ).toEqual([]);
    // 入れ替えはドリッパーごとに 1 行。担当者なしになるときもそう書く
    expect(
      laneChangeWarnings(
        cards,
        [
          { dripper: 1, name: "", senior: false },
          { dripper: 2, name: "山田", senior: true },
        ],
        false,
      ),
    ).toEqual([
      "1st のドリッパーに指名の無い上級生のみのカードが3枚あります（担当者がいなくなります）",
    ]);
  });

  test("名簿を読み直すと、今の担当者の上級生かだけを新しい名簿に合わせる", () => {
    const feed = (seniors: string[]): ShiftFeed => ({
      drippers: {},
      drills: [],
      seniors,
      updatedAt: null,
    });
    const now = todaysCaosLanes(
      lanes([1, "山田", false], [2, "佐藤", true], [3, "鈴木", true]),
      DAY,
    );
    // 名簿に載った人は上級生に、名簿から消えた人は外す。変わらない人と担当者なしは出さない（名前は変えない）
    expect(seniorUpdates(now, feed(["山田", "鈴木"]))).toEqual([
      { dripper: 1, name: "山田", senior: true },
      { dripper: 2, name: "佐藤", senior: false },
    ]);
    expect(seniorUpdates(now, feed(["佐藤", "鈴木"]))).toEqual([]);
    // 予定が無い・名簿が空なら何もしない（読めなかっただけで全員を外さない）
    expect(seniorUpdates(now, null)).toEqual([]);
    expect(seniorUpdates(now, feed([]))).toEqual([]);
  });
});
